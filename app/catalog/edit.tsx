import React, { useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState, Screen, SkeletonList } from '../../components/ui';
import {
  ProductForm,
  toProductPayload,
  type ProductFormValues,
} from '../../components/catalog/ProductForm';
import { ApiError, api } from '../../lib/api-client';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { ProductDetail } from '../../types/api';

/**
 * Edit product METADATA (G1) — the same shared form as Create.
 *
 * Only metadata is sent: `PATCH /products/:id` has no price or cost field, so
 * `catalog.manage` cannot become pricing authority by accident. Units,
 * StockItems, purchases and sales are untouched by design — the endpoint never
 * writes them.
 *
 * Archive and restore deliberately live on the DETAIL screen, not buried among
 * these fields: changing what a product *is* and taking it out of circulation
 * are different decisions and should not share a save button.
 */
export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = usePermission('catalog.manage');
  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});

  const product = useQuery({
    queryKey: qk.product(String(id)),
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
  });

  /** The saved product as form values — the baseline for dirty-checking. */
  const initial = useMemo<ProductFormValues | null>(() => {
    const p = product.data;
    if (!p) return null;
    return {
      brand: p.brand,
      model: p.model,
      variant: p.variant ?? '',
      categoryId: p.categoryId,
      trackingType: p.trackingType,
      barcode: p.barcode ?? '',
      specifications: Object.entries(p.specifications ?? {}).map(([key, value]) => ({
        key,
        value: value === null || value === undefined ? '' : String(value),
      })),
      defaultPrice: '', // never edited here
    };
  }, [product.data]);

  const save = useMutation({
    mutationFn: (values: ProductFormValues) =>
      // includePrice: false — the metadata endpoint has no price field at all.
      api.patch<ProductDetail>(`/products/${id}`, toProductPayload(values, { includePrice: false })),
    onSuccess: (fresh) => {
      queryClient.setQueryData(qk.product(String(id)), fresh);
      // Catalog lists and product selectors show this metadata; Inventory shows
      // the label too. Financial queries are deliberately NOT invalidated —
      // nothing about money changed.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(t('catalog.form.updated'));
      router.back();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        // Say which conflict it was, so the right field turns red.
        setErrors(
          /barcode/i.test(error.message)
            ? { barcode: t('catalog.conflict.barcode') }
            : { variant: t('catalog.conflict.variant') },
        );
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        /*
         * Backend validation is authoritative; surface its words.
         *
         * This used to land on the free-form Details field, which no longer
         * exists. A 400 here is now almost always about identity — the brand
         * and model are the only free text left — so it goes there, where the
         * employee can actually act on it, rather than under a field they
         * cannot see.
         */
        setErrors({ brand: error.message });
        return;
      }
      toast.error(error instanceof ApiError ? error.message : t('state.error.body'));
    },
  });

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('catalog.form.editTitle') }} />
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }

  if (product.isLoading || !initial) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('catalog.form.editTitle') }} />
        {product.isError ? (
          <ErrorState error={product.error} onRetry={() => void product.refetch()} />
        ) : (
          <SkeletonList count={4} />
        )}
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('catalog.form.editTitle') }} />
      <ProductForm
        mode="edit"
        initial={initial}
        // The server already knows whether history froze the tracking mode, so
        // the control is disabled with an explanation instead of failing a save.
        canChangeTracking={product.data?.canChangeTracking ?? true}
        submitting={save.isPending}
        errors={errors}
        onSubmit={(values) => {
          setErrors({});
          save.mutate(values);
        }}
        onKnownBarcode={(productId, label) => {
          // Scanning this product's own barcode is harmless; another product's
          // is a conflict, and we never move recognition evidence silently.
          if (productId === String(id)) return;
          setErrors({ barcode: t('catalog.conflict.barcode') });
          toast.error(t('catalog.scan.known.body', { label }));
        }}
      />
    </>
  );
}
