import React, { useCallback, useState, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, PackagePlus, Truck } from 'lucide-react-native';
import { Button, EmptyState, Screen, Text } from '../components/ui';
import { SelectSheet } from '../components/overlay';
import { ScanTarget } from '../components/scanner';
import { ReceiveItemSheet, type ReceiveItemDraft } from '../components/receive/ReceiveItemSheet';
import { StagedItemRow } from '../components/receive/StagedItemRow';
import { stagedCostTotal, stagedUnitTotal, type StagedItem } from '../components/receive/types';
import { api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { colors } from '../lib/design/colors';
import { radius, space } from '../lib/design/tokens';
import { dialog } from '../lib/dialog';
import { toErrorMessage } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { useDraft } from '../lib/offline/use-draft';
import { DraftNotice } from '../components/DraftNotice';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { uuidv4 } from '../lib/utils';
import type { ProductSuggestion, ScanResult, SupplierDetail, SupplierPage, SupplierRow } from '../types/api';

/**
 * Receive — the bulk workflow.
 *
 * Optimised for a delivery rather than a single item: scans group by product,
 * so cost is asked once and every later scan of the same product is appended
 * silently. Twenty identical phones is one question, not twenty.
 *
 * Nothing is committed until the end. `POST /purchases` creates the purchase,
 * the units and one audit entry in a single transaction, and the recognition
 * key from each scan rides along so the scanner learns this shop's stock —
 * receiving is the strongest learning signal the system gets.
 */

interface PurchaseResponse {
  unitsCreated: number;
  stockLines: number;
  total: number;
}

interface PendingScan {
  result: ScanResult;
  suggestion: ProductSuggestion | null;
  notice?: { tone: 'warning' | 'danger'; message: string };
}

export default function ReceiveScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { branchId } = useBranch();

  // The picker now yields a SupplierRow (the paged list shape), which carries
  // everything receiving needs: id, name and phone.
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [staged, setStaged] = useState<StagedItem[]>([]);

  /**
   * A receiving session survives an app kill (J.1).
   *
   * Scanning twenty phones into a delivery is minutes of work, and losing it
   * to Android's memory manager is exactly what sends somebody back to the
   * notebook. The staged list and the chosen supplier are kept.
   *
   * Nothing the server owns is: the pending in-flight scan is transient, and
   * `done` is a completed purchase — restoring that would tell a shop it had
   * received stock it never did.
   */
  const draft = useDraft('receive.preparation', { staged, supplier }, (v) => {
    setStaged(v.staged ?? []);
    setSupplier(v.supplier ?? null);
  });
  const [pending, setPending] = useState<PendingScan | null>(null);
  /**
   * The summary is built from what was staged, not from the API response.
   *
   * `unitsCreated` counts `Unit` rows, which is zero for quantity-tracked
   * products — they only bump a stock total. Reporting that verbatim tells an
   * employee who just counted six power banks that zero arrived.
   */
  const [done, setDone] = useState<{ response: PurchaseResponse; units: number } | null>(null);

  /**
   * One request identity per DELIVERY, not per attempt.
   *
   * Generated once when the session starts and reused across every retry —
   * including an eventual offline replay — so a timeout cannot receive the same
   * delivery twice. Regenerated only when a new delivery begins. Same
   * convention as Sell.
   */
  const clientUuid = useRef(uuidv4());

  /**
   * ACTIVE suppliers only (J1).
   *
   * Receiving must not offer a supplier the shop has stopped buying from, while
   * every past delivery keeps showing the one it was actually bought from. The
   * list is also paged now, so this reads `rows` rather than the bare array it
   * used to return - a change TypeScript could not catch, because `api.get<T>`
   * is an assertion rather than a check.
   */
  const suppliers = useQuery({
    queryKey: [...qk.suppliers, 'active'],
    queryFn: () => api.get<SupplierPage>('/suppliers?status=active&limit=50'),
  });

  const createSupplier = useMutation({
    // POST /suppliers returns the full detail; the picker only needs the row.
    mutationFn: (name: string) => api.post<SupplierDetail>('/suppliers', { name }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: qk.suppliers });
      setSupplier({ id: created.id, name: created.name, phone: created.phone, isActive: created.isActive });
      setSupplierOpen(false);
      toast.success(created.name);
    },
    onError: (e) => toast.error(toErrorMessage(e)),
  });

  const unitTotal = stagedUnitTotal(staged);
  const costTotal = stagedCostTotal(staged);

  // ── Scanning ──────────────────────────────────────────────────────────────

  const onScanResult = useCallback(
    (result: ScanResult) => {
      const suggestion = result.suggestion;

      // Unknown code — there is nothing to receive against until the product
      // template exists.
      if (!suggestion) {
        setPending({ result, suggestion: null });
        return;
      }

      const serialized = suggestion.trackingType !== 'quantity';

      // A serialized product must be scanned by its own identifier: each scan
      // becomes one physical unit. A box barcode identifies the model, not the
      // device, so it cannot create units.
      if (serialized && result.kind === 'barcode') {
        setPending({
          result,
          suggestion,
          notice: { tone: 'warning', message: t('scanner.manual.placeholder') },
        });
        return;
      }

      const existing = staged.find((item) => item.productId === suggestion.productId);

      // Cost already established for this product — append silently. This is
      // the fast path that makes receiving a delivery quick.
      if (existing) {
        if (serialized) {
          if (existing.identifiers?.includes(result.code)) {
            toast.error(t('sell.alreadyInCart'));
            return;
          }
          const nextCount = (existing.identifiers?.length ?? 0) + 1;
          setStaged((prev) =>
            prev.map((item) =>
              item.key === existing.key
                ? { ...item, identifiers: [...(item.identifiers ?? []), result.code] }
                : item,
            ),
          );
          toast.success(t('receive.counted', { label: existing.label, count: nextCount }));
        } else {
          const nextCount = (existing.quantity ?? 0) + 1;
          setStaged((prev) =>
            prev.map((item) =>
              item.key === existing.key ? { ...item, quantity: nextCount } : item,
            ),
          );
          toast.success(t('receive.counted', { label: existing.label, count: nextCount }));
        }
        return;
      }

      // First of this product in the delivery — ask for the cost once.
      setPending({ result, suggestion });
    },
    [staged, t],
  );

  const addStaged = (draft: ReceiveItemDraft) => {
    if (!pending?.suggestion) return;
    const { suggestion, result } = pending;
    const serialized = suggestion.trackingType !== 'quantity';
    const label = `${suggestion.brand} ${suggestion.model}`;

    setStaged((prev) => [
      ...prev,
      {
        key: uuidv4(),
        productId: suggestion.productId,
        label,
        variant: suggestion.variant,
        trackingType: suggestion.trackingType,
        unitCost: draft.unitCost,
        price: draft.price,
        ...(serialized ? { identifiers: [result.code] } : { quantity: draft.quantity ?? 1 }),
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
        action: {
          label: t('action.undo'),
          onPress: () => setStaged((prev) => [...prev, removed]),
        },
      });
    }
  };

  // ── Commit ────────────────────────────────────────────────────────────────

  const finish = useMutation({
    mutationFn: () =>
      api.post<PurchaseResponse>('/purchases', {
        clientUuid: clientUuid.current,
        supplierId: supplier!.id,
        items: staged.map((item) => ({
          productId: item.productId,
          unitCost: item.unitCost,
          ...(item.price !== undefined ? { price: item.price } : {}),
          ...(item.trackingType === 'quantity'
            ? { quantity: item.quantity }
            : { identifiers: item.identifiers }),
          ...(item.recognitionKey ? { recognitionKey: item.recognitionKey } : {}),
        })),
      }),
    onSuccess: (res) => {
      setDone({ response: res, units: unitTotal });
      setStaged([]);
      draft.clear();
      qc.invalidateQueries({ queryKey: qk.home(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
    },
    onError: (e) => toast.error(toErrorMessage(e)),
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
          <View style={styles.successActions}>
            <Button
              title={t('receive.done.more')}
              icon={PackagePlus}
              size="lg"
              fullWidth
              onPress={() => {
                // A new delivery is a new logical action, so a new key.
                clientUuid.current = uuidv4();
                setDone(null);
              }}
            />
            <Button
              title={t('action.done')}
              variant="secondary"
              fullWidth
              onPress={() => router.back()}
            />
          </View>
        </View>
      </Screen>
    );
  }

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
              onPress={() => setSupplierOpen(true)}
            />
            <ScanTarget
              onResult={onScanResult}
              placeholder={t('receive.scan.placeholder')}
              mode="continuous"
              scannedCount={unitTotal}
              autoFocus
            />
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
                title={t('receive.finish')}
                size="lg"
                fullWidth
                loading={finish.isPending}
                disabled={!supplier}
                onPress={() => finish.mutate()}
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
            headerLeft: () => (
              <Button
                title={t('action.back')}
                variant="tertiary"
                size="sm"
                onPress={confirmLeave}
              />
            ),
          }}
        />

        {staged.length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title={t('receive.empty.title')}
            body={t('receive.empty.body')}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            <DraftNotice draft={draft} onDiscard={() => { setStaged([]); setSupplier(null); }} />
            <Text variant="label" tone="tertiary">
              {t('receive.session')}
            </Text>
            {staged.map((item) => (
              <StagedItemRow key={item.key} item={item} onRemove={removeStaged} />
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
        open={Boolean(pending)}
        result={pending?.result ?? null}
        suggestion={pending?.suggestion ?? null}
        notice={pending?.notice}
        onClose={() => setPending(null)}
        onAdd={addStaged}
        onCreateProduct={() => {
          setPending(null);
          router.push('/catalog/new');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
});
