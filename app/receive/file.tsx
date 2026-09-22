import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, View, type ListRenderItem } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react-native';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  FilterChip,
  IconButton,
  InlineNotice,
  ListRow,
  MoneyField,
  RowGroup,
  Screen,
  Text,
} from '../../components/ui';
import { BottomSheet } from '../../components/overlay/BottomSheet';
import {
  PurchasePaymentPicker,
  purchasePaymentBody,
  purchasePaymentReady,
  type PurchasePayment,
} from '../../components/receive/PurchasePaymentPicker';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { invalidateMoney } from '../../lib/money-invalidation';
import { useDraft } from '../../lib/offline/use-draft';
import { DraftNotice } from '../../components/DraftNotice';
import { useFileBatch } from '../../lib/file-batch-store';
import {
  batchCounts,
  batchFingerprint,
  canConfirm,
  effectiveCost,
  entryState,
  groupCandidates,
  groupEntries,
  previewBulkCost,
  purchaseItems,
  reviewComplete,
  type CatalogueProduct,
  type EntryGroup,
  type EntryState,
  type FileEntry,
  type SourceRef,
} from '../../lib/file-receiving';
import { groupSummaries, reviewRows, toggleOpenGroup, type ReviewFilter, type ReviewRowData } from '../../lib/file-review-rows';
import type { PurchaseOutcome } from '../../lib/receive-outcome';

/**
 * Reviewing a delivery read out of a file.
 *
 * Nothing has been received at this point — the file was only read. This screen
 * is where a person sees every phone, fixes what is wrong, deliberately excludes
 * what they will not take, and only then buys the rest.
 *
 * ## Why it is staged
 *
 * A hundred phones do not fit on a phone screen, and the first version put the
 * whole payment section under a list where nothing was ready to pay for yet: the
 * shop was asked how it would like to pay before it had been told what was
 * wrong. Review and payment are now two steps. Payment appears only once every
 * phone is either corrected or deliberately excluded, and until then a compact
 * footer carries the only numbers that matter — how many are ready, how many are
 * out, and what the ready ones cost.
 *
 * ## Why groups come first, and why the list is flat
 *
 * A hundred rows of the same iPhone with the same missing product are one
 * decision, not a hundred. The list shows one collapsed header per exact variant
 * with its count, its subtotal and the reason it is held up, and a group whose
 * every problem is the same product question can be matched once for all of
 * them.
 *
 * The list itself is ONE virtualized sequence — group headers, then the rows of
 * the single open group — built by `reviewRows`. The earlier shape, a card per
 * group mapping its own rows inside itself, meant the open group was one list
 * item however many rows it held, and any correction re-rendered every card
 * because each received the whole batch. Rows now receive only the primitives
 * they show, and re-render only when those change: correcting one phone in a
 * hundred re-renders that phone.
 *
 * Three rules it exists to keep:
 *
 * 1. **Nothing is received quietly.** A phone with a problem must be corrected
 *    or excluded; the app never receives "the good rows" and drops the rest.
 * 2. **The file's own words are never overwritten.** A correction sits beside
 *    what was extracted, and a bulk edit says how many phones it will change —
 *    and how many already say something different — before it changes them.
 * 3. **Confirmation is an ordinary purchase**, paid in full through
 *    `POST /purchases`, with a key bound to exactly what is being received — so
 *    a double tap or a retry after a timeout returns the same receipt instead of
 *    buying the delivery twice.
 */

type Step = 'review' | 'payment';

export default function FileReviewScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { branchId, branchName } = useBranch();
  const batch = useFileBatch((s) => s.batch);
  const correct = useFileBatch((s) => s.correct);
  const correctMany = useFileBatch((s) => s.correctMany);
  const setExcluded = useFileBatch((s) => s.setExcluded);
  const excludeMany = useFileBatch((s) => s.excludeMany);
  const setAcknowledged = useFileBatch((s) => s.setAcknowledged);
  const clear = useFileBatch((s) => s.clear);
  const restore = useFileBatch((s) => s.restore);

  const [step, setStep] = useState<Step>('review');
  const [filter, setFilter] = useState<ReviewFilter>('all');
  /**
   * The one open group, by key — never more than one.
   *
   * A hundred phones do not fit on a screen, and a file of two thousand must
   * cost no more to scroll than one of ten. Only the open group's phones are in
   * the list at all, and opening a group closes whichever was open, so the
   * number of mounted rows never grows with the delivery.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [payment, setPayment] = useState<PurchasePayment>({ method: 'cash', receivingAccountId: null });
  const [editing, setEditing] = useState<FileEntry | null>(null);
  const [matching, setMatching] = useState<EntryGroup | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCost, setBulkCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ units: number; total: number } | null>(null);

  /**
   * The batch survives the app being closed.
   *
   * Scoped to this person, company and branch by the shared draft mechanism, so
   * a half-checked delivery is still there tomorrow — and it is a SEPARATE key
   * from the scanned delivery's draft, which is left exactly as it was. It is
   * written when the batch changes — a correction, an exclusion — and never
   * while the list merely scrolls or re-renders.
   */
  const draft = useDraft('receive.file', batch, (saved) => { if (saved?.parsed) restore(saved); }, { enabled: !done });

  // Everything derived from the batch is computed once per change, not once per
  // render and never once per row.
  const counts = useMemo(() => (batch ? batchCounts(batch) : null), [batch]);
  const groups = useMemo(() => (batch ? groupEntries(batch) : []), [batch]);
  const summaries = useMemo(() => (batch ? groupSummaries(batch, groups) : new Map()), [batch, groups]);
  const rows = useMemo(() => (batch ? reviewRows(batch, groups, summaries, openKey, filter) : []), [batch, groups, summaries, openKey, filter]);
  const items = useMemo(() => (batch ? purchaseItems(batch) : []), [batch]);
  /** Bound to the payload: editing the batch changes the key, so a stale replay cannot answer. */
  const clientUuid = useMemo(
    () => (batch ? batchFingerprint(items, { method: payment.method, receivingAccountId: payment.receivingAccountId }) : ''),
    [batch, items, payment.method, payment.receivingAccountId],
  );
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const receive = useMutation({
    mutationFn: () =>
      api.post<PurchaseOutcome>('/purchases', {
        clientUuid,
        ...purchasePaymentBody(payment),
        items: items.map((i) => ({ productId: i.productId, unitCost: i.unitCost, units: i.units })),
      }),
    onSuccess: (outcome) => {
      if (!outcome.purchaseId || outcome.unitsCreated === 0) {
        setError(outcome.rejected?.[0]?.reason ?? t('receive.refused.none'));
        return;
      }
      qc.invalidateQueries({ queryKey: qk.home(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventoryValue(branchId) });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: qk.openClosing(branchId, 'today') });
      invalidateMoney(qc);
      setDone({ units: outcome.unitsCreated, total: outcome.total });
      clear();
    },
    onError: (e) => setError(toErrorMessage(e)),
  });

  const toggleGroup = useCallback((key: string) => {
    setOpenKey((current) => toggleOpenGroup(current, key));
  }, []);

  const matchGroupByKey = useCallback((key: string) => {
    const group = groupsRef.current.find((g) => g.key === key);
    if (group) setMatching(group);
  }, []);

  /**
   * The three per-row actions, as stable callbacks keyed by the row, so a
   * memoised row does not re-render when an unrelated one changes. Each reads
   * the live batch from the store rather than closing over it, which keeps the
   * callback identity fixed.
   */
  const entryOf = (key: string): FileEntry | null =>
    useFileBatch.getState().batch?.parsed.entries.find((e) => e.key === key) ?? null;

  const acceptEntry = useCallback(
    async (key: string) => {
      const live = useFileBatch.getState().batch;
      const entry = entryOf(key);
      if (!live || !entry) return;
      const product = [entry.extracted.brand, entry.extracted.model].filter(Boolean).join(' ') || t('fileReceive.noIdentifier');
      const identifier = entry.extracted.imei1 ?? entry.extracted.serial ?? t('fileReceive.noIdentifier');
      const cost = effectiveCost(live, entry);
      const detail = [identifier, cost !== null ? formatMoney(cost) : null].filter(Boolean).join('  ·  ');
      const ok = await dialog.confirm({
        title: product,
        message: `${detail}\n\n${t('fileReceive.accept.body')}`,
        confirmLabel: t('fileReceive.accept'),
      });
      if (ok) setAcknowledged(key, true);
    },
    [t, setAcknowledged],
  );

  const removeEntry = useCallback(
    async (key: string) => {
      const live = useFileBatch.getState().batch;
      const entry = entryOf(key);
      if (!live || !entry) return;
      // Restoring is not destructive, so it needs no speed bump.
      if (entryState(live, entry) === 'excluded') {
        setExcluded(key, false);
        return;
      }
      const ok = await dialog.confirm({
        title: t('fileReceive.remove.title'),
        message: t('fileReceive.remove.body'),
        confirmLabel: t('fileReceive.remove'),
        tone: 'danger',
      });
      if (ok) setExcluded(key, true);
    },
    [t, setExcluded],
  );

  const editEntry = useCallback((key: string) => setEditing(entryOf(key)), []);

  /**
   * One record, one row. Group headers and phones are siblings in the same
   * list, and each receives only the values it shows.
   */
  const renderRow: ListRenderItem<ReviewRowData> = useCallback(
    ({ item }) => {
      if (item.type === 'group') {
        const { summary } = item;
        const status = summary.needsAttention === 0
          ? summary.excluded === summary.phones
            ? t('fileReceive.state.excluded')
            : t('fileReceive.group.ready')
          : summary.reason
            ? t(`fileReceive.problem.${summary.reason}` as never)
            : t('fileReceive.group.mixed', { count: String(summary.needsAttention) });
        return (
          <GroupRow
            groupKey={item.groupKey}
            label={item.label}
            subtitle={item.variant}
            countCost={t('fileReceive.group.countCost', { count: String(summary.phones), total: formatMoney(summary.subtotal) })}
            status={t('fileReceive.group.status', { status })}
            held={summary.needsAttention > 0}
            matchable={summary.matchableKeys.length}
            shown={item.shown}
            open={item.open}
            onToggle={toggleGroup}
            onMatch={matchGroupByKey}
          />
        );
      }
      const problems = item.problems;
      return (
        <EntryRow
          entryKey={item.entryKey}
          source={item.source}
          identifier={item.identifier}
          imei2={item.imei2}
          cost={item.cost}
          extractedCost={item.extractedCost}
          corrected={item.corrected}
          state={item.state}
          problemsText={problems.map((p) => t(`fileReceive.problem.${p}` as never)).join(' · ')}
          acceptable={item.acceptable}
          onAccept={acceptEntry}
          onEdit={editEntry}
          onRemove={removeEntry}
        />
      );
    },
    [t, toggleGroup, matchGroupByKey, acceptEntry, editEntry, removeEntry],
  );

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('fileReceive.done.title') }} />
        <EmptyState
          icon={Check}
          title={t('fileReceive.done.title')}
          body={t('fileReceive.done.body', {
            count: String(done.units),
            branch: branchName ?? '',
            total: formatMoney(done.total),
          })}
          action={{ label: t('action.done'), onPress: () => router.replace('/(tabs)/inventory') }}
        />
      </Screen>
    );
  }

  if (!batch || !counts) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('fileReceive.title') }} />
        <EmptyState
          icon={FileSpreadsheet}
          title={t('fileReceive.gone.title')}
          body={t('fileReceive.gone.body')}
          action={{ label: t('action.back'), onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const ready = reviewComplete(batch);
  const attentionKeys = batch.parsed.entries.filter((e) => entryState(batch, e) === 'needs_attention').map((e) => e.key);
  /** Every held-up phone is waiting on a product, so "Match products" is the one thing to do. */
  const productHeld = attentionKeys.length > 0
    && groups.every((g) => {
      const summary = summaries.get(g.key);
      return !summary || summary.needsAttention === 0 || summary.matchableKeys.length > 0;
    });

  const excludeAllProblems = async () => {
    const ok = await dialog.confirm({
      title: t('fileReceive.excludeAll.title', { count: String(attentionKeys.length) }),
      message: t('fileReceive.excludeAll.body'),
      confirmLabel: t('fileReceive.exclude'),
      tone: 'danger',
    });
    if (ok) excludeMany(attentionKeys, true);
  };

  /** A group's whole product question, answered once. */
  const matchGroup = (group: EntryGroup, product: CatalogueProduct) => {
    const keys = summaries.get(group.key)?.matchableKeys ?? [];
    const changed = correctMany(keys, { productId: product.id });
    setMatching(null);
    setError(null);
    void dialog.alert({
      title: t('fileReceive.match.done', { count: String(changed), product: `${product.brand} ${product.model}` }),
    });
  };

  const applyBulkCost = async () => {
    const value = Number(bulkCost);
    const keys = batch.parsed.entries
      .filter((e) => (filter === 'all' || entryState(batch, e) === filter) && entryState(batch, e) !== 'excluded')
      .map((e) => e.key);
    if (!(value > 0) || keys.length === 0) return;
    const preview = previewBulkCost(batch, keys, value);
    const ok = await dialog.confirm({
      title: t('fileReceive.bulkCost.title', { count: String(preview.affected) }),
      // Says plainly how many already say something else: nothing is overwritten quietly.
      message: preview.differing > 0
        ? t('fileReceive.bulkCost.bodyDiffering', { amount: formatMoney(value), differing: String(preview.differing) })
        : t('fileReceive.bulkCost.body', { amount: formatMoney(value) }),
      confirmLabel: t('action.confirm'),
    });
    if (!ok) return;
    const changed = correctMany(keys, { cost: value });
    setBulkCost('');
    setBulkOpen(false);
    setError(null);
    void dialog.alert({ title: t('fileReceive.bulkCost.done', { count: String(changed) }) });
  };

  const cancel = async () => {
    const ok = await dialog.confirm({
      title: t('fileReceive.cancel.title'),
      message: t('fileReceive.cancel.body'),
      confirmLabel: t('fileReceive.cancel.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    clear();
    router.back();
  };

  // ── the payment step ──────────────────────────────────────────────────────
  //
  // Reached only once nothing is left unresolved, so every figure on it is
  // final.
  if (step === 'payment') {
    return (
      <Screen
        scroll
        footer={
          <>
            <Button
              title={t('fileReceive.confirm', { count: String(counts.ready) })}
              size="lg"
              fullWidth
              loading={receive.isPending}
              disabled={!canConfirm(batch) || !purchasePaymentReady(payment) || !branchId}
              onPress={() => {
                setError(null);
                receive.mutate();
              }}
            />
            <Button title={t('fileReceive.backToReview')} variant="tertiary" size="sm" onPress={() => setStep('review')} />
          </>
        }
      >
        <Stack.Screen options={{ headerShown: true, title: t('fileReceive.payment.title') }} />
        <Card style={styles.stack}>
          <Text variant="label" tone="secondary">
            {t('fileReceive.step', { current: '2', total: '3' })}
          </Text>
          <Text variant="body">{t('fileReceive.payable', { count: String(counts.ready) })}</Text>
          <Text variant="display">{formatMoney(counts.selectedCost)}</Text>
          <Text variant="caption" tone="secondary">
            {t('fileReceive.branch', { branch: branchName ?? t('home.branch.unknown') })}
          </Text>
          {counts.excluded > 0 ? (
            <Text variant="caption" tone="secondary">
              {t('fileReceive.excludedNote', { count: String(counts.excluded) })}
            </Text>
          ) : null}
        </Card>
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
        <PurchasePaymentPicker value={payment} onChange={setPayment} />
      </Screen>
    );
  }

  // ── the review step ───────────────────────────────────────────────────────
  return (
    <Screen
      scroll={false}
      footer={
        <View style={styles.footer}>
          <View style={styles.footerCounts}>
            <Text variant="caption" tone="secondary">
              {t('fileReceive.footer.ready', { count: String(counts.ready) })}
            </Text>
            {counts.excluded > 0 ? (
              <Text variant="caption" tone="secondary">
                {t('fileReceive.footer.excluded', { count: String(counts.excluded) })}
              </Text>
            ) : null}
            <Text variant="label">{formatMoney(counts.selectedCost)}</Text>
          </View>
          <Button
            title={t('fileReceive.continue')}
            size="lg"
            fullWidth
            disabled={!ready || counts.ready === 0}
            onPress={() => setStep('payment')}
          />
          {!ready ? (
            <Text variant="caption" tone="secondary" align="center">
              {t('fileReceive.continueBlocked', { count: String(counts.needsAttention) })}
            </Text>
          ) : null}
        </View>
      }
    >
      <Stack.Screen options={{ headerShown: true, title: t('fileReceive.title') }} />

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        // Every record is one small row, so the window can stay small.
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.header}>
            <DraftNotice draft={draft} onDiscard={() => { clear(); router.back(); }} />

            <Card style={styles.stack}>
              <Text variant="label" tone="secondary">
                {t('fileReceive.step', { current: '1', total: '3' })}
              </Text>
              <Text variant="title">
                {counts.needsAttention > 0
                  ? t('fileReceive.attention.title', { count: String(counts.needsAttention) })
                  : t('fileReceive.allReady.title', { count: String(counts.ready) })}
              </Text>
              <Text variant="body" tone="secondary">
                {counts.needsAttention > 0 ? t('fileReceive.attention.body') : t('fileReceive.allReady.body')}
              </Text>

              <Divider />
              <Breakdown label={t('fileReceive.filter.ready')} value={counts.ready} />
              <Breakdown label={t('fileReceive.filter.attention')} value={counts.needsAttention} />
              <Breakdown label={t('fileReceive.filter.excluded')} value={counts.excluded} />
              <Divider />

              <Text variant="caption" tone="tertiary">
                {batch.parsed.filename} ·{' '}
                {t('fileReceive.summary', {
                  phones: String(counts.phones),
                  sheet: batch.parsed.sheets.find((s) => s.selected)?.name ?? '—',
                })}
              </Text>
              <Text variant="caption" tone="secondary">
                {t('fileReceive.branch', { branch: branchName ?? t('home.branch.unknown') })}
              </Text>

              {productHeld ? (
                <Button
                  title={t('fileReceive.matchProducts')}
                  fullWidth
                  onPress={() => {
                    setFilter('needs_attention');
                    const first = groups.find((g) => (summaries.get(g.key)?.matchableKeys.length ?? 0) > 0);
                    if (first) setMatching(first);
                  }}
                />
              ) : null}
            </Card>

            {batch.parsed.imageOnlyPages.length > 0 ? (
              <InlineNotice tone="warning" title={t('fileReceive.imageOnly.title')}>
                {t('fileReceive.imageOnly.body', { pages: batch.parsed.imageOnlyPages.join(', ') })}
              </InlineNotice>
            ) : null}

            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

            <View style={styles.filters}>
              <FilterChip label={t('fileReceive.filter.all')} count={counts.phones} selected={filter === 'all'} onPress={() => setFilter('all')} />
              <FilterChip label={t('fileReceive.filter.ready')} count={counts.ready} selected={filter === 'ready'} onPress={() => setFilter('ready')} />
              <FilterChip
                label={t('fileReceive.filter.attention')}
                count={counts.needsAttention}
                selected={filter === 'needs_attention'}
                onPress={() => setFilter('needs_attention')}
              />
              <FilterChip
                label={t('fileReceive.filter.excluded')}
                count={counts.excluded}
                selected={filter === 'excluded'}
                onPress={() => setFilter('excluded')}
              />
            </View>

            <Card style={styles.stack}>
              <Button
                title={t('fileReceive.bulk.title')}
                variant="secondary"
                fullWidth
                icon={bulkOpen ? ChevronDown : ChevronRight}
                onPress={() => setBulkOpen((open) => !open)}
              />
              {bulkOpen ? (
                <>
                  <Text variant="caption" tone="secondary">
                    {t('fileReceive.bulk.fields')}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {t('fileReceive.bulk.scope')}
                  </Text>
                  <MoneyField label={t('fileReceive.bulkCost.label')} value={bulkCost} onChangeText={setBulkCost} />
                  <Button
                    title={t('fileReceive.bulkCost.apply')}
                    variant="secondary"
                    disabled={!(Number(bulkCost) > 0)}
                    onPress={() => void applyBulkCost()}
                  />
                </>
              ) : null}
            </Card>
          </View>
        }
        ListFooterComponent={
          <View style={styles.tail}>
            {attentionKeys.length > 0 ? (
              <Button
                title={t('fileReceive.excludeAll', { count: String(attentionKeys.length) })}
                variant="tertiary"
                size="sm"
                onPress={() => void excludeAllProblems()}
              />
            ) : null}
            <Button title={t('fileReceive.cancel.confirm')} variant="tertiary" size="sm" onPress={() => void cancel()} />
          </View>
        }
      />

      <EntrySheet
        key={editing?.key ?? 'none'}
        entry={editing}
        onClose={() => setEditing(null)}
        onSave={(correction) => {
          if (editing) correct(editing.key, correction);
          setEditing(null);
        }}
        candidates={editing ? batch.parsed.matches[editing.key]?.candidates ?? [] : []}
        currentCost={editing ? effectiveCost(batch, editing) : null}
      />

      <MatchSheet
        group={matching}
        candidates={matching ? groupCandidates(batch, matching) : []}
        count={matching ? (summaries.get(matching.key)?.matchableKeys.length ?? 0) : 0}
        onClose={() => setMatching(null)}
        onChoose={(product) => matching && matchGroup(matching, product)}
      />
    </Screen>
  );
}

/** One line of the summary breakdown: a word and a number, never overlapping. */
function Breakdown({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return (
    <View style={styles.breakdown}>
      <Text variant="body" tone="secondary" style={styles.breakdownLabel}>
        {label}
      </Text>
      <Text variant="body">{String(value)}</Text>
    </View>
  );
}

/**
 * One exact variant of phone, as the delivery lists it: a count, a subtotal and
 * the reason it is held up. Its phones are the records that follow it in the
 * list while it is open — see `reviewRows`.
 *
 * Memoised on primitives: a correction elsewhere in the delivery leaves this
 * header's values unchanged and so does not re-render it.
 */
const GroupRow = React.memo(function GroupRow({
  groupKey,
  label,
  subtitle,
  countCost,
  status,
  held,
  matchable,
  shown,
  open,
  onToggle,
  onMatch,
}: {
  groupKey: string;
  label: string;
  subtitle: string | null;
  countCost: string;
  status: string;
  held: boolean;
  /** How many phones one product choice would fix; 0 when none. */
  matchable: number;
  shown: number;
  open: boolean;
  onToggle: (key: string) => void;
  onMatch: (key: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <Card style={styles.group}>
      <Text variant="title">{label}</Text>
      {subtitle ? (
        <Text variant="caption" tone="secondary">
          {subtitle}
        </Text>
      ) : null}
      <Text variant="body" tone="secondary">
        {countCost}
      </Text>
      <Text variant="body" tone={held ? 'warning' : 'secondary'}>
        {status}
      </Text>

      <View style={styles.groupActions}>
        {matchable > 0 ? (
          <Button
            title={t('fileReceive.match.action', { count: String(matchable) })}
            variant="secondary"
            size="sm"
            onPress={() => onMatch(groupKey)}
          />
        ) : null}
        <Button
          title={open ? t('fileReceive.group.hide') : t('fileReceive.group.review', { count: String(shown) })}
          variant="tertiary"
          size="sm"
          icon={open ? ChevronDown : ChevronRight}
          onPress={() => onToggle(groupKey)}
        />
      </View>
    </Card>
  );
});

/**
 * One physical phone.
 *
 * Every value is labelled, because an unlabelled column of fifteen digits is
 * unreadable and two IMEIs printed one under the other look like two phones.
 * They are one: IMEI 2 is named as such, under the same row, above the same
 * cost.
 *
 * Three actions, always in the same place: **Accept** (a check) marks the phone
 * ready when only an advisory flag stood in the way; **Edit** (a pencil) opens
 * the correction sheet; **Remove** (a bin) excludes it from the delivery. Accept
 * is dimmed when there is nothing to accept — a phone already ready, or one with
 * a real problem that must be fixed or removed. A warning sits beside the
 * reason, never beside the price: a correct price on a phone whose product is
 * unknown is still a correct price.
 *
 * Memoised, and given only primitive props and callbacks keyed by the row, so
 * correcting one phone re-renders that phone and not the rest of the open group.
 */
const EntryRow = React.memo(function EntryRow({
  entryKey,
  source,
  identifier,
  imei2,
  cost,
  extractedCost,
  corrected,
  state,
  problemsText,
  acceptable,
  onAccept,
  onEdit,
  onRemove,
}: {
  entryKey: string;
  source: SourceRef;
  identifier: string | null;
  imei2: string | null;
  cost: number | null;
  extractedCost: number | null;
  corrected: boolean;
  state: EntryState;
  problemsText: string;
  acceptable: boolean;
  onAccept: (key: string) => void;
  onEdit: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const from = source.sheet
    ? t('fileReceive.source.row', { sheet: source.sheet, row: String(source.row ?? '') })
    : t('fileReceive.source.page', { page: String(source.page ?? '') });

  const excluded = state === 'excluded';
  const statusWord =
    state === 'ready'
      ? t('fileReceive.status.ready')
      : excluded
        ? t('fileReceive.status.excluded')
        : t('fileReceive.status.needsCorrection');
  const statusTone = state === 'ready' ? 'success' : excluded ? 'tertiary' : 'warning';

  return (
    <View style={styles.entry}>
      <Divider />
      <Field label={t('fileReceive.field.imei1')} value={identifier ?? t('fileReceive.noIdentifier')} />
      {imei2 ? <Field label={t('fileReceive.field.imei2')} value={imei2} /> : null}
      <Field label={t('fileReceive.field.cost')} value={cost !== null ? formatMoney(cost) : t('fileReceive.field.noCost')} />
      <Field label={t('fileReceive.field.source')} value={from} />

      {/* Status in words as well as colour — never colour alone. */}
      <Text variant="caption" tone={statusTone}>
        {statusWord}
      </Text>
      {corrected ? (
        <Text variant="caption" tone="accent">
          {t('fileReceive.corrected', { cost: extractedCost !== null ? formatMoney(extractedCost) : '—' })}
        </Text>
      ) : null}
      {problemsText ? <InlineNotice tone="warning">{problemsText}</InlineNotice> : null}

      <View style={styles.rowActions}>
        {excluded ? (
          <IconButton
            icon={RotateCcw}
            variant="sunken"
            accessibilityLabel={t('fileReceive.restore.a11y')}
            onPress={() => onRemove(entryKey)}
          />
        ) : (
          <>
            <IconButton
              icon={CheckCircle2}
              variant="sunken"
              disabled={!acceptable}
              accessibilityLabel={t('fileReceive.accept.a11y')}
              onPress={() => onAccept(entryKey)}
            />
            <IconButton
              icon={Pencil}
              variant="sunken"
              accessibilityLabel={t('fileReceive.edit.a11y')}
              onPress={() => onEdit(entryKey)}
            />
            <IconButton
              icon={Trash2}
              variant="sunken"
              accessibilityLabel={t('fileReceive.remove.a11y')}
              onPress={() => onRemove(entryKey)}
            />
          </>
        )}
      </View>
    </View>
  );
});

/** A labelled value, wrapping rather than clipping however long it is. */
function Field({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text variant="caption" tone="tertiary" style={styles.fieldLabel}>
        {label}
      </Text>
      <Text variant="body" style={styles.fieldValue}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Choosing the product for a whole group at once.
 *
 * Only products every phone in the group already matched are offered, and
 * nothing is created here: an unknown model still goes through Create product.
 */
function MatchSheet({
  group,
  candidates,
  count,
  onClose,
  onChoose,
}: {
  group: EntryGroup | null;
  candidates: CatalogueProduct[];
  count: number;
  onClose: () => void;
  onChoose: (product: CatalogueProduct) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (!group) return null;

  return (
    <BottomSheet open onClose={onClose} title={t('fileReceive.match.title', { count: String(count) })}>
      <View style={styles.sheet}>
        <Text variant="body">{group.label}</Text>
        <Text variant="caption" tone="secondary">
          {[group.category, group.variant].filter(Boolean).join(' · ')}
        </Text>
        {candidates.length > 0 ? (
          <RowGroup>
            {candidates.map((c) => (
              <ListRow
                key={c.id}
                flat
                title={`${c.brand} ${c.model}`}
                subtitle={c.variant ?? undefined}
                onPress={() => onChoose(c)}
              />
            ))}
          </RowGroup>
        ) : (
          <Text variant="caption" tone="secondary">
            {t('fileReceive.noCandidates')}
          </Text>
        )}
      </View>
    </BottomSheet>
  );
}

/**
 * Correcting one phone.
 *
 * Two things a person can fix here: which product it is (from the candidates
 * the server found — never a product invented from the file's label), and what
 * it cost. What the file said stays visible above, because a correction is a
 * second opinion, not a replacement of the record.
 */
function EntrySheet({
  entry,
  candidates,
  currentCost,
  onClose,
  onSave,
}: {
  entry: FileEntry | null;
  candidates: CatalogueProduct[];
  currentCost: number | null;
  onClose: () => void;
  onSave: (correction: { productId?: string; cost?: number }) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  // Mounted fresh per phone (see the key below), so the field simply starts
  // from what that phone currently costs.
  const [cost, setCost] = useState(currentCost !== null ? String(currentCost) : '');

  if (!entry) return null;

  return (
    <BottomSheet open onClose={onClose} title={t('fileReceive.fix')}>
      <View style={styles.sheet}>
        <Text variant="caption" tone="secondary">
          {t('fileReceive.extracted', {
            model: entry.extracted.model ?? '—',
            cost: entry.extracted.cost !== null ? formatMoney(entry.extracted.cost) : '—',
          })}
        </Text>

        {candidates.length > 0 ? (
          <>
            <Text variant="label">{t('fileReceive.chooseProduct')}</Text>
            <RowGroup>
              {candidates.map((c) => (
                <ListRow
                  key={c.id}
                  flat
                  title={`${c.brand} ${c.model}`}
                  subtitle={c.variant ?? undefined}
                  onPress={() => onSave({ productId: c.id })}
                />
              ))}
            </RowGroup>
          </>
        ) : (
          <Text variant="caption" tone="secondary">
            {t('fileReceive.noCandidates')}
          </Text>
        )}

        <MoneyField label={t('fileReceive.cost.label')} value={cost} onChangeText={setCost} />
        <Button title={t('action.save')} disabled={!(Number(cost) > 0)} onPress={() => onSave({ cost: Number(cost) })} />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { gap: space.sm, paddingBottom: space['3xl'] },
  header: { gap: space.base, paddingBottom: space.xs },
  stack: { gap: space.sm },
  breakdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  breakdownLabel: { flexShrink: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  group: { gap: space.xs, marginTop: space.xs },
  groupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  // A phone sits under its group's header, on the same surface, set in from the edge.
  entry: { gap: space.xs, paddingHorizontal: space.base, paddingBottom: space.sm, backgroundColor: colors.surface.card },
  field: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.xs },
  fieldLabel: { minWidth: 72 },
  fieldValue: { flexShrink: 1 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  tail: { gap: space.sm, paddingTop: space.base },
  footer: { gap: space.xs },
  footerCounts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  sheet: { gap: space.sm, padding: space.base },
}));
