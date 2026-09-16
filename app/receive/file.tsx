import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FileSpreadsheet, MinusCircle, PlusCircle } from 'lucide-react-native';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  FilterChip,
  InlineNotice,
  ListRow,
  MoneyField,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
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
  groupEntries,
  purchaseItems,
  remainingProblems,
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
 * Three rules it exists to keep:
 *
 * 1. **Nothing is received quietly.** A phone with a problem must be corrected
 *    or excluded; the app never receives "the good rows" and drops the rest.
 * 2. **The file's own words are never overwritten.** A correction sits beside
 *    what was extracted, and a bulk edit says how many phones it will change
 *    before it changes them.
 * 3. **Confirmation is an ordinary purchase**, paid in full through
 *    `POST /purchases`, with a key bound to exactly what is being received — so
 *    a double tap or a retry after a timeout returns the same receipt instead of
 *    buying the delivery twice.
 */
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

  const [filter, setFilter] = useState<'all' | EntryState>('all');
  const [payment, setPayment] = useState<PurchasePayment>({ method: 'cash', receivingAccountId: null });
  const [editing, setEditing] = useState<FileEntry | null>(null);
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

  const visible = (entry: FileEntry) => filter === 'all' || entryState(batch, entry) === filter;
  const attentionKeys = batch.parsed.entries.filter((e) => entryState(batch, e) === 'needs_attention').map((e) => e.key);

  const excludeAllProblems = async () => {
    const ok = await dialog.confirm({
      title: t('fileReceive.excludeAll.title', { count: String(attentionKeys.length) }),
      message: t('fileReceive.excludeAll.body'),
      confirmLabel: t('fileReceive.exclude'),
    });
    if (ok) excludeMany(attentionKeys, true);
  };

  const applyBulkCost = async () => {
    const value = Number(bulkCost);
    const keys = batch.parsed.entries.filter((e) => visible(e) && entryState(batch, e) !== 'excluded').map((e) => e.key);
    if (!(value > 0) || keys.length === 0) return;
    const ok = await dialog.confirm({
      title: t('fileReceive.bulkCost.title', { count: String(keys.length) }),
      message: t('fileReceive.bulkCost.body', { amount: formatMoney(value) }),
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

  return (
    <Screen
      scroll={false}
      footer={
        <>
          <View style={styles.totals}>
            <Text variant="body" tone="secondary">
              {t('fileReceive.payable', { count: String(counts.ready) })}
            </Text>
            <Text variant="title">{formatMoney(counts.selectedCost)}</Text>
          </View>
          <PurchasePaymentPicker value={payment} onChange={setPayment} />
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
          <Button title={t('action.cancel')} variant="tertiary" size="sm" onPress={() => void cancel()} />
        </>
      }
    >
      <Stack.Screen options={{ headerShown: true, title: t('fileReceive.title') }} />

      <ScrollView contentContainerStyle={styles.list}>
        <DraftNotice draft={draft} onDiscard={() => { clear(); router.back(); }} />
        <Card style={styles.summary}>
          <Text variant="label" tone="secondary">
            {batch.parsed.filename}
          </Text>
          <Text variant="body">
            {t('fileReceive.summary', {
              phones: String(counts.phones),
              sheet: batch.parsed.sheets.find((s) => s.selected)?.name ?? '—',
            })}
          </Text>
          <Text variant="caption" tone="secondary">
            {t('fileReceive.branch', { branch: branchName ?? t('home.branch.unknown') })}
          </Text>
          {batch.parsed.imageOnlyPages.length > 0 ? (
            <InlineNotice tone="warning" title={t('fileReceive.imageOnly.title')}>
              {t('fileReceive.imageOnly.body', { pages: batch.parsed.imageOnlyPages.join(', ') })}
            </InlineNotice>
          ) : null}
        </Card>

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

        {counts.needsAttention > 0 ? (
          <InlineNotice tone="warning" title={t('fileReceive.attention.title', { count: String(counts.needsAttention) })}>
            <Text variant="caption" tone="secondary">
              {t('fileReceive.attention.body')}
            </Text>
            <Button title={t('fileReceive.excludeAll', { count: String(attentionKeys.length) })} variant="tertiary" size="sm" onPress={() => void excludeAllProblems()} />
          </InlineNotice>
        ) : null}

        {/* One explicit bulk edit, applied to what the filter is showing. */}
        <Disclosure title={t('fileReceive.bulk.title')}>
          <Text variant="caption" tone="secondary">
            {t('fileReceive.bulk.body')}
          </Text>
          <MoneyField label={t('fileReceive.bulkCost.label')} value={bulkCost} onChangeText={setBulkCost} />
          <Button title={t('fileReceive.bulkCost.apply')} variant="secondary" size="sm" disabled={!(Number(bulkCost) > 0)} onPress={() => void applyBulkCost()} />
        </Disclosure>

        {groups.map((group) => {
          const shown = group.entries.filter(visible);
          if (shown.length === 0) return null;
          return (
            <Section key={group.key} title={group.label} subtitle={[group.category, group.variant].filter(Boolean).join(' · ') || undefined}>
              <Card style={styles.group}>
                <Text variant="caption" tone="secondary">
                  {t('fileReceive.group.count', { count: String(shown.length) })}
                </Text>
                {shown.map((entry) => (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    state={entryState(batch, entry)}
                    cost={effectiveCost(batch, entry)}
                    imei2={effectiveImei2(batch, entry)}
                    corrected={Boolean(batch.corrections[entry.key])}
                    problems={remainingProblems(entry, batch.corrections[entry.key])}
                    onEdit={() => setEditing(entry)}
                    onToggleExclude={() => setExcluded(entry.key, entryState(batch, entry) !== 'excluded')}
                  />
                ))}
              </Card>
            </Section>
          );
        })}
      </ScrollView>

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
    </Screen>
  );
}

/** One phone: what the file said, what is wrong, and what it will cost. */
function EntryRow({
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
    <Disclosure
      title={entry.extracted.imei1 ?? entry.extracted.serial ?? t('fileReceive.noIdentifier')}
      summary={
        <View style={styles.rowRight}>
          {state === 'excluded' ? (
            <Text variant="caption" tone="tertiary">
              {t('fileReceive.state.excluded')}
            </Text>
          ) : state === 'needs_attention' ? (
            <AlertTriangle size={16} />
          ) : null}
          {cost !== null ? <MoneyValue value={cost} size="small" /> : null}
        </View>
      }
    >
      <Text variant="caption" tone="tertiary">
        {source}
      </Text>
      {imei2 ? (
        <Text variant="caption" tone="secondary">
          {t('fileReceive.imei2', { imei: imei2 })}
        </Text>
      ) : null}
      {corrected ? (
        <Text variant="caption" tone="accent">
          {t('fileReceive.corrected', {
            cost: entry.extracted.cost !== null ? formatMoney(entry.extracted.cost) : '—',
          })}
        </Text>
      ) : null}
      {problems.map((p) => (
        <Text key={p} variant="caption" tone="warning">
          {t(`fileReceive.problem.${p}` as never)}
        </Text>
      ))}
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
    </Disclosure>
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
  candidates: { id: string; brand: string; model: string; variant: string | null }[];
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
  summary: { gap: space.xs },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  group: { gap: space.xs },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  totals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  sheet: { gap: space.sm, padding: space.base },
}));
