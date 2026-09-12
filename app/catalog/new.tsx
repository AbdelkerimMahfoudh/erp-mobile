import React, { useState } from 'react';
import { Stack, useRouter , useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../lib/branch';
import { notePendingProduct, peekPendingIntake } from '../../lib/scan/pending-intake';
import { suggestedTracking } from '../../lib/scan/suggested-tracking';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Screen } from '../../components/ui';
import {
  ProductForm,
  emptyProductForm,
  toProductPayload,
  type ProductFormValues,
} from '../../components/catalog/ProductForm';
import { ApiError, api } from '../../lib/api-client';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { dialog } from '../../lib/dialog';
import type { ProductDetail, ProductPage } from '../../types/api';

/**
 * Create a product (G1) — the shared form, nothing duplicated.
 *
 * `POST /products` has no idempotency key, but the database guarantees a unique
 * (company, brand, model, variant) and a unique (company, barcode). So a request
 * that times out and is retried cannot silently create a second product: the
 * retry comes back 409. Rather than showing a bare failure, this screen resolves
 * the existing product and offers to open it — see `resolveExisting`.
 */
export default function NewProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const { barcode: scannedBarcode } = useLocalSearchParams<{ barcode?: string }>();
  const intakeScope = {
    companyId: user?.companyId ?? '',
    userId: user?.id ?? '',
    branchId: branchId ?? '',
  };
  /**
   * What the scan that opened this form was, if it opened from one.
   *
   * `peek`, not `take`: the intake belongs to Receive and must still be waiting
   * when this screen hands control back — creating a product is a detour, not a
   * handover. The kind is read from WHICH field holds the code, because the
   * intake keeps an IMEI, a serial and a product barcode deliberately apart.
   */
  const held = peekPendingIntake(intakeScope);
  const suggested = suggestedTracking(
    held?.primaryImei ? 'imei' : held?.serial ? 'serial' : held?.productBarcode ? 'barcode' : 'unknown',
  );

  const canManage = usePermission('catalog.manage');
  const canSetPrice = usePermission('price.edit');

  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});
  const [existingId, setExistingId] = useState<string | null>(null);

  /** Find the product a 409 was actually about, so we can offer to open it. */
  const resolveExisting = async (values: ProductFormValues): Promise<string | null> => {
    const term = values.barcode.trim() || [values.brand, values.model, values.variant].filter(Boolean).join(' ');
    try {
      const page = await api.get<ProductPage>(`/products?active=all&q=${encodeURIComponent(term)}`);
      const exact = page.rows.find(
        (r) =>
          (values.barcode.trim() && r.barcode === values.barcode.trim().toUpperCase()) ||
          (r.brand.toLowerCase() === values.brand.trim().toLowerCase() &&
            r.model.toLowerCase() === values.model.trim().toLowerCase() &&
            (r.variant ?? '').toLowerCase() === values.variant.trim().toLowerCase()),
      );
      return exact?.id ?? page.rows[0]?.id ?? null;
    } catch {
      return null;
    }
  };

  const create = useMutation({
    mutationFn: (values: ProductFormValues) =>
      api.post<ProductDetail>('/products', toProductPayload(values, { includePrice: canSetPrice })),
    onSuccess: (product) => {
      // The new product must appear in every selector immediately.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(t('catalog.form.created'));
      /*
       * If a scan is waiting, this product was created *for* it — go back to
       * intake rather than to the product page, with the identifier that was
       * accepted before the detour still held.
       *
       * Creating a Product does NOT create the inventory Unit. The unit is
       * still made by the intake submission the user is being returned to.
       */
      if (peekPendingIntake(intakeScope)) {
        notePendingProduct(product.id);
        // Back to the SAME Receive screen, which still holds the delivery. A
        // `replace` put a second, empty Receive on top of it.
        if (router.canGoBack()) router.back();
        else router.replace('/receive');
        return;
      }
      router.replace(`/catalog/${product.id}` as never);
    },
    onError: async (error, values) => {
      if (error instanceof ApiError && error.status === 409) {
        const barcodeClash = /barcode/i.test(error.message);
        setErrors(
          barcodeClash
            ? { barcode: t('catalog.conflict.barcode') }
            : { variant: t('catalog.conflict.variant') },
        );
        // A 409 after a dropped connection usually means the FIRST attempt
        // landed. Say so, and offer the product instead of a blind retry.
        const id = await resolveExisting(values);
        if (id) {
          setExistingId(id);
          await dialog.alert({
            title: t('catalog.conflict.maybeCreated.title'),
            message: t('catalog.conflict.maybeCreated.body'),
          });
        }
        return;
      }
      toast.error(error instanceof ApiError ? error.message : t('state.error.body'));
    },
  });

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('catalog.form.newTitle') }} />
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('catalog.form.newTitle') }} />
      <ProductForm
        mode="create"
        /*
         * Prefilled ONLY from a genuine product barcode handed over by intake.
         * An IMEI never reaches this parameter — it identifies one phone, and
         * `ProductForm` refuses it here for the same reason.
         *
         * The tracking mode is seeded from what the scanner CLASSIFIED, not
         * from the barcode: a serial suggests serial, an IMEI suggests IMEI,
         * and a product barcode suggests nothing because it names a model
         * rather than a unit. A category, once chosen, overrides all of it.
         */
        initial={{
          ...emptyProductForm,
          barcode: scannedBarcode ?? '',
          trackingType: suggested ?? emptyProductForm.trackingType,
        }}
        suggestedFromScan={suggested}
        submitting={create.isPending}
        errors={errors}
        onSubmit={(values) => {
          setErrors({});
          setExistingId(null);
          create.mutate(values);
        }}
        onKnownBarcode={(productId) => router.push(`/catalog/${productId}` as never)}
        footerExtra={
          existingId ? (
            <Button
              title={t('catalog.conflict.openExisting')}
              variant="secondary"
              onPress={() => router.replace(`/catalog/${existingId}` as never)}
            />
          ) : null
        }
      />
    </>
  );
}
