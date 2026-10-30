import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, PackagePlus } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  IconButton,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Text,
  TextField,
} from '../components/ui';
import { ScanTarget } from '../components/scanner';
import { useLeave } from '../components/navigation/HeaderBack';
import type { AcceptedImei } from '../components/scanner/ScannerSheet';
import { ProductConfirmationCard } from '../components/product';
import { SelectSheet } from '../components/overlay';
import { illustrationIconFor } from '../components/ui/CategoryIllustration';
import {
  PurchasePaymentPicker,
  purchasePaymentBody,
  purchasePaymentReady,
  type PurchasePayment,
} from '../components/receive/PurchasePaymentPicker';
import { ApiError, api } from '../lib/api-client';
import { useAuth } from '../hooks/useAuth';
import { useActiveBranchName, useBranch } from '../lib/branch';
import { isRTL } from '../lib/design/direction';
import { space } from '../lib/design/tokens';
import { dialog } from '../lib/dialog';
import { toErrorMessage } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { useDraft } from '../lib/offline/use-draft';
import { DraftNotice } from '../components/DraftNotice';
import {
  holdPendingIntake,
  pendingFrom,
  takePendingIntake,
  type IntakeScope,
} from '../lib/scan/pending-intake';
import { askScanIntake } from '../lib/scan/ask-intake';
import { askMissingCost, parseBuyingCost } from '../lib/missing-cost';
import {
  draftSuggestion,
  imei2Problem,
  purchaseItems,
  type NewProductDraft,
  type PurchaseOutcome,
} from '../lib/receive-outcome';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { uuidv4 } from '../lib/utils';
import type {
  ProductListRow,
  ProductPage,
  ProductSuggestion,
  ScanInventoryMatch,
  ScanResult,
} from '../types/api';
import { makeStyles, useColors } from '../lib/design/theme';
import { invalidateMoney } from '../lib/money-invalidation';
import { DayGate } from '../components/day/DayGate';
import { isStoreClosedRefusal } from '../lib/day-gate';

/**
 * Quick Receive — one phone, from Home, camera first.
 *
 * The everyday purchase in this shop: somebody walks in with a handset, it is
 * scanned, a price is agreed and paid on the spot.
 *
 * ## First release: anonymous, and paid in full
 *
 * Nobody is asked who sold the phone, and nothing is ever left owing. The
 * person chooses only HOW it was paid — cash from the drawer or an active
 * account — and the server sets the amount to the cost.
 *
 * ## What it does NOT do
 *
 * It does not touch the full Receive screen's delivery draft — that is a
 * separate key, so a part-built delivery next door is left exactly as it was.
 * It creates no inventory until the server confirms: creating a Product from
 * here creates a catalogue entry and nothing else, and the phone is still only
 * received by "Add to stock".
 */

/**
 * The product form, opened for a scan: a genuine barcode and a chosen category travel; an IMEI never does.
 * `intake: 'quick'` makes it the single-item intake — the product and its stock committed there, in one
 * action (D223, the owner's device test of 2026-10-28).
 */
function newProductParams(barcode: string | null, categoryId: string | undefined): Record<string, string> {
  return { intake: 'quick', ...(barcode ? { barcode } : {}), ...(categoryId ? { categoryId } : {}) };
}

/** A timeout or a server fault: the purchase may or may not exist. */
function isUncertain(e: unknown): boolean {
  return !(e instanceof ApiError) || e.status >= 500;
}

interface Scanned {
  result: ScanResult;
  suggestion: ProductSuggestion | null;
  /** IMEI 2 captured alongside, when the camera read both. */
  secondary: string | null;
  /** Set when either identifier already belongs to a unit. */
  existing?: ScanInventoryMatch;
  /** The product to create with this phone, in the same request (D223). Not created yet. */
  draft?: NewProductDraft;
}


function QuickReceiveScreen() {
  // With no history (a notification, a cold start) leaving goes to the logical parent, never nowhere.
  const leave = useLeave('/quick-receive');
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const branchName = useActiveBranchName();
  const { user } = useAuth();

  const [scanned, setScanned] = useState<Scanned | null>(null);
  /*
   * The buying cost only (D223). Intake sets no selling price: that is the
   * Sale's, where the suggested price may be changed and a loss is warned.
   */
  const [cost, setCost] = useState('');
  const [imei2, setImei2] = useState('');
  const [imei2Error, setImei2Error] = useState<string | undefined>();

  /** How this purchase was paid. The amount is always the cost, set by the server. */
  const [payment, setPayment] = useState<PurchasePayment>({ method: 'cash', receivingAccountId: null });

  const [done, setDone] = useState<{ outcome: PurchaseOutcome; label: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);

  /**
   * One request identity per purchase that MAY have landed.
   *
   * Kept across every retry of an unconfirmed submission, so a lost response is
   * replayed rather than received twice; renewed only once the server has
   * answered and a new phone is started.
   */
  const [clientUuid, setClientUuid] = useState(() => uuidv4());

  /** The camera's accepted phone, so IMEI 2 travels with the scan result. */
  const lastAccepted = useRef<{ primary: string; secondary: string | null } | null>(null);

  /**
   * Who a pending scan belongs to. All three must still match on the way back,
   * so a branch or account switch mid-detour cannot surface it here.
   */
  /*
   * The three primitives are pulled out FIRST so the memo's dependencies are
   * exactly what it reads. Depending on `user?.companyId` inside a memo whose
   * inferred dependency is the whole `user` object makes the React Compiler
   * skip optimising the component entirely — it cannot prove the manual
   * dependency list matches what the body actually uses.
   */
  const companyId = user?.companyId;
  const userId = user?.id;
  const scope: IntakeScope | null = useMemo(
    () => (companyId && userId && branchId ? { companyId, userId, branchId } : null),
    [companyId, userId, branchId],
  );

  /**
   * Survives an app kill. The identifiers and the cost typed so far, plus the
   * request key — never anything the server owns, because restoring a `done`
   * state would tell somebody they had received stock they never did.
   */
  /*
   * Kept only while there is something the person typed, or an answer still
   * outstanding (D223, 2026-10-28): the request key and the payment method are
   * always set, so keeping them alone made every visit "Restored what you had
   * here" over an empty screen.
   */
  const [restoredTyped, setRestoredTyped] = useState(false);
  const draft = useDraft(
    'quick.receive',
    { cost, imei2, payment, clientUuid },
    (v) => {
      setCost(v.cost ?? '');
      setImei2(v.imei2 ?? '');
      if (v.payment) setPayment(v.payment);
      if (v.clientUuid) setClientUuid(v.clientUuid);
      setRestoredTyped(Boolean(v.cost || v.imei2));
    },
    { enabled: !done, persist: Boolean(cost.trim() || imei2.trim() || uncertain) },
  );

  /**
   * Choosing an existing product, for a model recognition does not know yet.
   *
   * Filtered by what the scan actually is — IMEI products for an IMEI, serial
   * products for a serial — so a phone cannot be booked onto a cable. Creating
   * a product is the other way out; offering only that would push somebody to
   * make a duplicate of a model the shop already stocks.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const pickerKind =
    scanned?.result.kind === 'imei' ? 'imei' : scanned?.result.kind === 'serial' ? 'serial' : null;
  const products = useQuery({
    queryKey: ['products', 'quick-receive-picker', productQuery, pickerKind],
    queryFn: () => {
      const params = new URLSearchParams({ active: 'active' });
      if (productQuery) params.set('q', productQuery);
      if (pickerKind) params.set('trackingType', pickerKind);
      return api.get<ProductPage>(`/products?${params.toString()}`);
    },
    enabled: pickerOpen,
  });

  const pickProduct = async (row: ProductListRow) => {
    setPickerOpen(false);
    try {
      const chosen = await api.get<ProductSuggestion>(
        `/products/suggest?productId=${encodeURIComponent(row.id)}`,
      );
      // An existing product chosen by hand replaces any draft.
      setScanned((s) => (s ? { ...s, suggestion: chosen, draft: undefined } : s));
      setCost(chosen.defaultCost != null ? String(chosen.defaultCost) : '');
    } catch (e) {
      toast.error(toErrorMessage(e));
    }
  };

  const lookUp = useCallback(
    (code: string, secondary: string | null) =>
      api.post<ScanResult>('/scan', { code, ...(secondary ? { secondary } : {}) }),
    [],
  );

  // ── Scanning ──────────────────────────────────────────────────────────────

  const accept = useCallback(
    (result: ScanResult, secondary: string | null) => {
      /*
       * Already a unit — refused here, before anybody types a cost. An IMEI
       * belongs to one phone and uniqueness is global, so this would fail at
       * the database anyway; refusing now explains it instead.
       */
      if (result.inventory?.alreadyInInventory) {
        setScanned({ result, suggestion: result.suggestion, secondary, existing: result.inventory });
        return;
      }
      setScanned({ result, suggestion: result.suggestion, secondary });
      setImei2(secondary ?? '');
      // Confirm, never originate: the product's remembered cost is a starting
      // point the person is expected to check against what was actually agreed.
      setCost(result.suggestion?.defaultCost != null ? String(result.suggestion.defaultCost) : '');
    },
    [],
  );

  const onImeiAccepted = useCallback((a: AcceptedImei) => {
    lastAccepted.current = { primary: a.primary, secondary: a.secondary };
  }, []);

  const onScanResult = useCallback(
    async (raw: ScanResult) => {
      const captured = lastAccepted.current;
      lastAccepted.current = null;
      const secondary =
        raw.kind === 'imei' && captured?.primary === raw.code ? captured.secondary : null;

      let result = raw;
      if (secondary) {
        // The scanner looked IMEI 1 up alone; ask again with both numbers so the
        // duplicate check covers the pair.
        try {
          result = await lookUp(raw.code, secondary);
        } catch (e) {
          toast.error(toErrorMessage(e));
          return;
        }
      }
      accept(result, secondary);
    },
    [accept, lookUp],
  );

  /**
   * Back from Create product — created or cancelled.
   *
   * Both identifiers were held across the detour. Creating a product created no
   * inventory: the phone is still only received by "Add to stock" below.
   */
  useFocusEffect(
    useCallback(() => {
      if (!scope) return;
      const back = takePendingIntake(scope);
      const device = back?.primaryImei ?? back?.serial;
      if (!back || !device) return;
      void (async () => {
        try {
          const result = await lookUp(device, back.secondaryImei);
          if (back.draftProduct && !result.inventory?.alreadyInInventory) {
            // Nothing exists yet: "Create product and add to stock" sends both together.
            setScanned({
              result,
              suggestion: draftSuggestion(back.draftProduct, result.kind),
              secondary: back.secondaryImei,
              draft: back.draftProduct,
            });
            if (back.cost) setCost(back.cost);
            toast.success(t('receive.draftSelected'));
            return;
          }
          if (back.createdProductId && !result.inventory?.alreadyInInventory) {
            const created = await api.get<ProductSuggestion>(
              `/products/suggest?productId=${encodeURIComponent(back.createdProductId)}`,
            );
            setScanned({ result, suggestion: created, secondary: back.secondaryImei });
            // The cost typed before the detour is restored rather than re-asked.
            if (back.cost) setCost(back.cost);
            toast.success(t('receive.createdSelected'));
            return;
          }
          accept(result, back.secondaryImei);
          if (back.cost) setCost(back.cost);
        } catch (e) {
          toast.error(toErrorMessage(e));
        }
      })();
    }, [scope, lookUp, accept, t]),
  );

  const createProduct = async () => {
    const current = scanned;
    if (!current || !scope) return;
    const { result } = current;
    // Asked, never guessed: what the code identifies, and for an IMEI which kind of device (D223).
    const answer = await askScanIntake(result);
    if (!answer) return;
    const isImei = answer.field === 'imei';
    const barcode = answer.field === 'productBarcode' ? result.code : null;
    /*
     * Each identifier has exactly one field it may travel in. An IMEI names one
     * phone and must never reach the Product barcode box — that would poison
     * recognition for every unit of the model.
     */
    holdPendingIntake(
      pendingFrom(scope, {
        imei: isImei ? { primary: result.code, secondary: imei2.trim() || current.secondary } : null,
        serial: answer.field === 'serial' ? result.code : null,
        productBarcode: barcode,
        cost: cost || null,
      }),
    );
    setScanned(null);
    router.push({ pathname: '/catalog/new', params: newProductParams(barcode, answer.categoryId) });
  };

  // ── Commit ────────────────────────────────────────────────────────────────

  /*
   * The buying cost is optional (D223): left empty, the final action asks once
   * (`askMissingCost`) and the item is received at an UNKNOWN cost — never 0.
   */
  const costRef = useRef<{ focus: () => void } | null>(null);
  const [costError, setCostError] = useState<string | undefined>();
  const parsedCost = parseBuyingCost(cost);
  const total = typeof parsedCost === 'number' ? parsedCost : 0;
  const ready = Boolean(scanned?.suggestion) && !scanned?.existing;

  const add = useMutation({
    mutationFn: (unitCost: number | null) => {
      const s = scanned!;
      const secondary = imei2.trim();
      return api.post<PurchaseOutcome>('/purchases', {
        clientUuid,
        // Paid in full by definition: the server sets the amount to the total.
        ...purchasePaymentBody(payment),
        items: purchaseItems([
          {
            key: 'one',
            productId: s.draft ? '' : s.suggestion!.productId,
            ...(s.draft ? { newProduct: s.draft } : {}),
            trackingType: s.suggestion!.trackingType === 'quantity' ? 'quantity' : s.suggestion!.trackingType,
            unitCost,
            ...(s.suggestion!.trackingType === 'quantity'
              ? { quantity: 1 }
              : {
                  identifiers: [s.result.code],
                  ...(secondary ? { secondaries: { [s.result.code]: secondary } } : {}),
                }),
            recognitionKey: s.result.recognitionKey,
          },
        ]),
      });
    },
    onSuccess: (outcome) => {
      setUncertain(false);
      /*
       * Success ONLY on a server-confirmed receipt. A refused line means nothing
       * was written, and saying "added" there would tell somebody they hold
       * stock they do not.
       */
      if (!outcome.purchaseId || outcome.unitsCreated + outcome.stockLines === 0) {
        const refusal = outcome.rejected?.[0]?.reason;
        toast.error(refusal ? `${t('receive.refused.title')} — ${refusal}` : t('receive.refused.none'));
        return;
      }
      const label = scanned?.suggestion
        ? `${scanned.suggestion.brand} ${scanned.suggestion.model}`
        : t('quick.receive.title');
      // Said only now, after the server committed the product WITH its stock.
      if (scanned?.draft && outcome.createdProducts?.length) {
        toast.success(t('receive.createdAndAdded', { product: label }));
        qc.invalidateQueries({ queryKey: ['products'] });
      }
      qc.invalidateQueries({ queryKey: qk.home(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
      invalidateMoney(qc);
      setDone({ outcome, label });
      draft.clear();
    },
    onError: (e) => {
      // Somebody created this product meanwhile: nothing was written; choose it and add again.
      if (e instanceof ApiError && e.status === 409 && e.code === 'product_exists') {
        toast.error(t('receive.productExists'));
        setScanned((s) => (s ? { ...s, suggestion: null, draft: undefined } : s));
        return;
      }
      if (e instanceof ApiError && e.status === 409 && /already used/i.test(e.message)) {
        void dialog.alert({ title: t('receive.uncertain.title'), message: t('receive.keyConflict') });
        return;
      }
      // The day closed under this screen: nothing was received. Reading the day again brings up the lock and Open store now.
      if (isStoreClosedRefusal(e)) {
        toast.error(t('gate.refused.receive'));
        qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
        qc.invalidateQueries({ queryKey: qk.home(branchId) });
        return;
      }
      if (isUncertain(e)) {
        // The purchase may exist. Everything stays locked under the SAME key
        // until an answer arrives, so a retry replays rather than receives twice.
        setUncertain(true);
        return;
      }
      toast.error(toErrorMessage(e));
    },
  });

  /** One press, one purchase: an empty cost is asked about once, and a pending request is never sent again. */
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current || add.isPending) return;
    submitting.current = true;
    try {
      if (parsedCost === 'invalid') {
        setCostError(t('cost.invalid'));
        costRef.current?.focus();
        return;
      }
      if (parsedCost === null && !uncertain) {
        const answer = await askMissingCost();
        if (answer === 'add') {
          costRef.current?.focus();
          return;
        }
        if (answer === 'cancel') return;
      }
      add.mutate(typeof parsedCost === 'number' ? parsedCost : null);
    } finally {
      submitting.current = false;
    }
  };

  const startAnother = () => {
    setClientUuid(uuidv4());
    setDone(null);
    setScanned(null);
    setCost('');
    setImei2('');
    setUncertain(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

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
          <MoneyValue value={done.outcome.total} size="display" />
          <View style={styles.successActions}>
            <Button
              title={t('quick.receive.done.another')}
              icon={PackagePlus}
              size="lg"
              fullWidth
              onPress={startAnother}
            />
            <Button title={t('action.done')} variant="secondary" fullWidth onPress={leave} />
          </View>
        </View>
      </Screen>
    );
  }

  const blocked = scanned?.existing;

  return (
    <>
      <Screen
        scroll={false}
        padded={false}
        header={
          !uncertain ? (
            <ScanTarget
              onResult={onScanResult}
              onImeiAccepted={onImeiAccepted}
              purpose="receive"
              autoOpenCamera={Boolean(branchId)}
              placeholder={t('receive.scan.placeholder')}
            />
          ) : undefined
        }
        footer={
          ready || uncertain ? (
            <>
              <View style={styles.totals}>
                <Text variant="body" tone="secondary">
                  {t('quick.receive.payNow')}
                </Text>
                <MoneyValue value={total} size="large" />
              </View>
              {!uncertain ? <PurchasePaymentPicker value={payment} onChange={setPayment} /> : null}
              <Button
                title={
                  uncertain ? t('receive.uncertain.retry') : scanned?.draft ? t('receive.createAndAdd') : t('quick.receive.add')
                }
                size="lg"
                fullWidth
                loading={add.isPending}
                disabled={!purchasePaymentReady(payment) || add.isPending}
                onPress={() => void submit()}
              />
            </>
          ) : undefined
        }
      >
        <Stack.Screen
          options={{
            headerShown: true,
            title: t('quick.receive.title'),
            headerBackVisible: false,
            headerLeft: () => (
              <IconButton
                icon={isRTL() ? ArrowRight : ArrowLeft}
                accessibilityLabel={t('action.back')}
                onPress={leave}
              />
            ),
          }}
        />

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {restoredTyped ? <DraftNotice draft={draft} onDiscard={startAnother} /> : null}

          {uncertain ? (
            <InlineNotice tone="warning" title={t('receive.uncertain.title')}>
              {t('receive.uncertain.body')}
            </InlineNotice>
          ) : null}

          {!scanned && !uncertain ? (
            <EmptyState
              icon={PackagePlus}
              title={t('quick.receive.empty.title')}
              body={t('quick.receive.empty.body')}
            />
          ) : null}

          {scanned ? (
            <ProductConfirmationCard
              /*
               * A product the person picked by hand replaces the scanner's
               * guess, and is shown as certain — the same rule the full
               * Receive sheet follows. Otherwise the banner went on saying
               * "new to this shop, create or choose" after they had chosen.
               */
              result={
                scanned.suggestion && scanned.result.suggestion?.productId !== scanned.suggestion.productId
                  ? {
                      ...scanned.result,
                      suggestion: scanned.suggestion,
                      recognized: true,
                      confidence: 1,
                      hintCode: undefined,
                      hintParams: undefined,
                    }
                  : scanned.result
              }
              context="receive"
              confirmLabel={t('quick.receive.add')}
              secondaryCode={scanned.secondary}
              notice={
                blocked
                  ? {
                      tone: 'danger',
                      message: blocked.unit
                        ? `${t('quick.receive.registered')} — ${t('receive.existing.here', {
                            product: blocked.unit.productLabel,
                            branch: blocked.unit.branchName,
                          })}`
                        : t('quick.receive.registered'),
                    }
                  : undefined
              }
              recovery={
                blocked?.unit
                  ? {
                      label: t('receive.existing.open'),
                      onPress: () =>
                        router.push({
                          pathname: '/unit/[identifier]',
                          params: { identifier: scanned.result.code },
                        }),
                    }
                  : undefined
              }
              /* The card's own confirm is not the commit — "Add to stock" in the
                 footer is, so there is exactly one way to receive the phone. */
              confirmDisabled
              onConfirm={() => {}}
              onChooseProduct={!blocked ? () => setPickerOpen(true) : undefined}
              onCreateProduct={!scanned.suggestion && !blocked ? () => void createProduct() : undefined}
              onScanAgain={() => setScanned(null)}
            >
              {!blocked && scanned.suggestion ? (
                <View style={styles.fields}>
                  <MoneyField
                    ref={costRef as never}
                    label={t('cost.optional.label')}
                    hint={t('cost.optional.hint')}
                    value={cost}
                    error={costError}
                    onChangeText={(v) => {
                      setCost(v);
                      setCostError(undefined);
                    }}
                  />
                  {scanned.draft ? (
                    <InlineNotice tone="info">{t('receive.newProductBadge')}</InlineNotice>
                  ) : null}
                  {scanned.result.kind === 'imei' ? (
                    <TextField
                      label={t('receive.imei2.label')}
                      hint={t('receive.imei2.hint')}
                      value={imei2}
                      onChangeText={(text) => {
                        setImei2(text.replace(/[^0-9]/g, '').slice(0, 15));
                        setImei2Error(undefined);
                      }}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      maxLength={15}
                      error={imei2Error}
                      onBlur={() => {
                        const problem = imei2Problem(scanned.result.code, imei2, []);
                        setImei2Error(problem ? t(`receive.imei2.${problem}` as never) : undefined);
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
            </ProductConfirmationCard>
          ) : null}
        </ScrollView>
      </Screen>

      <SelectSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('receive.chooseProduct.title')}
        items={products.data?.rows ?? []}
        keyExtractor={(p: ProductListRow) => p.id}
        labelExtractor={(p: ProductListRow) => [p.brand, p.model].filter(Boolean).join(' ')}
        descriptionExtractor={(p: ProductListRow) => p.variant ?? undefined}
        leadingExtractor={(p) => illustrationIconFor(p.categoryVisual, p.trackingType)}
        selectedKeys={scanned?.suggestion ? [scanned.suggestion.productId] : []}
        searchPlaceholder={t('receive.chooseProduct.search')}
        onSearchChange={setProductQuery}
        loading={products.isLoading}
        error={products.error}
        onRetry={() => products.refetch()}
        onSelect={(row: ProductListRow) => void pickProduct(row)}
      />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { padding: space.base, gap: space.sm, paddingBottom: space['3xl'] },
  fields: { gap: space.md },
  totals: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
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

/** Behind the business-day guard: while the current day is closed, the store is opened first (2026-09-27). */
export default function QuickReceiveScreenRoute() {
  return (
    <DayGate>
      <QuickReceiveScreen />
    </DayGate>
  );
}
