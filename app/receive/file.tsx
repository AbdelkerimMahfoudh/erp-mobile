import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, View, type ListRenderItem } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, ChevronDown, ChevronRight, FileSpreadsheet, RotateCcw, Trash2 } from 'lucide-react-native';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  FilterChip,
  Identifier,
  InlineNotice,
  ListRow,
  ListSeparator,
  MoneyField,
  RowGroup,
  Screen,
  Text,
} from '../../components/ui';
import { BottomSheet } from '../../components/overlay/BottomSheet';
import { RowAction } from '../../components/receive/RowAction';
import {
  PurchasePaymentPicker,
  purchasePaymentBody,
  purchasePaymentReady,
  type PurchasePayment,
} from '../../components/receive/PurchasePaymentPicker';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { devTiming } from '../../lib/dev-timing';
import { dialog } from '../../lib/dialog';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { isRTL, useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { invalidateMoney } from '../../lib/money-invalidation';
import { useDraft } from '../../lib/offline/use-draft';
import { DraftNotice } from '../../components/DraftNotice';
import { useFileBatch } from '../../lib/file-batch-store';
import {
  batchCounts,
  batchFingerprint,
  canAccept,
  canConfirm,
  effectiveCost,
  effectiveImei2,
  entryState,
  groupCandidates,
  groupEntries,
  maskIdentifier,
  previewBulkCost,
  purchaseItems,
  remainingProblems,
  reviewComplete,
  type BatchState,
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
 * is where a person sees every item, fixes what is wrong, deliberately excludes
 * what they will not take, and only then buys the rest.
 *
 * ## Why it is staged
 *
 * A hundred items do not fit on a phone screen, and the first version put the
 * whole payment section under a list where nothing was ready to pay for yet: the
 * shop was asked how it would like to pay before it had been told what was
 * wrong. Review and payment are two steps. Payment appears only once every item
 * is either corrected or deliberately excluded, and until then a compact footer
 * carries the only numbers that matter — how many are ready, what they cost,
 * and how many remain.
 *
 * ## Why groups come first, and why the list is flat
 *
 * A hundred rows of the same iPhone with the same missing product are one
 * decision, not a hundred. The list shows one compact header per exact variant
 * with its count, its subtotal and the reason it is held up, and a group whose
 * every problem is the same product question is matched once for all of them.
 *
 * The list itself is ONE virtualized sequence — group headers, then the rows of
 * the single open group — built by `reviewRows`. The earlier shape, a card per
 * group mapping its own rows inside itself, meant the open group was one list
 * item however many rows it held, and any correction re-rendered every card
 * because each received the whole batch. Rows now receive only the primitives
 * they show, and re-render only when those change: correcting one item in a
 * hundred re-renders that item.
 *
 * ## What a row is
 *
 * One line says where it came from and which one it is — the spreadsheet row,
 * the identifier masked to its last four, and whether a second IMEI rides on it.
 * The next says what it costs and where it stands, in words. Then three actions
 * with their names on them: Accept, Edit, Exclude. The whole identifier, the
 * product, the file's own words and every action are one tap away in the item's
 * sheet, where somebody actually checks a phone against the thing in hand.
 *
 * The actions are plain words, not design-system Buttons. Measured on the
 * hundred-phone workbook, opening a group spent two to four times longer laying
 * views out than running JavaScript, and a row's three Buttons — each an
 * animated pressable with an icon — were most of those views (docs/55).
 *
 * Three rules it exists to keep:
 *
 * 1. **Nothing is received quietly.** An item with a problem must be corrected
 *    or excluded; the app never receives "the good rows" and drops the rest.
 * 2. **The file's own words are never overwritten.** A correction sits beside
 *    what was extracted, and a bulk edit says how many items it will change —
 *    and how many already say something different — before it changes them.
 * 3. **Confirmation is an ordinary purchase**, paid in full through
 *    `POST /purchases`, with a key bound to exactly what is being received — so
 *    a double tap or a retry after a timeout returns the same receipt instead of
 *    buying the delivery twice. Accepting, editing and excluding change the
 *    draft only; stock exists when the delivery is confirmed, and not before.
 */

type Step = 'review' | 'payment';

const Separator = () => <ListSeparator inset={false} />;

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
   * A hundred items do not fit on a screen, and a file of two thousand must
   * cost no more to scroll than one of ten. Only the open group's rows are in
   * the list at all, and opening a group closes whichever was open, so the
   * number of mounted rows never grows with the delivery.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [payment, setPayment] = useState<PurchasePayment>({ method: 'cash', receivingAccountId: null });
  /** The item whose sheet is open, by key — the sheet reads the live item from the batch. */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [matching, setMatching] = useState<EntryGroup | null>(null);
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
  /**
   * How many products a group could be matched to at once — the ones every phone in
   * it already matched. A group with none ("No product match") offered the same
   * Match product button as one with a choice, and its sheet could only say that
   * nothing in the catalogue matches; the headline Match products opened that empty
   * sheet first. The button now appears only where a choice exists (docs/55 D50).
   */
  const candidateCounts = useMemo(
    () => new Map(groups.map((g) => [g.key, batch ? groupCandidates(batch, g).length : 0])),
    [batch, groups],
  );
  const rows = useMemo(() => (batch ? reviewRows(batch, groups, summaries, openKey, filter) : []), [batch, groups, summaries, openKey, filter]);
  const items = useMemo(() => (batch ? purchaseItems(batch) : []), [batch]);
  /** Bound to the payload: editing the batch changes the key, so a stale replay cannot answer. */
  const clientUuid = useMemo(
    () => (batch ? batchFingerprint(items, { method: payment.method, receivingAccountId: payment.receivingAccountId }) : ''),
    [batch, items, payment.method, payment.receivingAccountId],
  );
  // The groups the stable match callback reads; written after render, never during it.
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

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
    devTiming.mark('review.expand');
    setOpenKey((current) => toggleOpenGroup(current, key));
  }, []);
  const chooseFilter = useCallback((next: ReviewFilter) => {
    devTiming.mark('review.filter');
    setFilter(next);
  }, []);
  useLayoutEffect(() => devTiming.end('review.expand', 'review: group opened'), [openKey]);
  useLayoutEffect(() => devTiming.end('review.filter', 'review: filter applied'), [filter]);
  useLayoutEffect(() => {
    devTiming.end('review.parsed', 'review: first list shown');
    devTiming.end('review.change', 'review: change applied');
  }, [batch]);

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

  /** Accept: a native confirmation naming the item, then the row is marked ready. Nothing else changes. */
  const acceptEntry = useCallback(
    async (key: string) => {
      const live = useFileBatch.getState().batch;
      const entry = entryOf(key);
      if (!live || !entry || !canAccept(live, entry)) return;
      const product = productWords(entry) || t('fileReceive.noIdentifier');
      const identifier = entry.extracted.imei1 ?? entry.extracted.serial ?? t('fileReceive.noIdentifier');
      const cost = effectiveCost(live, entry);
      const detail = [identifier, cost !== null ? formatMoney(cost) : null].filter(Boolean).join('  ·  ');
      const ok = await dialog.confirm({
        title: product,
        message: `${detail}\n\n${t('fileReceive.accept.body')}`,
        confirmLabel: t('fileReceive.accept'),
      });
      if (!ok) return;
      devTiming.mark('review.change');
      setAcknowledged(key, true);
    },
    [t, setAcknowledged],
  );

  /** Exclude: a destructive confirmation, then only this row leaves the draft. Restoring needs no speed bump. */
  const removeEntry = useCallback(
    async (key: string) => {
      const live = useFileBatch.getState().batch;
      const entry = entryOf(key);
      if (!live || !entry) return;
      if (entryState(live, entry) === 'excluded') {
        devTiming.mark('review.change');
        setExcluded(key, false);
        return;
      }
      const ok = await dialog.confirm({
        title: t('fileReceive.remove.title'),
        message: t('fileReceive.remove.body'),
        confirmLabel: t('fileReceive.remove'),
        tone: 'danger',
      });
      if (!ok) return;
      devTiming.mark('review.change');
      setExcluded(key, true);
    },
    [t, setExcluded],
  );

  const editEntry = useCallback((key: string) => setDetailKey(key), []);

  /**
   * One record, one row. Group headers and items are siblings in the same
   * list, and each receives only the values it shows.
   */
  const renderRow: ListRenderItem<ReviewRowData> = useCallback(
    ({ item }) => {
      if (item.type === 'group') {
        const { summary } = item;
        const status = summary.needsAttention === 0
          ? summary.excluded === summary.phones
            ? t('fileReceive.status.excluded')
            : t('fileReceive.group.ready')
          : summary.reason
            ? t(`fileReceive.short.${summary.reason}` as never)
            : t('fileReceive.group.mixed', { count: String(summary.needsAttention) });
        return (
          <GroupRow
            groupKey={item.groupKey}
            label={item.label}
            subtitle={item.variant}
            count={summary.phones}
            subtotal={formatMoney(summary.subtotal)}
            status={status}
            held={summary.needsAttention > 0}
            matchable={summary.matchableKeys.length > 0 && (candidateCounts.get(item.groupKey) ?? 0) > 0}
            open={item.open}
            onToggle={toggleGroup}
            onMatch={matchGroupByKey}
          />
        );
      }
      return (
        <EntryRow
          entryKey={item.entryKey}
          source={item.source}
          identifier={item.identifier}
          identifierKind={item.identifierKind}
          twoImeis={Boolean(item.imei2)}
          cost={item.cost}
          extractedCost={item.extractedCost}
          corrected={item.corrected}
          state={item.state}
          status={
            item.state === 'ready'
              ? t('fileReceive.status.ready')
              : item.state === 'excluded'
                ? t('fileReceive.status.excluded')
                : item.problems.map((p) => t(`fileReceive.short.${p}` as never)).join(' · ')
          }
          acceptable={item.acceptable}
          onAccept={acceptEntry}
          onEdit={editEntry}
          onRemove={removeEntry}
        />
      );
    },
    [t, toggleGroup, matchGroupByKey, acceptEntry, editEntry, removeEntry, candidateCounts],
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
  /** Every held-up item is waiting on a product, so "Match products" is the one thing to do. */
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
  const detailEntry = detailKey ? batch.parsed.entries.find((e) => e.key === detailKey) ?? null : null;

  return (
    <Screen
      scroll={false}
      padded={false}
      footer={
        <View style={styles.footer}>
          {/* What is ready and what it costs; beside it, what still stands in the way — or, once nothing does, what was left out. */}
          <View style={styles.footerCounts}>
            <Text variant="label" style={styles.shrink}>
              {t('fileReceive.footer.readyTotal', { count: String(counts.ready), total: formatMoney(counts.selectedCost) })}
            </Text>
            {!ready ? (
              <Text variant="caption" tone="warning" align="end" style={styles.shrink}>
                {t('fileReceive.footer.remaining', { count: String(counts.needsAttention) })}
              </Text>
            ) : counts.excluded > 0 ? (
              <Text variant="caption" tone="secondary" align="end" style={styles.shrink}>
                {t('fileReceive.footer.excluded', { count: String(counts.excluded) })}
              </Text>
            ) : null}
          </View>
          <Button
            title={t('fileReceive.continue')}
            size="lg"
            fullWidth
            disabled={!ready || counts.ready === 0}
            onPress={() => setStep('payment')}
          />
        </View>
      }
    >
      <Stack.Screen options={{ headerShown: true, title: t('fileReceive.title') }} />

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ItemSeparatorComponent={Separator}
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

            {/* The three figures, and nothing else, at a glance. */}
            <View style={styles.tiles}>
              <SummaryTile label={t('fileReceive.filter.ready')} value={counts.ready} tone="success" />
              <SummaryTile label={t('fileReceive.filter.attention')} value={counts.needsAttention} tone={counts.needsAttention > 0 ? 'warning' : 'primary'} />
              <SummaryTile label={t('fileReceive.filter.excluded')} value={counts.excluded} tone="primary" />
            </View>
            <Text variant="caption" tone="tertiary">
              {[
                batch.parsed.filename,
                t('fileReceive.summary', { phones: String(counts.phones), sheet: batch.parsed.sheets.find((s) => s.selected)?.name ?? '—' }),
                t('fileReceive.branch', { branch: branchName ?? t('home.branch.unknown') }),
              ].join(' · ')}
            </Text>

            {productHeld ? (
              <Button
                title={t('fileReceive.matchProducts')}
                fullWidth
                onPress={() => {
                  chooseFilter('needs_attention');
                  const first = groups.find((g) => (summaries.get(g.key)?.matchableKeys.length ?? 0) > 0 && (candidateCounts.get(g.key) ?? 0) > 0);
                  if (first) setMatching(first);
                }}
              />
            ) : null}

            {batch.parsed.imageOnlyPages.length > 0 ? (
              <InlineNotice tone="warning" title={t('fileReceive.imageOnly.title')}>
                {t('fileReceive.imageOnly.body', { pages: batch.parsed.imageOnlyPages.join(', ') })}
              </InlineNotice>
            ) : null}

            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

            {/*
              The four filters, every one in view: they wrap onto a second line at 320
              points instead of scrolling sideways, where the fourth sat off-screen and
              unknown. Each is a full 48-point target — a chip inside a scrolling list
              cannot lean on hit slop, which competes with the scroll (docs/55).
            */}
            <View style={styles.filters}>
              <FilterChip label={t('fileReceive.filter.all')} count={counts.phones} selected={filter === 'all'} onPress={() => chooseFilter('all')} style={styles.filterChip} />
              <FilterChip label={t('fileReceive.filter.ready')} count={counts.ready} selected={filter === 'ready'} onPress={() => chooseFilter('ready')} style={styles.filterChip} />
              <FilterChip
                label={t('fileReceive.filter.attention')}
                count={counts.needsAttention}
                selected={filter === 'needs_attention'}
                onPress={() => chooseFilter('needs_attention')}
                style={styles.filterChip}
              />
              <FilterChip
                label={t('fileReceive.filter.excluded')}
                count={counts.excluded}
                selected={filter === 'excluded'}
                onPress={() => chooseFilter('excluded')}
                style={styles.filterChip}
              />
            </View>

            <Disclosure title={t('fileReceive.bulk.title')}>
              <View style={styles.stack}>
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
              </View>
            </Disclosure>
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

      <ItemSheet
        key={detailKey ?? 'none'}
        batch={batch}
        entry={detailEntry}
        onClose={() => setDetailKey(null)}
        onSave={(correction) => {
          devTiming.mark('review.change');
          if (detailKey) correct(detailKey, correction);
          setDetailKey(null);
        }}
        onAccept={() => detailKey && void acceptEntry(detailKey)}
        onExclude={() => detailKey && void removeEntry(detailKey)}
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

/** "Apple iPhone 12" as the file names it — brand and model, whichever it has. */
function productWords(entry: FileEntry): string {
  return [entry.extracted.brand, entry.extracted.model].filter(Boolean).join(' ');
}

/** One figure of the summary: a number and the word for it, never colour alone. */
function SummaryTile({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'primary' }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text variant="title" tone={tone}>
        {String(value)}
      </Text>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

/**
 * One exact variant, as the delivery lists it: a name, how many, what they
 * cost together, and in a few words why it is held up. Tapping it opens its
 * rows beneath; a group waiting on one product question carries the one
 * action that answers it.
 *
 * Memoised on primitives: a correction elsewhere in the delivery leaves this
 * header's values unchanged and so does not re-render it.
 */
const GroupRow = React.memo(function GroupRow({
  groupKey,
  label,
  subtitle,
  count,
  subtotal,
  status,
  held,
  matchable,
  open,
  onToggle,
  onMatch,
}: {
  groupKey: string;
  label: string;
  subtitle: string | null;
  count: number;
  subtotal: string;
  status: string;
  held: boolean;
  matchable: boolean;
  open: boolean;
  onToggle: (key: string) => void;
  onMatch: (key: string) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => onToggle(groupKey)}
        style={({ pressed }) => [styles.groupHead, pressed && styles.pressed]}
      >
        <View style={styles.grow}>
          <Text variant="bodyStrong">{label}</Text>
          {subtitle ? (
            <Text variant="caption" tone="secondary">
              {subtitle}
            </Text>
          ) : null}
          <Text variant="caption" tone={held ? 'warning' : 'secondary'}>
            {status}
          </Text>
        </View>
        <View style={styles.groupTrail}>
          <Text variant="bodyStrong" align="end">
            {String(count)}
          </Text>
          <Text variant="caption" tone="secondary" align="end">
            {subtotal}
          </Text>
        </View>
        <View style={!open && isRTL() ? styles.flip : undefined}>
          <Chevron size={20} color={colors.text.tertiary} />
        </View>
      </Pressable>
      {matchable ? (
        <View style={styles.groupAction}>
          <Button title={t('fileReceive.group.match')} variant="secondary" size="sm" onPress={() => onMatch(groupKey)} />
        </View>
      ) : null}
    </View>
  );
});

/**
 * One item: where it came from and which one it is, what it costs and where
 * it stands, and three named actions. Accept is offered only when accepting is
 * the one thing between the item and ready; an item with a real problem must
 * be edited or excluded.
 *
 * Memoised, and given only primitive props and callbacks keyed by the row, so
 * correcting one item re-renders that item and not the rest of the open group.
 */
const EntryRow = React.memo(function EntryRow({
  entryKey,
  source,
  identifier,
  identifierKind,
  twoImeis,
  cost,
  extractedCost,
  corrected,
  state,
  status,
  acceptable,
  onAccept,
  onEdit,
  onRemove,
}: {
  entryKey: string;
  source: SourceRef;
  identifier: string | null;
  identifierKind: 'imei' | 'serial' | null;
  twoImeis: boolean;
  cost: number | null;
  extractedCost: number | null;
  corrected: boolean;
  state: EntryState;
  status: string;
  acceptable: boolean;
  onAccept: (key: string) => void;
  onEdit: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const from = source.sheet ? t('fileReceive.row', { row: String(source.row ?? '') }) : t('fileReceive.page', { page: String(source.page ?? '') });
  const excluded = state === 'excluded';
  const statusTone = state === 'ready' ? 'success' : excluded ? 'tertiary' : 'warning';

  return (
    <View style={[styles.entry, excluded ? styles.entryExcluded : null]}>
      <View style={styles.entryLine}>
        <Text variant="caption" tone="tertiary" style={styles.shrink}>
          {[from, identifierKind === 'serial' ? t('fileReceive.field.serial') : t('fileReceive.field.imei1'), twoImeis ? t('fileReceive.twoImeis') : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Identifier style={styles.shrink}>{identifier ? maskIdentifier(identifier) : t('fileReceive.noIdentifier')}</Identifier>
      </View>
      <View style={styles.entryLine}>
        <Text variant="bodyStrong" style={styles.shrink}>
          {cost !== null ? formatMoney(cost) : t('fileReceive.field.noCost')}
        </Text>
        {/* Status in words as well as colour — never colour alone. */}
        <Text variant="caption" tone={statusTone} style={styles.grow}>
          {status}
        </Text>
      </View>
      {corrected ? (
        <Text variant="caption" tone="accent">
          {t('fileReceive.corrected', { cost: extractedCost !== null ? formatMoney(extractedCost) : '—' })}
        </Text>
      ) : null}

      <View style={styles.entryActions}>
        {excluded ? (
          <RowAction title={t('fileReceive.include')} onPress={() => onRemove(entryKey)} />
        ) : (
          <>
            <RowAction title={t('fileReceive.action.accept')} disabled={!acceptable} onPress={() => onAccept(entryKey)} />
            <RowAction title={t('fileReceive.action.edit')} onPress={() => onEdit(entryKey)} />
            <RowAction title={t('fileReceive.remove')} tone="danger" onPress={() => onRemove(entryKey)} />
          </>
        )}
      </View>
    </View>
  );
});

/** A labelled value in the item sheet, wrapping rather than clipping however long it is. */
function Field({ label, value, identifier = false }: { label: string; value: string; identifier?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text variant="caption" tone="tertiary" style={styles.fieldLabel}>
        {label}
      </Text>
      {identifier ? <Identifier tone="primary">{value}</Identifier> : <Text variant="body" style={styles.fieldValue}>{value}</Text>}
    </View>
  );
}

/**
 * Choosing the product for a whole group at once.
 *
 * Only products every item in the group already matched are offered, and
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
 * One item, in full: where it came from, what the file called it, every
 * identifier whole, what it costs, and what still blocks it — then the ways
 * to change that. Which product it is comes from the candidates the server
 * found (never a product invented from the file's label); the cost is typed.
 * What the file said stays visible, because a correction is a second opinion,
 * not a replacement of the record. Closing it returns to the same place in the
 * same open group.
 */
function ItemSheet({
  batch,
  entry,
  onClose,
  onSave,
  onAccept,
  onExclude,
}: {
  batch: BatchState;
  entry: FileEntry | null;
  onClose: () => void;
  onSave: (correction: { productId?: string; cost?: number }) => void;
  onAccept: () => void;
  onExclude: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const currentCost = entry ? effectiveCost(batch, entry) : null;
  // Mounted fresh per item (see the key on it), so the field simply starts
  // from what that item currently costs.
  const [cost, setCost] = useState(currentCost !== null ? String(currentCost) : '');

  if (!entry) return null;

  const candidates = batch.parsed.matches[entry.key]?.candidates ?? [];
  const state = entryState(batch, entry);
  const problems = remainingProblems(entry, batch.corrections[entry.key]);
  const chosen = batch.corrections[entry.key]?.productId ?? batch.parsed.matches[entry.key]?.productId ?? null;
  const chosenProduct = candidates.find((c) => c.id === chosen) ?? null;
  const imei2 = effectiveImei2(batch, entry);
  const source = entry.source.sheet
    ? t('fileReceive.source.row', { sheet: entry.source.sheet, row: String(entry.source.row ?? '') })
    : t('fileReceive.source.page', { page: String(entry.source.page ?? '') });
  const variant = [entry.extracted.storage ? `${entry.extracted.storage} GB` : null, entry.extracted.colour].filter(Boolean).join(' · ');

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('fileReceive.detail.title')}
      footer={
        <View style={styles.sheetActions}>
          {state !== 'excluded' && canAccept(batch, entry) ? (
            <Button title={t('fileReceive.action.accept')} icon={CheckCircle2} fullWidth onPress={onAccept} />
          ) : null}
          <Button
            title={state === 'excluded' ? t('fileReceive.include') : t('fileReceive.remove')}
            variant={state === 'excluded' ? 'secondary' : 'danger'}
            icon={state === 'excluded' ? RotateCcw : Trash2}
            fullWidth
            onPress={onExclude}
          />
        </View>
      }
    >
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <Field label={t('fileReceive.field.source')} value={source} />
        <Field
          label={t('fileReceive.detail.product')}
          value={[chosenProduct ? `${chosenProduct.brand} ${chosenProduct.model}` : productWords(entry) || '—', variant].filter(Boolean).join(' · ')}
        />
        {entry.extracted.imei1 ? <Field label={t('fileReceive.field.imei1')} value={entry.extracted.imei1} identifier /> : null}
        {imei2 ? <Field label={t('fileReceive.field.imei2')} value={imei2} identifier /> : null}
        {entry.extracted.serial ? <Field label={t('fileReceive.field.serial')} value={entry.extracted.serial} identifier /> : null}
        <Field label={t('fileReceive.field.cost')} value={currentCost !== null ? formatMoney(currentCost) : t('fileReceive.field.noCost')} />
        {batch.corrections[entry.key] ? (
          <Text variant="caption" tone="accent">
            {t('fileReceive.extracted', {
              model: entry.extracted.model ?? '—',
              cost: entry.extracted.cost !== null ? formatMoney(entry.extracted.cost) : '—',
            })}
          </Text>
        ) : null}
        <Field
          label={t('fileReceive.detail.issue')}
          value={
            state === 'excluded'
              ? t('fileReceive.status.excluded')
              : problems.length === 0
                ? t('fileReceive.detail.none')
                : problems.map((p) => t(`fileReceive.problem.${p}` as never)).join('\n')
          }
        />

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
                  selected={c.id === chosen}
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
        <Button title={t('action.save')} variant="secondary" disabled={!(Number(cost) > 0)} onPress={() => onSave({ cost: Number(cost) })} />
      </ScrollView>
    </BottomSheet>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingBottom: space['3xl'] },
  header: { gap: space.md, paddingHorizontal: space.base, paddingTop: space.base, paddingBottom: space.md },
  stack: { gap: space.sm },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface.card },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  filterChip: { height: touch.min },
  grow: { flex: 1, minWidth: 0 },
  /** A text in a row may shrink and wrap rather than run past the edge — native text does not shrink on its own. */
  shrink: { flexShrink: 1, minWidth: 0 },
  flip: { transform: [{ scaleX: -1 }] },
  pressed: { opacity: 0.7 },
  // Group headers and rows share one surface; hairlines between records do the separating.
  group: { backgroundColor: colors.surface.card },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.base, paddingVertical: space.sm },
  groupTrail: { alignItems: 'flex-end', flexShrink: 1, maxWidth: '48%' },
  groupAction: { flexDirection: 'row', paddingHorizontal: space.base, paddingBottom: space.sm },
  entry: { gap: space.xs, paddingVertical: space.sm, paddingStart: space.xl, paddingEnd: space.base, backgroundColor: colors.surface.card },
  entryExcluded: { backgroundColor: colors.surface.sunken },
  entryLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  entryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginStart: -space.md },
  footerCounts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  field: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.xs },
  fieldLabel: { minWidth: 96 },
  fieldValue: { flexShrink: 1 },
  tail: { gap: space.sm, paddingHorizontal: space.base, paddingTop: space.base },
  footer: { gap: space.sm },
  sheet: { gap: space.md, padding: space.base },
  sheetActions: { gap: space.sm },
}));
