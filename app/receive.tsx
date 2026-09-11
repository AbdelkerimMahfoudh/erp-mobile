import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Package, PackagePlus, Truck } from 'lucide-react-native';
import { Button, EmptyState, Screen, Text } from '../components/ui';
import { IconButton } from '../components/ui/IconButton';
import { SelectSheet } from '../components/overlay';
import { BottomSheet } from '../components/overlay/BottomSheet';
import { ScanTarget } from '../components/scanner';
import type { AcceptedImei } from '../components/scanner/ScannerSheet';
import { ReceiveItemSheet, type ReceiveItemDraft } from '../components/receive/ReceiveItemSheet';
import { StagedItemRow } from '../components/receive/StagedItemRow';
import { stagedCostTotal, stagedUnitTotal, type StagedItem } from '../components/receive/types';
import { TextField } from '../components/ui/Field';
import { ApiError, api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { useAuth } from '../hooks/useAuth';
import {
  holdPendingIntake,
  pendingFrom,
  takePendingIntake,
  type IntakeScope,
} from '../lib/scan/pending-intake';
import {
  codesInDelivery,
  imei2Problem,
  purchaseItems,
  settle,
  withSecondary,
  type PurchaseOutcome,
  type RejectedLine,
} from '../lib/receive-outcome';
import { radius, space } from '../lib/design/tokens';
import { dialog } from '../lib/dialog';
import { toErrorMessage } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { useDraft } from '../lib/offline/use-draft';
import { DraftNotice } from '../components/DraftNotice';
import { InlineNotice } from '../components/ui/InlineNotice';
import { isRTL, isolateLtr } from '../lib/design/direction';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { uuidv4 } from '../lib/utils';
import type {
  ProductListRow,
  ProductPage,
  ProductSuggestion,
  ScanInventoryMatch,
  ScanResult,
  SupplierDetail,
  SupplierPage,
  SupplierRow,
} from '../types/api';
import { makeStyles, useColors } from '../lib/design/theme';

/**
 * Receive — the bulk workflow.
 *
 * Optimised for a delivery rather than a single item: scans group by product,
 * so cost is asked once and every later scan of the same product is appended
 * silently. Twenty identical phones is one question, not twenty.
 *
 * Nothing is committed until the end. `POST /purchases` creates the purchase,
 * the units and one audit entry in a single transaction, and the recognition
 * key from each scan rides along so the scanner learns this shop's stock.
 *
 * ## One phone, one or two IMEIs
 *
 * IMEI 1 is enough. IMEI 2 is optional and belongs to the same unit: it comes
 * from the camera when both were captured, from the cost sheet, or from "Add
 * IMEI 2" on a staged phone. Both are checked against stock BEFORE the phone
 * joins the delivery, both are checked against the delivery itself, and the
 * server checks both again at Finish for anything that changed meanwhile.
 *
 * ## What Finish means
 *
 * Only what the server names as received is counted. A partly refused delivery
 * keeps its refused lines here for correction and drops the received ones, and
 * the next attempt uses a new request key — the old one now belongs to a
 * purchase that exists. A lost response keeps everything locked under the SAME
 * key until "Check again" gets an answer, so a retry replays rather than
 * receiving twice.
 */

/** The server's refusal reasons, in the shop's language. */
const REFUSAL_KEYS = {
  'already registered': 'receive.refused.alreadyRegistered',
  'duplicate in batch': 'receive.refused.duplicateInBatch',
  'invalid secondary IMEI': 'receive.refused.invalidSecondary',
  'secondary IMEI equals primary': 'receive.refused.secondaryEqualsPrimary',
  'secondary IMEI on a product without IMEIs': 'receive.refused.secondaryNotImei',
} as const;

interface PendingScan {
  result: ScanResult;
  suggestion: ProductSuggestion | null;
  /** IMEI 2 captured with this scan. */
  secondary: string | null;
  notice?: { tone: 'warning' | 'danger'; message: string };
  /** Set when either IMEI already belongs to a unit. */
  existing?: ScanInventoryMatch;
}

/** A timeout, a dropped connection or a server fault: the purchase may exist or not. */
function isUncertain(e: unknown): boolean {
  return !(e instanceof ApiError) || e.status >= 500;
}

export default function ReceiveScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const { user } = useAuth();

  /**
   * Who this pending scan belongs to. All three must still match on the way
   * back, so a branch or account switch mid-detour cannot surface it here.
   */
  const scope: IntakeScope | null = useMemo(
    () =>
      user?.companyId && user?.id && branchId
        ? { companyId: user.companyId, userId: user.id, branchId }
        : null,
    [user?.companyId, user?.id, branchId],
  );

  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [staged, setStaged] = useState<StagedItem[]>([]);

  /**
   * One request identity per DELIVERY ATTEMPT THAT MAY HAVE LANDED.
   *
   * Kept across every retry of an unconfirmed Finish, so a lost response is
   * replayed rather than received twice; renewed only once the server has
   * answered and something is left to send. Kept in the draft for the same
   * reason: an app killed mid-Finish must retry under the same key.
   */
  const [clientUuid, setClientUuid] = useState(() => uuidv4());

  /**
   * A receiving session survives an app kill (J.1): the staged phones with both
   * IMEIs, the supplier and the request key. Nothing the server owns is kept —
   * restoring `done` would tell a shop it had received stock it never did.
   */
  const draft = useDraft('receive.preparation', { staged, supplier, clientUuid }, (v) => {
    setStaged(v.staged ?? []);
    setSupplier(v.supplier ?? null);
    if (v.clientUuid) setClientUuid(v.clientUuid);
  });

  const [pending, setPending] = useState<PendingScan | null>(null);
  const [done, setDone] = useState<{ response: PurchaseOutcome; units: number } | null>(null);
  const [refused, setRefused] = useState<RejectedLine[]>([]);
  /** Server-confirmed count from a partly received delivery. */
  const [partialUnits, setPartialUnits] = useState<number | null>(null);
  /** Finish sent, no answer received. Everything is locked until "Check again". */
  const [uncertain, setUncertain] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [imei2Target, setImei2Target] = useState<{ key: string; identifier: string } | null>(null);
  const [imei2Value, setImei2Value] = useState('');
  const [imei2Error, setImei2Error] = useState<string | undefined>();
  const [imei2Checking, setImei2Checking] = useState(false);

  /** The camera's accepted phone, so its IMEI 2 can travel with the scan result. */
  const lastAccepted = useRef<{ primary: string; secondary: string | null } | null>(null);

  const suppliers = useQuery({
    queryKey: [...qk.suppliers, 'active'],
    queryFn: () => api.get<SupplierPage>('/suppliers?status=active&limit=50'),
  });

  const createSupplier = useMutation({
    mutationFn: (name: string) => api.post<SupplierDetail>('/suppliers', { name }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: qk.suppliers });
      setSupplier({ id: created.id, name: created.name, phone: created.phone, isActive: created.isActive });
      setSupplierOpen(false);
      toast.success(created.name);
    },
    onError: (e) => toast.error(toErrorMessage(e)),
  });

  /** Only products that can take this scan: IMEI products for an IMEI, serial for a serial. */
  const pickerKind =
    pending?.result.kind === 'imei' ? 'imei' : pending?.result.kind === 'serial' ? 'serial' : null;
  const products = useQuery({
    queryKey: ['products', 'receive-picker', productQuery, pickerKind],
    queryFn: () => {
      const params = new URLSearchParams({ active: 'active' });
      if (productQuery) params.set('q', productQuery);
      if (pickerKind) params.set('trackingType', pickerKind);
      return api.get<ProductPage>(`/products?${params.toString()}`);
    },
    enabled: pickerOpen,
  });

  const unitTotal = stagedUnitTotal(staged);
  const costTotal = stagedCostTotal(staged);

  // ── Scanning ──────────────────────────────────────────────────────────────

  /** Both IMEIs go to /scan together — they are one phone. */
  const lookUp = useCallback(
    (code: string, secondary: string | null) =>
      api.post<ScanResult>('/scan', { code, ...(secondary ? { secondary } : {}) }),
    [],
  );

  /** Decide what a scan means for this delivery. */
  const route = useCallback(
    (result: ScanResult, secondary: string | null) => {
      const suggestion = result.suggestion;
      const perUnit = result.kind === 'imei' || result.kind === 'serial';

      if (perUnit) {
        // Either number already in this delivery — as anybody's IMEI 1 or IMEI 2.
        const inDelivery = codesInDelivery(staged);
        if (inDelivery.has(result.code) || (secondary && inDelivery.has(secondary))) {
          toast.error(t('receive.inDelivery'));
          return;
        }
        // Already a unit: refused before anybody types a cost.
        if (result.inventory?.alreadyInInventory) {
          setPending({ result, suggestion, secondary, existing: result.inventory });
          return;
        }
      }

      // Unknown code — choose a product or create one.
      if (!suggestion) {
        setPending({ result, suggestion: null, secondary });
        return;
      }

      const serialized = suggestion.trackingType !== 'quantity';

      // A box barcode identifies the model, not the device, so it cannot create units.
      if (serialized && result.kind === 'barcode') {
        setPending({
          result,
          suggestion,
          secondary: null,
          notice: { tone: 'warning', message: t('scanner.manual.placeholder') },
        });
        return;
      }

      const line = staged.find((item) => item.productId === suggestion.productId);

      // Cost already established for this product — append silently.
      if (line) {
        if (serialized) {
          const nextCount = (line.identifiers?.length ?? 0) + 1;
          setStaged((prev) =>
            prev.map((item) =>
              item.key === line.key
                ? {
                    ...item,
                    identifiers: [...(item.identifiers ?? []), result.code],
                    ...(secondary ? { secondaries: { ...(item.secondaries ?? {}), [result.code]: secondary } } : {}),
                  }
                : item,
            ),
          );
          toast.success(t('receive.counted', { label: line.label, count: nextCount }));
        } else {
          const nextCount = (line.quantity ?? 0) + 1;
          setStaged((prev) => prev.map((item) => (item.key === line.key ? { ...item, quantity: nextCount } : item)));
          toast.success(t('receive.counted', { label: line.label, count: nextCount }));
        }
        return;
      }

      // First of this product in the delivery — ask for the cost once.
      setPending({ result, suggestion, secondary });
    },
    [staged, t],
  );

  const onImeiAccepted = useCallback((accepted: AcceptedImei) => {
    lastAccepted.current = { primary: accepted.primary, secondary: accepted.secondary };
  }, []);

  const onScanResult = useCallback(
    async (scanned: ScanResult) => {
      const accepted = lastAccepted.current;
      lastAccepted.current = null;
      const secondary = scanned.kind === 'imei' && accepted?.primary === scanned.code ? accepted.secondary : null;
      let result = scanned;
      if (secondary) {
        // The scanner looked up IMEI 1 alone; ask again with both numbers.
        try {
          result = await lookUp(scanned.code, secondary);
        } catch (e) {
          toast.error(toErrorMessage(e));
          return;
        }
      }
      route(result, secondary);
    },
    [lookUp, route],
  );

  /**
   * Back from Create product — whether it was created or cancelled.
   *
   * Both IMEIs were held across the detour. A created product comes back
   * selected; a cancelled one reopens the same phone, so the user can choose an
   * existing product instead. Creating a product created no inventory: the
   * phone is still only received by Finish.
   */
  useFocusEffect(
    useCallback(() => {
      if (!scope) return;
      const back = takePendingIntake(scope);
      // The device waiting for its product: a phone's IMEI 1, or a serial number.
      const device = back?.primaryImei ?? back?.serial;
      if (!back || !device) return;
      void (async () => {
        try {
          const result = await lookUp(device, back.secondaryImei);
          if (back.createdProductId && !result.inventory?.alreadyInInventory) {
            const created = await api.get<ProductSuggestion>(
              `/products/suggest?productId=${encodeURIComponent(back.createdProductId)}`,
            );
            setPending({ result, suggestion: created, secondary: back.secondaryImei });
            toast.success(t('receive.createdSelected'));
            return;
          }
          route(result, back.secondaryImei);
        } catch (e) {
          toast.error(toErrorMessage(e));
        }
      })();
    }, [scope, lookUp, route, t]),
  );

  const addStaged = (draftItem: ReceiveItemDraft) => {
    if (!pending?.suggestion) return;
    const { suggestion, result } = pending;
    const serialized = suggestion.trackingType !== 'quantity';
    const label = `${suggestion.brand} ${suggestion.model}`;
    const secondary = draftItem.imeiSecondary ?? null;

    setStaged((prev) => [
      ...prev,
      {
        key: uuidv4(),
        productId: suggestion.productId,
        label,
        variant: suggestion.variant,
        trackingType: suggestion.trackingType,
        unitCost: draftItem.unitCost,
        price: draftItem.price,
        ...(serialized
          ? { identifiers: [result.code], ...(secondary ? { secondaries: { [result.code]: secondary } } : {}) }
          : { quantity: draftItem.quantity ?? 1 }),
        recognitionKey: result.recognitionKey,
      },
    ]);
    toast.success(t('receive.added', { label }));
    setPending(null);
  };

  const removeStaged = (key: string) => {
    const removed = staged.find((item) => item.key === key);
    setStaged((prev) => prev.filter((item) => item.key !== key));
    if (removed) {
      toast.success(removed.label, {
        action: { label: t('action.undo'), onPress: () => setStaged((prev) => [...prev, removed]) },
      });
    }
  };

  const pickProduct = async (row: ProductListRow) => {
    setPickerOpen(false);
    try {
      const chosen = await api.get<ProductSuggestion>(`/products/suggest?productId=${encodeURIComponent(row.id)}`);
      setPending((p) =>
        p
          ? {
              ...p,
              suggestion: chosen,
              notice:
                chosen.trackingType !== 'quantity' && p.result.kind === 'barcode'
                  ? { tone: 'warning', message: t('scanner.manual.placeholder') }
                  : undefined,
            }
          : p,
      );
    } catch (e) {
      toast.error(toErrorMessage(e));
    }
  };

  const createProduct = (typedSecondary: string | null) => {
    const current = pending;
    if (!current) return;
    /*
     * The scan must survive the detour, with BOTH IMEIs.
     *
     * Only a GENUINE product barcode is handed to the product form. An IMEI
     * identifies one phone, never a model — putting it in the Product barcode
     * box would poison recognition for every unit of that model.
     */
    const result = current.result;
    const isImei = result.kind === 'imei';
    const barcode = result && result.kind === 'barcode' ? result.code : null;
    if (scope) {
      holdPendingIntake(
        pendingFrom(scope, {
          imei: isImei ? { primary: result.code, secondary: typedSecondary ?? current.secondary } : null,
          serial: result.kind === 'serial' ? result.code : null,
          productBarcode: barcode,
        }),
      );
    }
    setPending(null);
    router.push(barcode ? (`/catalog/new?barcode=${encodeURIComponent(barcode)}` as never) : '/catalog/new');
  };

  // ── IMEI 2 on a staged phone ──────────────────────────────────────────────

  const closeImei2 = () => {
    setImei2Target(null);
    setImei2Value('');
    setImei2Error(undefined);
  };

  const saveImei2 = async () => {
    if (!imei2Target) return;
    const { key, identifier } = imei2Target;
    const problem = imei2Problem(identifier, imei2Value, staged);
    if (problem) {
      setImei2Error(t(`receive.imei2.${problem}` as never));
      return;
    }
    setImei2Checking(true);
    try {
      const check = await lookUp(identifier, imei2Value);
      // IMEI 1 is only staged, not in stock — so a match can only be this number.
      if (check.inventory?.alreadyInInventory) {
        setImei2Error(t('receive.imei2.registered'));
        return;
      }
      setStaged((prev) => withSecondary(prev, key, identifier, imei2Value));
      closeImei2();
    } catch (e) {
      setImei2Error(toErrorMessage(e));
    } finally {
      setImei2Checking(false);
    }
  };

  // ── Commit ────────────────────────────────────────────────────────────────

  const finish = useMutation({
    mutationFn: (lines: StagedItem[]) =>
      api.post<PurchaseOutcome>('/purchases', {
        clientUuid,
        supplierId: supplier!.id,
        items: purchaseItems(lines),
      }),
    onSuccess: (res, lines) => {
      setUncertain(false);
      const outcome = settle(lines, res);
      setRefused(res.rejected ?? []);

      if (outcome.outcome === 'none') {
        // Nothing was written. The delivery stays, unchanged, for correction.
        toast.error(t('receive.refused.none'));
        return;
      }

      qc.invalidateQueries({ queryKey: qk.home(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
      const received = outcome.receivedUnits + outcome.receivedPieces;

      if (outcome.outcome === 'partial') {
        // Received lines leave the phone; refused ones stay for correction. The
        // old key now names a purchase that exists, so the rest needs a new one.
        setStaged(outcome.remaining);
        setPartialUnits(received);
        setClientUuid(uuidv4());
        return;
      }

      setPartialUnits(null);
      setDone({ response: res, units: received });
      setStaged([]);
      draft.clear();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && /already used/i.test(e.message)) {
        void dialog.alert({ title: t('receive.uncertain.title'), message: t('receive.keyConflict') });
        return;
      }
      if (isUncertain(e)) {
        setUncertain(true);
        return;
      }
      toast.error(toErrorMessage(e));
    },
  });

  const confirmLeave = async () => {
    if (staged.length === 0) {
      router.back();
      return;
    }
    const ok = await dialog.confirm({
      title: t('dialog.discard.title'),
      message: t('dialog.discard.body'),
      confirmLabel: t('dialog.discard.confirm'),
      tone: 'danger',
    });
    if (ok) router.back();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (done) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: t('receive.done.title') }} />
        <View style={styles.success}>
          <View style={styles.successBadge}>
            <Check color={colors.intent.success.fg} size={40} />
          </View>
          <Text variant="title" align="center">
            {t('receive.done.title')}
          </Text>
          <Text variant="body" tone="secondary" align="center">
            {t('receive.done.summary', { units: done.units, lines: done.response.stockLines })}
          </Text>
          <Text variant="display" align="center">
            {formatMoney(done.response.total)}
          </Text>
          <RefusedNotice lines={refused} />
          <View style={styles.successActions}>
            <Button
              title={t('receive.done.more')}
              icon={PackagePlus}
              size="lg"
              fullWidth
              onPress={() => {
                // A new delivery is a new logical action, so a new key.
                setClientUuid(uuidv4());
                setRefused([]);
                setDone(null);
              }}
            />
            <Button title={t('action.done')} variant="secondary" fullWidth onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  const existing = pending?.existing;
  const sheetNotice = existing
    ? {
        tone: 'danger' as const,
        message: existing.conflictingUnits
          ? t('receive.existing.conflict')
          : existing.unit
            ? `${t('receive.existing.title')} — ${t('receive.existing.here', {
                product: existing.unit.productLabel,
                branch: existing.unit.branchName,
              })}`
            : t('receive.existing.elsewhere'),
      }
    : pending?.notice;
  const recovery =
    existing?.unit && pending
      ? {
          label: t('receive.existing.open'),
          onPress: () => {
            const identifier = pending.result.code;
            setPending(null);
            router.push({ pathname: '/unit/[identifier]', params: { identifier } });
          },
        }
      : undefined;

  return (
    <>
      <Screen
        scroll={false}
        padded={false}
        header={
          <>
            <Button
              title={supplier ? supplier.name : t('receive.supplier.choose')}
              variant="secondary"
              icon={Truck}
              fullWidth
              disabled={uncertain}
              onPress={() => setSupplierOpen(true)}
            />
            {!uncertain ? (
              <ScanTarget
                onResult={onScanResult}
                onImeiAccepted={onImeiAccepted}
                placeholder={t('receive.scan.placeholder')}
                mode="continuous"
                scannedCount={unitTotal}
              />
            ) : null}
          </>
        }
        footer={
          staged.length > 0 ? (
            <>
              <View style={styles.totals}>
                <Text variant="body" tone="secondary">
                  {t('receive.estimated', { count: unitTotal })}
                </Text>
                <Text variant="title">{formatMoney(costTotal)}</Text>
              </View>
              <Button
                title={uncertain ? t('receive.uncertain.retry') : t('receive.finish')}
                size="lg"
                fullWidth
                loading={finish.isPending}
                disabled={!supplier}
                onPress={() => finish.mutate(staged)}
              />
              {!supplier ? (
                <Text variant="caption" tone="warning" align="center">
                  {t('receive.supplier.needed')}
                </Text>
              ) : null}
            </>
          ) : undefined
        }
      >
        <Stack.Screen
          options={{
            headerShown: true,
            title: t('receive.title'),
            headerBackVisible: false,
            // Arrow only, like every other screen; it still asks before a delivery is left behind.
            headerLeft: () => (
              <IconButton
                icon={isRTL() ? ArrowRight : ArrowLeft}
                accessibilityLabel={t('action.back')}
                onPress={confirmLeave}
              />
            ),
          }}
        />

        {staged.length === 0 && partialUnits === null ? (
          <EmptyState icon={PackagePlus} title={t('receive.empty.title')} body={t('receive.empty.body')} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <DraftNotice draft={draft} onDiscard={() => { setStaged([]); setSupplier(null); }} />
            {uncertain ? (
              <InlineNotice tone="warning" title={t('receive.uncertain.title')}>
                {t('receive.uncertain.body')}
              </InlineNotice>
            ) : null}
            {partialUnits !== null ? (
              <InlineNotice tone="info" title={t('receive.partial.title')}>
                {t('receive.partial.body', { units: partialUnits })}
              </InlineNotice>
            ) : null}
            <RefusedNotice lines={refused} retry={staged.length > 0} />
            {staged.length > 0 ? (
              <Text variant="label" tone="tertiary">
                {t('receive.session')}
              </Text>
            ) : null}
            {staged.map((item) => (
              <StagedItemRow
                key={item.key}
                item={item}
                locked={uncertain || finish.isPending}
                onRemove={removeStaged}
                onAddSecondary={(key, identifier) => setImei2Target({ key, identifier })}
              />
            ))}
          </ScrollView>
        )}
      </Screen>

      <SelectSheet
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        title={t('receive.supplier.title')}
        items={suppliers.data?.rows ?? []}
        keyExtractor={(s) => s.id}
        labelExtractor={(s) => s.name}
        descriptionExtractor={(s) => s.phone ?? undefined}
        leadingIcon={Truck}
        selectedKeys={supplier ? [supplier.id] : []}
        searchPlaceholder={t('receive.supplier.search')}
        loading={suppliers.isLoading}
        error={suppliers.error}
        onRetry={() => suppliers.refetch()}
        onSelect={setSupplier}
        onCreate={(name) => createSupplier.mutate(name)}
        creating={createSupplier.isPending}
      />

      <ReceiveItemSheet
        open={Boolean(pending) && !pickerOpen}
        result={pending?.result ?? null}
        suggestion={pending?.suggestion ?? null}
        secondary={pending?.secondary ?? null}
        notice={sheetNotice}
        recovery={recovery}
        lines={staged}
        onClose={() => setPending(null)}
        onAdd={addStaged}
        onCreateProduct={createProduct}
        onChooseProduct={() => setPickerOpen(true)}
        lookUp={lookUp}
      />

      <SelectSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('receive.chooseProduct.title')}
        items={products.data?.rows ?? []}
        keyExtractor={(p) => p.id}
        labelExtractor={(p) => [p.brand, p.model].filter(Boolean).join(' ')}
        descriptionExtractor={(p) => p.variant ?? undefined}
        leadingIcon={Package}
        selectedKeys={pending?.suggestion ? [pending.suggestion.productId] : []}
        searchPlaceholder={t('receive.chooseProduct.search')}
        onSearchChange={setProductQuery}
        loading={products.isLoading}
        error={products.error}
        onRetry={() => products.refetch()}
        onSelect={(row) => void pickProduct(row)}
      />

      <BottomSheet
        open={Boolean(imei2Target)}
        onClose={closeImei2}
        title={imei2Target ? t('receive.imei2.title', { imei: imei2Target.identifier }) : undefined}
      >
        <View style={styles.imei2}>
          <TextField
            label={t('receive.imei2.label')}
            hint={t('receive.imei2.hint')}
            value={imei2Value}
            onChangeText={(text) => {
              setImei2Value(text.replace(/[^0-9]/g, '').slice(0, 15));
              setImei2Error(undefined);
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={15}
            error={imei2Error}
          />
          <Button
            title={t('receive.imei2.save')}
            fullWidth
            loading={imei2Checking}
            disabled={imei2Value.length !== 15}
            onPress={() => void saveImei2()}
          />
        </View>
      </BottomSheet>
    </>
  );
}

/** Each refused phone with its reason, in words. Renders nothing when empty. */
function RefusedNotice({ lines, retry = false }: { lines: RejectedLine[]; retry?: boolean }) {
  const { t } = useTranslation();
  if (lines.length === 0) return null;
  const body = lines
    .map((line) => {
      const key = REFUSAL_KEYS[line.reason as keyof typeof REFUSAL_KEYS] ?? 'receive.refused.other';
      const ids = line.secondary ? `${isolateLtr(line.identifier)} / ${isolateLtr(line.secondary)}` : isolateLtr(line.identifier);
      return `${ids} — ${t(key)}`;
    })
    .join('\n');
  return (
    <InlineNotice tone="danger" title={t('receive.refused.title')}>
      {retry ? `${body}\n${t('receive.refused.retry')}` : body}
    </InlineNotice>
  );
}

const useStyles = makeStyles((colors) => ({
  list: {
    padding: space.base,
    gap: space.sm,
    paddingBottom: space['3xl'],
  },
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
    borderRadius: radius.full,
    backgroundColor: colors.intent.success.bg,
  },
  successActions: {
    width: '100%',
    maxWidth: 380,
    gap: space.sm,
    marginTop: space.lg,
  },
  imei2: {
    gap: space.md,
  },
}));
