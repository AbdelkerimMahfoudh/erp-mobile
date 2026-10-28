import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../lib/branch';
import { clearPendingIntake, notePendingDraft, notePendingProduct, peekPendingIntake } from '../../lib/scan/pending-intake';
import { purchaseItems, type NewProductDraft, type PurchaseOutcome } from '../../lib/receive-outcome';
import { suggestedTracking } from '../../lib/scan/suggested-tracking';
import { restrictionForScan } from '../../lib/intake-form';
import { askMissingCost, parseBuyingCost } from '../../lib/missing-cost';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorState, InlineNotice, ListRow, MoneyField, Screen, Section, Text, TextField } from '../../components/ui';
import { PurchasePaymentPicker, purchasePaymentBody, purchasePaymentReady, type PurchasePayment } from '../../components/receive/PurchasePaymentPicker';
import {
  ProductForm,
  emptyProductForm,
  toProductPayload,
  type ProductFormValues,
} from '../../components/catalog/ProductForm';
import { ApiError, api } from '../../lib/api-client';
import { toErrorMessage, toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { dialog } from '../../lib/dialog';
import { qk } from '../../lib/query-keys';
import { invalidateMoney } from '../../lib/money-invalidation';
import { isStoreClosedRefusal } from '../../lib/day-gate';
import { uuidv4 } from '../../lib/utils';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import type { Category, ProductDetail, ProductPage } from '../../types/api';
import { useFileBatch } from '../../lib/file-batch-store';
import type { CatalogueProduct } from '../../lib/file-receiving';

/**
 * Create a product (G1) — the shared form, nothing duplicated.
 *
 * Four ways in, one form:
 *
 * - **From the catalogue**: product metadata only — no cost, no price — and it
 *   says plainly that creating a product adds no stock.
 * - **From a file review** (`link`): the product is created and linked to the
 *   rows waiting on it; the review commits the stock later.
 * - **From the delivery Receive screen** (a held scan): nothing is saved here.
 *   "Add to delivery" hands the product back as a draft, staged on the
 *   delivery's line, and the delivery's own final commit creates both.
 * - **From Quick receive** (`intake=quick`, D223, the owner's device test of
 *   2026-10-28): this IS the single-item intake. Category, product, the item's
 *   stock details and its optional buying cost, then ONE action — "Create
 *   product and add to stock" — commits the product with its unit or quantity in
 *   one purchase. Success is said only after the server committed it, and the
 *   item is in Stock and findable by Sale at once. It used to hand a draft back
 *   to an empty Receive screen, which froze on the phone.
 *
 * `POST /products` has no idempotency key, but the database guarantees a unique
 * (company, brand, model, variant) and a unique (company, barcode). So a request
 * that times out and is retried cannot silently create a second product: the
 * retry comes back 409. Rather than showing a bare failure, this screen resolves
 * the existing product and offers it — see `resolveExisting`. The quick intake
 * is idempotent by its request key, kept across every uncertain retry.
 */
export default function NewProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const {
    barcode: scannedBarcode,
    link,
    brand: fileBrand,
    model: fileModel,
    variant: fileVariant,
    tracking: fileTracking,
    categoryId: scannedCategory,
    intake,
  } = useLocalSearchParams<{
    barcode?: string;
    link?: string;
    brand?: string;
    model?: string;
    variant?: string;
    tracking?: string;
    /** The category the scan's question chose (an IMEI's kind of device, D223). */
    categoryId?: string;
    /** `quick`: the single-item intake commits here (D223). */
    intake?: string;
  }>();
  const intakeScope = {
    companyId: user?.companyId ?? '',
    userId: user?.id ?? '',
    branchId: branchId ?? '',
  };
  /**
   * What the scan that opened this form was, if it opened from one.
   *
   * `peek`, not `take`: a cancelled detour returns the scan to Receive intact.
   * The kind is read from WHICH field holds the code, because the intake keeps
   * an IMEI, a serial and a product barcode deliberately apart.
   */
  const held = peekPendingIntake(intakeScope);
  const scanKind = held?.primaryImei ? 'imei' : held?.serial ? 'serial' : held?.productBarcode ? 'barcode' : null;
  const suggested = suggestedTracking(scanKind ?? 'unknown');
  const restriction = held ? restrictionForScan(scanKind) : null;

  const canManage = usePermission('catalog.manage');

  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});
  const [existing, setExisting] = useState<CatalogueProduct | null>(null);
  const existingId = existing?.id ?? null;
  /** Set just before a deliberate exit, so the unsaved-changes guard lets it through (the 2026-10-28 freeze). */
  const leaving = useRef(false);

  /**
   * Opened from a file review for a product the catalogue did not know
   * (docs/21, 2026-10-05): `link` names the group of rows waiting on it.
   */
  const linkingGroup = typeof link === 'string' && link ? link : null;
  const quick = intake === 'quick' && Boolean(held) && !linkingGroup;
  const forDelivery = Boolean(held) && !linkingGroup && !quick;
  const [handingBack, setHandingBack] = useState(false);

  // ── The single item's stock details (quick intake) ─────────────────────────
  const [cost, setCost] = useState(held?.cost ?? '');
  const [costError, setCostError] = useState<string | undefined>();
  const costField = useRef<{ focus: () => void } | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [quantityError, setQuantityError] = useState<string | undefined>();
  const [imei2, setImei2] = useState(held?.secondaryImei ?? '');
  const [payment, setPayment] = useState<PurchasePayment>({ method: 'cash', receivingAccountId: null });
  /** One request identity for the purchase that MAY have landed: kept across every uncertain retry. */
  const [clientUuid] = useState(() => uuidv4());
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState<{ label: string } | null>(null);
  /** A second press while the first is still being decided does nothing. */
  const committing = useRef(false);

  const categoryOf = (values: ProductFormValues): Category | null =>
    queryClient.getQueryData<Category[]>(qk.categories)?.find((c) => c.id === values.categoryId) ?? null;

  const asCatalogue = (p: { id: string; brand: string; model: string; variant: string | null; trackingType: string }): CatalogueProduct => ({
    id: p.id,
    brand: p.brand,
    model: p.model,
    variant: p.variant ?? null,
    trackingType: p.trackingType as CatalogueProduct['trackingType'],
  });

  const finishForFile = (product: CatalogueProduct, created: boolean) => {
    const linked = useFileBatch.getState().linkGroupProduct(linkingGroup!, product);
    toast.success(
      created
        ? t('fileReceive.create.linked', { count: String(linked), product: `${product.brand} ${product.model}` })
        : t('fileReceive.create.linkedExisting', { count: String(linked), product: `${product.brand} ${product.model}` }),
    );
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/receive/file' as never);
  };

  /** Find the product a 409 was actually about, so we can offer to open — or use — it. */
  const resolveExisting = async (values: ProductFormValues, exactOnly = false): Promise<CatalogueProduct | null> => {
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
      const hit = exact ?? (exactOnly ? undefined : page.rows[0]);
      return hit ? asCatalogue(hit) : null;
    } catch {
      return null;
    }
  };

  // ── From the catalogue or a file review: the product alone ────────────────
  const create = useMutation({
    mutationFn: (values: ProductFormValues) => api.post<ProductDetail>('/products', toProductPayload(values, categoryOf(values))),
    onSuccess: (product) => {
      // The new product must appear in every selector immediately.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      if (linkingGroup) {
        finishForFile(asCatalogue(product), true);
        return;
      }
      toast.success(t('catalog.form.created'));
      leaving.current = true;
      router.replace(`/catalog/${product.id}` as never);
    },
    onError: async (error, values) => {
      if (error instanceof ApiError && error.status === 409) {
        const barcodeClash = /barcode/i.test(error.message);
        setErrors(barcodeClash ? { barcode: t('catalog.conflict.barcode') } : { variant: t('catalog.conflict.variant') });
        // A 409 after a dropped connection usually means the FIRST attempt
        // landed. Say so, and offer the product instead of a blind retry.
        const found = await resolveExisting(values);
        if (found) {
          setExisting(found);
          await dialog.alert({
            title: t('catalog.conflict.maybeCreated.title'),
            message: linkingGroup ? t('catalog.conflict.useExisting.body') : t('catalog.conflict.maybeCreated.body'),
          });
        }
        return;
      }
      toast.error(toFriendlyError(error).body);
    },
  });

  // ── From the delivery: hand the product back, "Add to delivery" ───────────
  const handBack = async (values: ProductFormValues) => {
    setErrors({});
    setHandingBack(true);
    try {
      const found = await resolveExisting(values, true);
      if (found) {
        // Never a duplicate: the scan is received into the product the shop already has.
        notePendingProduct(found.id);
        toast.success(t('catalog.intake.usingExisting'));
      } else {
        // No price: intake records the buying cost only.
        notePendingDraft(toProductPayload(values, categoryOf(values)) as NewProductDraft);
      }
      // Set BEFORE leaving: the guard sees it in the same tick (the 2026-10-28 freeze).
      leaving.current = true;
      if (router.canGoBack()) router.back();
      else router.replace('/receive');
    } finally {
      setHandingBack(false);
    }
  };

  // ── From Quick receive: the product and its stock, in one purchase ────────
  const receive = useMutation({
    mutationFn: (input: { values: ProductFormValues; unitCost: number | null; productId: string | null }) => {
      const { values, unitCost, productId } = input;
      const identifier = held?.primaryImei ?? held?.serial ?? null;
      const second = imei2.trim();
      return api.post<PurchaseOutcome>('/purchases', {
        clientUuid,
        ...purchasePaymentBody(payment),
        items: purchaseItems([
          {
            key: 'one',
            productId: productId ?? '',
            ...(productId ? {} : { newProduct: toProductPayload(values, categoryOf(values)) as NewProductDraft }),
            trackingType: values.trackingType,
            unitCost,
            ...(values.trackingType === 'quantity'
              ? { quantity: Number(quantity) }
              : { identifiers: identifier ? [identifier] : [], ...(second && identifier ? { secondaries: { [identifier]: second } } : {}) }),
          },
        ]),
      });
    },
    onSuccess: (outcome, { values }) => {
      setUncertain(false);
      // Success ONLY on a server-confirmed receipt: a refused line wrote nothing.
      if (!outcome.purchaseId || outcome.unitsCreated + outcome.stockLines === 0) {
        const refusal = outcome.rejected?.[0]?.reason;
        toast.error(refusal ? `${t('receive.refused.title')} — ${refusal}` : t('receive.refused.none'));
        return;
      }
      clearPendingIntake();
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: qk.home(branchId) });
      invalidateMoney(queryClient);
      const label = [values.brand, values.model].filter(Boolean).join(' ');
      setDone({ label });
      toast.success(outcome.createdProducts?.length ? t('receive.createdAndAdded', { product: label }) : t('quick.receive.done.title'));
    },
    onError: async (e, { values }) => {
      // Somebody created this product meanwhile: nothing was written. The next press receives into it.
      if (e instanceof ApiError && e.status === 409 && e.code === 'product_exists') {
        const found = await resolveExisting(values, true);
        if (found) setExisting(found);
        toast.error(t('receive.productExists'));
        return;
      }
      if (isStoreClosedRefusal(e)) {
        toast.error(t('gate.refused.receive'));
        return;
      }
      // A timeout or a server fault: it may have landed. The same key replays rather than receives twice.
      if (!(e instanceof ApiError) || e.status >= 500) {
        setUncertain(true);
        return;
      }
      toast.error(toErrorMessage(e));
    },
  });

  const commitQuick = async (values: ProductFormValues) => {
    if (committing.current || receive.isPending) return;
    committing.current = true;
    try {
      setErrors({});
      const parsed = parseBuyingCost(cost);
      if (parsed === 'invalid') {
        setCostError(t('cost.invalid'));
        costField.current?.focus();
        return;
      }
      if (values.trackingType === 'quantity' && !(Number(quantity) >= 1 && Number.isInteger(Number(quantity)))) {
        setQuantityError(t('intake.stock.quantity.invalid'));
        return;
      }
      if (parsed === null && !uncertain) {
        const answer = await askMissingCost();
        if (answer === 'add') {
          costField.current?.focus();
          return;
        }
        if (answer === 'cancel') return;
      }
      // An exact product already in the catalogue receives the item; none is duplicated.
      const found = existing ?? (await resolveExisting(values, true));
      await receive.mutateAsync({ values, unitCost: parsed, productId: found?.id ?? null }).catch(() => undefined);
    } finally {
      committing.current = false;
    }
  };

  if (!canManage) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('catalog.form.newTitle') }} />
        <ErrorState error={new ApiError(t('state.error.permission.body'), 403)} />
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: t('quick.receive.done.title') }} />
        <View style={styles.success}>
          <View style={styles.successBadge}>
            <Check color={colors.intent.success.fg} size={40} />
          </View>
          <Text variant="title" align="center">
            {t('quick.receive.done.title')}
          </Text>
          <Text variant="body" tone="secondary" align="center">
            {t('quick.receive.done.body', { product: done.label, branch: branchName ?? '' })}
          </Text>
          <View style={styles.successActions}>
            <Button
              title={t('quick.receive.done.another')}
              size="lg"
              fullWidth
              // Back to Quick receive, which waits empty for the next scan.
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/quick-receive');
              }}
            />
            <Button
              title={t('action.done')}
              variant="secondary"
              fullWidth
              onPress={() => {
                if (router.canGoBack()) router.dismiss(2);
                else router.replace('/');
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  const identifier = held?.primaryImei ?? held?.serial ?? null;
  const stockSection = (values: ProductFormValues) =>
    quick ? (
      <Section title={t('intake.stock.section')}>
        <View style={styles.fields}>
          {identifier ? (
            <Card>
              <ListRow flat title={t(held?.primaryImei ? 'intake.stock.imei' : 'intake.stock.serial')} value={identifier} />
            </Card>
          ) : null}
          {held?.primaryImei && values.trackingType === 'imei' ? (
            <TextField
              label={t('receive.imei2.label')}
              hint={t('receive.imei2.hint')}
              value={imei2}
              onChangeText={(text) => setImei2(text.replace(/[^0-9]/g, '').slice(0, 15))}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={15}
            />
          ) : null}
          {values.trackingType === 'quantity' ? (
            <TextField
              label={t('intake.stock.quantity')}
              value={quantity}
              error={quantityError}
              onChangeText={(text) => {
                setQuantity(text.replace(/[^0-9]/g, ''));
                setQuantityError(undefined);
              }}
              keyboardType="number-pad"
              inputMode="numeric"
            />
          ) : null}
          <MoneyField
            ref={costField as never}
            label={t('cost.optional.label')}
            hint={t('cost.optional.hint')}
            value={cost}
            error={costError}
            onChangeText={(v) => {
              setCost(v);
              setCostError(undefined);
            }}
          />
          <PurchasePaymentPicker value={payment} onChange={setPayment} />
          {uncertain ? (
            <InlineNotice tone="warning" title={t('receive.uncertain.title')}>
              {t('receive.uncertain.body')}
            </InlineNotice>
          ) : null}
        </View>
      </Section>
    ) : null;

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
         * The mode starts from what the scan says the code is — an IMEI, a
         * serial, or a counted product's barcode — and the category chosen
         * first suggests it among the modes it allows.
         */
        initial={{
          ...emptyProductForm,
          barcode: scannedBarcode ?? '',
          categoryId: !linkingGroup && scannedCategory ? scannedCategory : emptyProductForm.categoryId,
          // From a file review: only what the file said, every field still editable.
          brand: linkingGroup ? (fileBrand ?? '') : '',
          model: linkingGroup ? (fileModel ?? '') : '',
          variant: linkingGroup ? (fileVariant ?? '') : '',
          trackingType: linkingGroup
            ? fileTracking === 'serial'
              ? 'serial'
              : 'imei'
            : (restriction?.[0] ?? suggested ?? emptyProductForm.trackingType),
        }}
        suggestedFromScan={suggested}
        scanRestriction={restriction}
        submitting={create.isPending || handingBack || receive.isPending}
        allowLeaveRef={leaving}
        errors={errors}
        submitLabel={
          quick
            ? uncertain
              ? t('receive.uncertain.retry')
              : existingId
                ? t('quick.receive.add')
                : t('receive.createAndAdd')
            : forDelivery
              ? t('catalog.intake.next')
              : undefined
        }
        notice={
          linkingGroup ? null : (
            <InlineNotice tone="info">
              {t(quick ? 'catalog.intake.notice.quick' : forDelivery ? 'catalog.intake.notice' : 'catalog.new.noStock')}
            </InlineNotice>
          )
        }
        renderExtra={stockSection}
        onSubmit={(values) => {
          if (quick) {
            if (!purchasePaymentReady(payment)) return;
            void commitQuick(values);
            return;
          }
          if (forDelivery) {
            void handBack(values);
            return;
          }
          setErrors({});
          setExisting(null);
          create.mutate(values);
        }}
        onKnownBarcode={(productId) => router.push(`/catalog/${productId}` as never)}
        footerExtra={
          existing && linkingGroup ? (
            // The product already exists: no duplicate — the file rows use it.
            <Button title={t('catalog.conflict.useExisting')} variant="secondary" onPress={() => finishForFile(existing, false)} />
          ) : existingId && !quick ? (
            <Button
              title={t('catalog.conflict.openExisting')}
              variant="secondary"
              onPress={() => {
                leaving.current = true;
                router.replace(`/catalog/${existingId}` as never);
              }}
            />
          ) : null
        }
      />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  fields: { gap: space.md },
  success: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  successBadge: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.intent.success.bg,
  },
  successActions: { width: '100%', maxWidth: 380, gap: space.sm, marginTop: space.lg },
}));

