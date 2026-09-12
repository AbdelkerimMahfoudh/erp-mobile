import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Package, PackagePlus, Truck } from 'lucide-react-native';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  InlineNotice,
  ListRow,
  MoneyField,
  Screen,
  Text,
  TextField,
} from '../components/ui';
import { ScanTarget } from '../components/scanner';
import type { AcceptedImei } from '../components/scanner/ScannerSheet';
import { ProductConfirmationCard } from '../components/product';
import { SelectSheet } from '../components/overlay';
import { ApiError, api } from '../lib/api-client';
import { useAuth } from '../hooks/useAuth';
import { useBranch } from '../lib/branch';
import { isRTL, isolateLtr } from '../lib/design/direction';
import { space } from '../lib/design/tokens';
import { dialog } from '../lib/dialog';
import { toErrorMessage } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { useDraft } from '../lib/offline/use-draft';
import { DraftNotice } from '../components/DraftNotice';
import {
  holdPendingIntake,
  pendingFrom,
  takePendingIntake,
  type IntakeScope,
} from '../lib/scan/pending-intake';
import { imei2Problem, purchaseItems, type PurchaseOutcome } from '../lib/receive-outcome';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { uuidv4 } from '../lib/utils';
import type {
  ProductListRow,
  ProductPage,
  ProductSuggestion,
  ScanInventoryMatch,
  ScanResult,
  SupplierPage,
  SupplierRow,
} from '../types/api';
import { makeStyles, useColors } from '../lib/design/theme';

/**
 * Quick Receive — one phone, from Home, camera first.
 *
 * The everyday purchase in this shop: somebody walks in with a handset, it is
 * scanned, a price is agreed and paid on the spot. That case has **no trading
 * partner**, which is why the seller lives under *More details* and may be left
 * out entirely — see `0070`.
 *
 * ## What "no seller" does and does not mean
 *
 * It does not mean the money is unaccounted for. A purchase with nobody named
 * must be settled in full, and this screen says so in words and sends the
 * amount explicitly: the server refuses an outstanding balance owed to nobody,
 * because a debt has to be owed to somebody. Naming a seller is what unlocks
 * recording it as still owed.
 *
 * ## What it does NOT do
 *
 * It does not touch the full Receive screen's delivery draft — that is a
 * separate key, so a part-built delivery next door is left exactly as it was.
 * It creates no inventory until the server confirms: creating a Product from
 * here creates a catalogue entry and nothing else, and the phone is still only
 * received by "Add to stock".
 */

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
}

export default function QuickReceiveScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { branchId, branchName } = useBranch();
  const { user } = useAuth();

  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [imei2, setImei2] = useState('');
  const [imei2Error, setImei2Error] = useState<string | undefined>();

  /** Seller and payment both live here — closed by default, because usually neither is needed. */
  const [moreOpen, setMoreOpen] = useState(false);
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  /** Whether the money has actually been handed over. Never inferred. */
  const [paidInFull, setPaidInFull] = useState(true);

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
  const draft = useDraft(
    'quick.receive',
    { cost, price, imei2, supplier, paidInFull, clientUuid },
    (v) => {
      setCost(v.cost ?? '');
      setPrice(v.price ?? '');
      setImei2(v.imei2 ?? '');
      setSupplier(v.supplier ?? null);
      setPaidInFull(v.paidInFull ?? true);
      if (v.clientUuid) setClientUuid(v.clientUuid);
    },
    { enabled: !done },
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
      setScanned((s) => (s ? { ...s, suggestion: chosen } : s));
      setCost(chosen.defaultCost != null ? String(chosen.defaultCost) : '');
      setPrice(chosen.defaultPrice != null ? String(chosen.defaultPrice) : '');
    } catch (e) {
      toast.error(toErrorMessage(e));
    }
  };

  const suppliers = useQuery({
    queryKey: [...qk.suppliers, 'active'],
    queryFn: () => api.get<SupplierPage>('/suppliers?status=active&limit=50'),
    enabled: supplierOpen,
  });

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
      setPrice(result.suggestion?.defaultPrice != null ? String(result.suggestion.defaultPrice) : '');
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

  const createProduct = () => {
    const current = scanned;
    if (!current || !scope) return;
    const { result } = current;
    const isImei = result.kind === 'imei';
    const barcode = result.kind === 'barcode' ? result.code : null;
    /*
     * Each identifier has exactly one field it may travel in. An IMEI names one
     * phone and must never reach the Product barcode box — that would poison
     * recognition for every unit of the model.
     */
    holdPendingIntake(
      pendingFrom(scope, {
        imei: isImei ? { primary: result.code, secondary: imei2.trim() || current.secondary } : null,
        serial: result.kind === 'serial' ? result.code : null,
        productBarcode: barcode,
        cost: cost || null,
      }),
    );
    setScanned(null);
    router.push(barcode ? (`/catalog/new?barcode=${encodeURIComponent(barcode)}` as never) : '/catalog/new');
  };

  // ── Commit ────────────────────────────────────────────────────────────────

  const costValue = Number(cost);
  const total = costValue > 0 ? costValue : 0;
  /**
   * With nobody named, the purchase must be settled in full — the server
   * refuses a balance owed to no one. The amount is sent EXPLICITLY rather than
   * inferred from the absence of a seller.
   */
  const settledInFull = supplier ? paidInFull : true;
  const ready = Boolean(scanned?.suggestion) && !scanned?.existing && costValue > 0;

  const add = useMutation({
    mutationFn: () => {
      const s = scanned!;
      const secondary = imei2.trim();
      return api.post<PurchaseOutcome>('/purchases', {
        clientUuid,
        // Omitted entirely for a walk-in seller — never a placeholder id.
        ...(supplier ? { supplierId: supplier.id } : {}),
        paidAmount: settledInFull ? total : 0,
        items: purchaseItems([
          {
            key: 'one',
            productId: s.suggestion!.productId,
            trackingType: s.suggestion!.trackingType === 'quantity' ? 'quantity' : s.suggestion!.trackingType,
            unitCost: costValue,
            ...(Number(price) > 0 ? { price: Number(price) } : {}),
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
      qc.invalidateQueries({ queryKey: qk.home(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
      qc.invalidateQueries({ queryKey: ['analytics-summary'] });
      if (supplier) qc.invalidateQueries({ queryKey: qk.suppliers });
      setDone({ outcome, label });
      draft.clear();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && /already used/i.test(e.message)) {
        void dialog.alert({ title: t('receive.uncertain.title'), message: t('receive.keyConflict') });
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

  const startAnother = () => {
    setClientUuid(uuidv4());
    setDone(null);
    setScanned(null);
    setCost('');
    setPrice('');
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
          <Text variant="display" align="center">
            {formatMoney(done.outcome.total)}
          </Text>
          <View style={styles.successActions}>
            <Button
              title={t('quick.receive.done.another')}
              icon={PackagePlus}
              size="lg"
              fullWidth
              onPress={startAnother}
            />
            <Button title={t('action.done')} variant="secondary" fullWidth onPress={() => router.back()} />
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
                  {settledInFull ? t('quick.receive.payNow') : t('quick.receive.owed')}
                </Text>
                <Text variant="title">{formatMoney(total)}</Text>
              </View>
              <Button
                title={uncertain ? t('receive.uncertain.retry') : t('quick.receive.add')}
                size="lg"
                fullWidth
                loading={add.isPending}
                onPress={() => add.mutate()}
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
                onPress={() => router.back()}
              />
            ),
          }}
        />

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <DraftNotice draft={draft} onDiscard={startAnother} />

          {uncertain ? (
            <InlineNotice tone="warning" title={t('receive.uncertain.title')}>
              {t('receive.uncertain.body')}
            </InlineNotice>
          ) : null}

          {!scanned && !uncertain ? (
            <EmptyState
              icon={PackagePlus}
              title={t('receive.empty.title')}
              body={t('receive.empty.body')}
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
              onCreateProduct={!scanned.suggestion && !blocked ? createProduct : undefined}
              onScanAgain={() => setScanned(null)}
            >
              {!blocked && scanned.suggestion ? (
                <View style={styles.fields}>
                  <MoneyField
                    label={t('quick.receive.cost')}
                    hint={t('quick.receive.cost.hint')}
                    value={cost}
                    onChangeText={setCost}
                    required
                  />
                  <MoneyField
                    label={t('quick.receive.price')}
                    value={price}
                    onChangeText={setPrice}
                  />
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

          {/* ── More details: the seller, and whether the money has moved ──
              Closed by default. The everyday purchase needs neither. */}
          {/* Only once a product is known: before that there is no cost, and a
              "paid in full — 0 MRU" sentence would describe nothing. */}
          {scanned?.suggestion && !blocked ? (
            <Card style={styles.more}>
              <ListRow
                flat
                leading={ChevronDown}
                title={t('quick.receive.more')}
                subtitle={supplier ? supplier.name : t('quick.receive.supplier.none')}
                onPress={() => setMoreOpen((v) => !v)}
              />
              {moreOpen ? (
                <View style={styles.fields}>
                  <ListRow
                    leading={Truck}
                    title={supplier ? supplier.name : t('quick.receive.supplier')}
                    subtitle={t('quick.receive.supplier.optional')}
                    onPress={() => setSupplierOpen(true)}
                    value={supplier ? t('action.change') : undefined}
                  />
                  {/*
                    Stated, never implied. With no seller the purchase must be
                    settled in full, and the sentence says why rather than
                    leaving a disabled control unexplained.
                  */}
                  {supplier ? (
                    <ListRow
                      leading={Check}
                      title={paidInFull ? t('quick.receive.paid.yes') : t('quick.receive.paid.no')}
                      subtitle={t('quick.receive.paid.hint')}
                      onPress={() => setPaidInFull((v) => !v)}
                    />
                  ) : (
                    <InlineNotice tone="info">
                      {t('quick.receive.paid.required', {
                        amount: isolateLtr(formatMoney(total)),
                      })}
                    </InlineNotice>
                  )}
                  {supplier ? (
                    <Button
                      title={t('quick.receive.supplier.clear')}
                      variant="tertiary"
                      size="sm"
                      onPress={() => setSupplier(null)}
                    />
                  ) : null}
                </View>
              ) : null}
            </Card>
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
        leadingIcon={Package}
        selectedKeys={scanned?.suggestion ? [scanned.suggestion.productId] : []}
        searchPlaceholder={t('receive.chooseProduct.search')}
        onSearchChange={setProductQuery}
        loading={products.isLoading}
        error={products.error}
        onRetry={() => products.refetch()}
        onSelect={(row: ProductListRow) => void pickProduct(row)}
      />

      {/*
        Choosing a seller is offered; creating one is not required, and no
        placeholder person is ever invented on the user's behalf.
      */}
      <SelectSheet
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        title={t('receive.supplier.title')}
        items={suppliers.data?.rows ?? []}
        keyExtractor={(s: SupplierRow) => s.id}
        labelExtractor={(s: SupplierRow) => s.name}
        descriptionExtractor={(s: SupplierRow) => s.phone ?? undefined}
        leadingIcon={Truck}
        selectedKeys={supplier ? [supplier.id] : []}
        searchPlaceholder={t('receive.supplier.search')}
        loading={suppliers.isLoading}
        error={suppliers.error}
        onRetry={() => suppliers.refetch()}
        onSelect={(s: SupplierRow) => {
          setSupplier(s);
          setSupplierOpen(false);
        }}
      />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { padding: space.base, gap: space.sm, paddingBottom: space['3xl'] },
  fields: { gap: space.md },
  more: { padding: 0, gap: space.sm },
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
