import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, FileSpreadsheet, MinusCircle, PlusCircle } from 'lucide-react-native';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  FilterChip,
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
  effectiveImei2,
  entryState,
  groupCandidates,
  groupEntries,
  groupSummary,
  previewBulkCost,
  purchaseItems,
  remainingProblems,
  reviewComplete,
  type CatalogueProduct,
  type EntryGroup,
  type EntryState,
  type FileEntry,
} from '../../lib/file-receiving';
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
 * ## Why groups come first
 *
 * A hundred rows of the same iPhone with the same missing product are one
 * decision, not a hundred. The list shows one collapsed card per exact variant
 * with its count, its subtotal and the reason it is held up, and a group whose
 * every problem is the same product question can be matched once for all of
 * them. Individual phones are rendered only when their group is opened.
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
  const clear = useFileBatch((s) => s.clear);
  const restore = useFileBatch((s) => s.restore);

  const [step, setStep] = useState<Step>('review');
  const [filter, setFilter] = useState<'all' | EntryState>('all');
  /** Which groups are open. Kept by key, so filtering never closes them. */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
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
   * from the scanned delivery's draft, which is left exactly as it was.
   */
  const draft = useDraft('receive.file', batch, (saved) => { if (saved?.parsed) restore(saved); }, { enabled: !done });

  const counts = batch ? batchCounts(batch) : null;
  const groups = useMemo(() => (batch ? groupEntries(batch) : []), [batch]);
  const items = batch ? purchaseItems(batch) : [];
  /** Bound to the payload: editing the batch changes the key, so a stale replay cannot answer. */
  const clientUuid = batch ? batchFingerprint(items, { method: payment.method, receivingAccountId: payment.receivingAccountId }) : '';

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
    setOpened((open) => ({ ...open, [key]: !open[key] }));
  }, []);

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
      const summary = groupSummary(batch, g);
      return summary.needsAttention === 0 || summary.matchableKeys.length > 0;
    });

  const visibleGroups = groups.filter((group) => {
    if (filter === 'all') return true;
    return group.entries.some((e) => entryState(batch, e) === filter);
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
    const keys = groupSummary(batch, group).matchableKeys;
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
        data={visibleGroups}
        keyExtractor={(group) => group.key}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        // Collapsed cards are cheap; a group's phones exist only while it is open.
        initialNumToRender={8}
        windowSize={7}
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
                    const first = groups.find((g) => groupSummary(batch, g).matchableKeys.length > 0);
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
        renderItem={({ item: group }) => (
          <GroupCard
            group={group}
            batch={batch}
            filter={filter}
            open={Boolean(opened[group.key])}
            onToggle={() => toggleGroup(group.key)}
            onMatch={() => setMatching(group)}
            onEdit={setEditing}
            onToggleExclude={(entry) => setExcluded(entry.key, entryState(batch, entry) !== 'excluded')}
          />
        )}
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
        count={matching ? groupSummary(batch, matching).matchableKeys.length : 0}
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
 * One exact variant of phone, as the delivery lists it.
 *
 * Collapsed it is a count, a subtotal and the reason it is held up. The
 * individual phones are mounted only when it is opened, so a file of two
 * thousand costs no more to scroll than one of ten.
 */
function GroupCard({
  group,
  batch,
  filter,
  open,
  onToggle,
  onMatch,
  onEdit,
  onToggleExclude,
}: {
  group: EntryGroup;
  batch: Parameters<typeof groupSummary>[0];
  filter: 'all' | EntryState;
  open: boolean;
  onToggle: () => void;
  onMatch: () => void;
  onEdit: (entry: FileEntry) => void;
  onToggleExclude: (entry: FileEntry) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const summary = groupSummary(batch, group);
  const subtitle = [group.category, group.variant].filter(Boolean).join(' · ');
  const shown = group.entries.filter((e) => filter === 'all' || entryState(batch, e) === filter);

  const status = summary.needsAttention === 0
    ? summary.excluded === summary.phones
      ? t('fileReceive.state.excluded')
      : t('fileReceive.group.ready')
    : summary.reason
      ? t(`fileReceive.problem.${summary.reason}` as never)
      : t('fileReceive.group.mixed', { count: String(summary.needsAttention) });

  return (
    <Card style={styles.group}>
      <Text variant="title">{group.label}</Text>
      {subtitle ? (
        <Text variant="caption" tone="secondary">
          {subtitle}
        </Text>
      ) : null}
      <Text variant="body" tone="secondary">
        {t('fileReceive.group.countCost', { count: String(summary.phones), total: formatMoney(summary.subtotal) })}
      </Text>
      <Text variant="body" tone={summary.needsAttention > 0 ? 'warning' : 'secondary'}>
        {t('fileReceive.group.status', { status })}
      </Text>

      <View style={styles.groupActions}>
        {summary.matchableKeys.length > 0 ? (
          <Button
            title={t('fileReceive.match.action', { count: String(summary.matchableKeys.length) })}
            variant="secondary"
            size="sm"
            onPress={onMatch}
          />
        ) : null}
        <Button
          title={open ? t('fileReceive.group.hide') : t('fileReceive.group.review', { count: String(shown.length) })}
          variant="tertiary"
          size="sm"
          icon={open ? ChevronDown : ChevronRight}
          onPress={onToggle}
        />
      </View>

      {open
        ? shown.map((entry) => (
            <EntryCard
              key={entry.key}
              entry={entry}
              state={entryState(batch, entry)}
              cost={effectiveCost(batch, entry)}
              imei2={effectiveImei2(batch, entry)}
              corrected={Boolean(batch.corrections[entry.key])}
              problems={remainingProblems(entry, batch.corrections[entry.key])}
              onEdit={() => onEdit(entry)}
              onToggleExclude={() => onToggleExclude(entry)}
            />
          ))
        : null}
    </Card>
  );
}

/**
 * One physical phone.
 *
 * Every value is labelled, because an unlabelled column of fifteen digits is
 * unreadable and two IMEIs printed one under the other look like two phones.
 * They are one: IMEI 2 is named as such, under the same card, above the same
 * cost.
 *
 * A warning sits beside the reason, never beside the price — a correct price on
 * a phone whose product is unknown is still a correct price.
 */
function EntryCard({
  entry,
  state,
  cost,
  imei2,
  corrected,
  problems,
  onEdit,
  onToggleExclude,
}: {
  entry: FileEntry;
  state: EntryState;
  cost: number | null;
  imei2: string | null;
  corrected: boolean;
  problems: string[];
  onEdit: () => void;
  onToggleExclude: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const source = entry.source.sheet
    ? t('fileReceive.source.row', { sheet: entry.source.sheet, row: String(entry.source.row ?? '') })
    : t('fileReceive.source.page', { page: String(entry.source.page ?? '') });

  return (
    <View style={styles.entry}>
      <Divider />
      <Field label={t('fileReceive.field.imei1')} value={entry.extracted.imei1 ?? entry.extracted.serial ?? t('fileReceive.noIdentifier')} />
      {imei2 ? <Field label={t('fileReceive.field.imei2')} value={imei2} /> : null}
      <Field label={t('fileReceive.field.cost')} value={cost !== null ? formatMoney(cost) : t('fileReceive.field.noCost')} />
      <Field label={t('fileReceive.field.source')} value={source} />

      {state === 'excluded' ? (
        <Text variant="caption" tone="tertiary">
          {t('fileReceive.state.excluded')}
        </Text>
      ) : null}
      {corrected ? (
        <Text variant="caption" tone="accent">
          {t('fileReceive.corrected', {
            cost: entry.extracted.cost !== null ? formatMoney(entry.extracted.cost) : '—',
          })}
        </Text>
      ) : null}
      {problems.length > 0 ? (
        <InlineNotice tone="warning">
          {problems.map((p) => t(`fileReceive.problem.${p}` as never)).join(' · ')}
        </InlineNotice>
      ) : null}

      <View style={styles.rowActions}>
        <Button title={t('fileReceive.fix')} variant="secondary" size="sm" icon={PlusCircle} onPress={onEdit} />
        <Button
          title={state === 'excluded' ? t('fileReceive.include') : t('fileReceive.exclude')}
          variant="tertiary"
          size="sm"
          icon={MinusCircle}
          onPress={onToggleExclude}
        />
      </View>
    </View>
  );
}

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

const useStyles = makeStyles(() => ({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  header: { gap: space.base },
  stack: { gap: space.sm },
  breakdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  breakdownLabel: { flexShrink: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  group: { gap: space.xs },
  groupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  entry: { gap: space.xs, paddingTop: space.sm },
  field: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: space.xs },
  fieldLabel: { minWidth: 72 },
  fieldValue: { flexShrink: 1 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  tail: { gap: space.sm, paddingTop: space.base },
  footer: { gap: space.xs },
  footerCounts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  sheet: { gap: space.sm, padding: space.base },
}));
