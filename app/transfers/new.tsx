import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { PackageSearch, ScanLine, Trash2 } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  EmptyState,
  Identifier,
  RowGroup,
  Screen,
  SearchInput,
  Section,
  SegmentedControl,
  Stepper,
  Text,
  TextField,
} from '../../components/ui';
import { ScannerSheet } from '../../components/scanner';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import { useTranslation, type TranslationKey, type TranslationValues } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import {
  addStockToDraft,
  addUnitToDraft,
  canSubmitDraft,
  countDraft,
  draftToBody,
  hasUnsavedDraft,
  isStockLine,
  isUnitLine,
  removeStockFromDraft,
  removeUnitFromDraft,
  setLineQuantity,
  submitIntent,
  type DraftLine,
  type StockCandidate,
} from '../../lib/transfer-draft';
import { transferProblems, useCreateTransfer } from '../../lib/transfers';
import type { InventoryPage, InventoryStockRow, UserBranch } from '../../types/api';

/**
 * Request a transfer — scan first, type as a fallback.
 *
 * Phones and accessories in one draft (H1.4). They behave differently on
 * purpose: a phone is one object named by its IMEI, so scanning it twice is a
 * mistake worth reporting; an accessory is a count, so scanning the same box
 * twice means two of them and the line simply grows.
 *
 * The request id is minted once when the draft begins and reused for every
 * retry. That is the whole reason a timeout here is safe: the server recognises
 * the replay and returns the original transfer instead of moving stock twice.
 *
 * No cost, margin or selling price appears anywhere on this screen. Moving
 * stock between your own branches is not a pricing decision.
 */
export default function NewTransferScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { branchId, branchName } = useBranch();
  const branches = useQuery({
    queryKey: qk.branches,
    queryFn: () => api.get<UserBranch[]>('/auth/branches'),
  });
  const create = useCreateTransfer();
  const canApproveHere = usePermission('transfer.approve');

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [toBranchId, setToBranchId] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [scanning, setScanning] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [search, setSearch] = useState('');

  const requestId = useRef<string>(uuidv4());

  /** Every other branch in the company — a transfer to yourself is a 400. */
  const destinations = useMemo(
    () => (branches.data ?? []).filter((b) => b.id !== branchId),
    [branches.data, branchId],
  );

  /**
   * Accessories at THIS branch, searched on the server.
   *
   * The inventory contract already returns physical, reserved and available per
   * stock row, so the picker asks the same question the till does rather than
   * inventing a second answer.
   */
  const accessories = useQuery({
    queryKey: [...qk.inventory(branchId), 'transfer-pick', search],
    enabled: search.trim().length > 1,
    queryFn: () =>
      api.get<InventoryPage>(`/inventory?search=${encodeURIComponent(search.trim())}&limit=20`),
  });

  const stockRows = useMemo(
    () => ((accessories.data?.rows ?? []) as (InventoryStockRow | { kind: 'unit' })[])
      .filter((r): r is InventoryStockRow => r.kind === 'stock'),
    [accessories.data],
  );

  const counts = countDraft(lines);
  const intent = submitIntent(canApproveHere);
  const canSubmit = canSubmitDraft({ lines, toBranchId, fromBranchId: branchId });
  const dirty = hasUnsavedDraft(lines, submitted);

  const leave = async () => {
    if (!dirty) {
      router.back();
      return;
    }
    const ok = await dialog.confirm({
      title: t('transfers.new.discard.title'),
      message: t('transfers.new.discard.body', { count: summaryText(counts, t) }),
      confirmLabel: t('transfers.new.discard.confirm'),
      cancelLabel: t('transfers.new.keep'),
      tone: 'danger',
    });
    if (ok) router.back();
  };

  const addUnit = (identifier: string, product?: string | null) => {
    const result = addUnitToDraft(lines, identifier, { product });
    if (result.ok) {
      void haptics.success();
      setLines(result.lines);
      setTyped('');
      return;
    }
    void haptics.error();
    if (result.reason === 'duplicate') toast.error(t('transfers.new.duplicate'));
    else toast.error(t('transfers.new.blank'));
  };

  const addStock = (candidate: StockCandidate, amount = 1) => {
    const result = addStockToDraft(lines, candidate, amount);
    if (result.ok) {
      void haptics.success();
      setLines(result.lines);
      // Say what happened. A count that changed somewhere further down the
      // screen, with no acknowledgement, reads as a scan that did nothing.
      toast.success(
        result.merged
          ? t('transfers.new.merged', { product: candidate.product })
          : t('transfers.new.added', { product: candidate.product }),
      );
      return;
    }
    void haptics.error();
    if (result.reason === 'none_available') {
      toast.error(t('transfers.new.noneAvailable', { product: candidate.product }));
    } else {
      toast.error(
        t('transfers.new.overAvailable', {
          product: candidate.product,
          available: candidate.availableQuantity,
        }),
      );
    }
  };

  const toCandidate = (row: InventoryStockRow): StockCandidate => ({
    productId: row.productId,
    product: productLabel(row),
    variant: row.product?.variant ?? null,
    barcode: row.product?.barcode ?? null,
    physicalQuantity: row.quantity,
    reservedQuantity: row.reservedQuantity,
    availableQuantity: row.availableQuantity,
  });

  /**
   * A scan resolves to either a phone or an accessory.
   *
   * An accessory barcode is looked up at this branch so the exact variant and
   * its availability are known before it joins the draft. If the code matches
   * more than one row, the picker is shown rather than a guess being made.
   */
  const onScan = async (code: string, suggestion: { trackingType?: string | null; brand?: string; model?: string; variant?: string | null } | null) => {
    if (!code) return;
    if (suggestion?.trackingType && suggestion.trackingType !== 'quantity') {
      addUnit(code, [suggestion.brand, suggestion.model, suggestion.variant].filter(Boolean).join(' '));
      return;
    }
    try {
      const page = await api.get<InventoryPage>(
        `/inventory?search=${encodeURIComponent(code)}&limit=5`,
      );
      const matches = (page.rows as (InventoryStockRow | { kind: 'unit' })[]).filter(
        (r): r is InventoryStockRow => r.kind === 'stock',
      );
      if (matches.length === 1) {
        addStock(toCandidate(matches[0]));
        return;
      }
      if (matches.length > 1) {
        // Ambiguous: show the list rather than pick one. Guessing which variant
        // somebody scanned is how the wrong thing gets sent.
        setSearch(code);
        void dialog.alert({
          title: t('transfers.new.ambiguous'),
          message: t('transfers.new.ambiguousBody'),
        });
        return;
      }
      // No accessory row: treat it as a serialized identifier and let the
      // server give the final answer.
      addUnit(code, null);
    } catch {
      addUnit(code, null);
    }
  };

  const submit = async () => {
    if (!canSubmit || create.isPending) return;
    try {
      const result = await create.mutateAsync({
        clientUuid: requestId.current,
        toBranchId: toBranchId!,
        lines: draftToBody(lines),
      });
      setSubmitted(true);
      toast.success(t('transfers.new.created', { ref: result.transferNo ?? '' }));
      router.replace(`/transfers/${result.id}` as never);
    } catch (error) {
      /**
       * Per-item refusals are shown as themselves. "Some items cannot be sent"
       * is not actionable; "356938035643809 is sold" and "only 4 cables left"
       * are.
       */
      const problems = transferProblems(error);
      if (problems.length > 0) {
        await dialog.alert({
          title: t('transfers.new.problems'),
          message: problems.map((p) => `${p.label} — ${p.reason}`).join('\n'),
        });
        return;
      }
      toast.error(toFriendlyError(error).body);
      // The request id is deliberately NOT regenerated: the next attempt is a
      // retry of this one, and must resolve to the same transfer if the first
      // actually reached the server.
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t('transfers.new') }} />

      <Section title={t('transfers.new.from')}>
        <Card>
          {/* The source is the active branch, always, and is stated rather than chosen. */}
          <Text variant="bodyStrong">{branchName ?? '—'}</Text>
        </Card>
      </Section>

      <Section title={t('transfers.new.to')}>
        <Card>
          {destinations.length === 0 ? (
            <Text tone="secondary">{t('transfers.new.sameBranch')}</Text>
          ) : (
            <SegmentedControl
              options={destinations.map((b) => ({ value: b.id, label: b.name }))}
              value={toBranchId ?? ''}
              onChange={setToBranchId}
            />
          )}
          {!toBranchId ? (
            <Text variant="caption" tone="tertiary" style={styles.gapTop}>
              {t('transfers.new.chooseDestination')}
            </Text>
          ) : null}
        </Card>
      </Section>

      <Section>
        <Card>
          <Text tone="secondary">{t('transfers.new.howTo')}</Text>
          <Button
            title={t('transfers.new.scan')}
            icon={ScanLine}
            onPress={() => setScanning(true)}
            style={styles.gapTop}
          />
        </Card>
      </Section>

      {/* Manual entry is not a fallback for failure; it is always available —
          for a phone that will not power on, and a camera that will not focus. */}
      <Section title={t('transfers.new.manual')}>
        <Card>
          <TextField
            value={typed}
            onChangeText={setTyped}
            keyboardType="number-pad"
            autoCorrect={false}
            placeholder="356938035643809"
            returnKeyType="done"
            onSubmitEditing={() => addUnit(typed)}
          />
          <Button
            title={t('action.add')}
            variant="secondary"
            disabled={typed.trim().length === 0}
            onPress={() => addUnit(typed)}
            style={styles.gapTop}
          />
        </Card>
      </Section>

      <Section title={t('transfers.new.findAccessory')} subtitle={t('transfers.new.findAccessoryHint')}>
        <Card>
          <SearchInput value={search} onChangeText={setSearch} placeholder={t('transfers.new.searchPlaceholder')} />
          {search.trim().length > 1 && stockRows.length === 0 && !accessories.isLoading ? (
            <Text variant="caption" tone="tertiary" style={styles.gapTop}>
              {t('transfers.new.noAccessories')}
            </Text>
          ) : null}
          <View style={styles.results}>
            {stockRows.map((row) => (
              <View key={row.id} style={styles.result}>
                <View style={styles.itemBody}>
                  <Text variant="bodyStrong">{productLabel(row)}</Text>
                  {/* All three numbers, named. "Available" alone hides why. */}
                  <Text variant="caption" tone="secondary">
                    {t('transfers.new.stockLine', {
                      physical: row.quantity,
                      reserved: row.reservedQuantity,
                      available: row.availableQuantity,
                    })}
                  </Text>
                </View>
                <Button
                  title={t('action.add')}
                  variant="secondary"
                  size="sm"
                  icon={PackageSearch}
                  disabled={row.availableQuantity <= 0}
                  onPress={() => addStock(toCandidate(row))}
                />
              </View>
            ))}
          </View>
        </Card>
      </Section>

      <Section title={t('transfers.new.items')} subtitle={lines.length > 0 ? summaryText(counts, t) : undefined}>
        {lines.length === 0 ? (
          <EmptyState
            size="inline"
            title={t('transfers.new.noItems')}
            body={t('transfers.new.noItemsBody')}
          />
        ) : (
          /*
           * The review list: repeated records, so one grouped surface with
           * hairlines. Each selected phone used to be its own bordered card,
           * which made a transfer of fifteen handsets read as fifteen unrelated
           * decisions rather than as one list to check before sending.
           *
           * The form STEPS above keep their own surfaces — one per step, not
           * one per input — because they are stages of a task, not records.
           */
          <RowGroup separatorInset={space.md}>
            {lines.filter(isUnitLine).map((item) => (
              <View key={item.identifier} style={styles.groupedRow}>
                <View style={styles.item}>
                  <View style={styles.itemBody}>
                    {/* The exact thing, shown before it is sent anywhere. */}
                    <Text variant="bodyStrong">{item.product ?? '—'}</Text>
                    <Identifier>{item.identifier}</Identifier>
                  </View>
                  <Button
                    title={t('action.remove')}
                    icon={Trash2}
                    variant="tertiary"
                    size="sm"
                    onPress={() => setLines(removeUnitFromDraft(lines, item.identifier))}
                  />
                </View>
              </View>
            ))}

            {lines.filter(isStockLine).map((line) => (
              <View key={line.productId} style={styles.groupedRow}>
                <View style={styles.itemBody}>
                  <Text variant="bodyStrong">{line.product}</Text>
                  <Text variant="caption" tone="secondary">
                    {t('transfers.new.stockLine', {
                      physical: line.physicalQuantity,
                      reserved: line.reservedQuantity,
                      available: line.availableQuantity,
                    })}
                  </Text>
                </View>
                <View style={[styles.item, styles.gapTop]}>
                  <Stepper
                    value={line.quantity}
                    min={1}
                    max={line.availableQuantity}
                    accessibilityLabel={t('transfers.new.quantity')}
                    onChange={(next) => setLines(setLineQuantity(lines, line.productId, next))}
                  />
                  {/* Typing beats tapping plus forty times. */}
                  <TextField
                    value={String(line.quantity)}
                    onChangeText={(v) =>
                      setLines(setLineQuantity(lines, line.productId, Number(v.replace(/[^0-9]/g, '')) || 0))
                    }
                    keyboardType="number-pad"
                  />
                  <Button
                    title={t('action.remove')}
                    icon={Trash2}
                    variant="tertiary"
                    size="sm"
                    onPress={() => setLines(removeStockFromDraft(lines, line.productId))}
                  />
                </View>
              </View>
            ))}
          </RowGroup>
        )}
      </Section>

      <Section>
        <Card>
          {/* Say what the button will do BEFORE it is pressed. A manager's
              request is born approved; an employee's waits for someone. */}
          <Text tone="secondary">
            {t(intent === 'creates_approved' ? 'transfers.new.note.approved' : 'transfers.new.note.awaits')}
          </Text>
          <Button
            title={t(
              intent === 'creates_approved'
                ? 'transfers.new.submit.approved'
                : 'transfers.new.submit.awaits',
            )}
            disabled={!canSubmit}
            loading={create.isPending}
            onPress={submit}
            style={styles.gapTop}
          />
          <Button
            title={t('action.cancel')}
            variant="tertiary"
            onPress={leave}
            style={styles.gapTop}
          />
        </Card>
      </Section>

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        hint={t('transfers.new.howTo')}
        onResult={(result) => {
          setScanning(false);
          void onScan(result.code ?? '', result.suggestion ?? null);
        }}
      />
    </Screen>
  );
}

/** "2 phones · 10 accessories", in the shop's language and grammar. */
export function summaryText(
  counts: { unitCount: number; totalQuantity: number; quantityLineCount: number },
  t: (key: TranslationKey, vars?: TranslationValues) => string,
): string {
  const accessories = counts.totalQuantity - counts.unitCount;
  const parts: string[] = [];
  if (counts.unitCount > 0) parts.push(t('transfers.summary.units' as never, { count: counts.unitCount }));
  if (accessories > 0) parts.push(t('transfers.summary.accessories' as never, { count: accessories }));
  return parts.join(' · ');
}

function productLabel(row: InventoryStockRow): string {
  const p = row.product;
  if (!p) return '—';
  return [p.brand, p.model, p.variant].filter(Boolean).join(' ');
}

const styles = StyleSheet.create({
  gapTop: { marginTop: space.sm },
  groupedRow: { padding: space.md },
  items: { gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  itemBody: { flex: 1, gap: space.xs },
  results: { gap: space.sm, marginTop: space.sm },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
