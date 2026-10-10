import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ArrowRightLeft, SlidersHorizontal } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FilterChip,
  MoneyValue,
  PermissionNotice,
  Screen,
  SearchInput,
  SkeletonList,
  TabHeader,
  Text,
} from '../../components/ui';
import { BottomSheet } from '../../components/overlay';
import { AccessNotice } from '../../components/access';
import { QueuedExchange } from '../../components/agent/QueuedExchange';
import { useAuth } from '../../hooks/useAuth';
import { activityAllows } from '../../lib/activity';
import { useAgentPositions, useAgentProviders, useAgentTransactions, type AgentTransaction } from '../../lib/agent';
import { exchangeOutcome, outcomeChip } from '../../lib/agent-counter';
import { prepareAgain, useExchangeScope } from '../../lib/agent-queue';
import { directionRowKey, HISTORY_PERIODS, periodRange, queuedFirst, searchFilter, type HistoryPeriod, type SearchMode } from '../../lib/agent-history';
import { DIRECTIONS, type AgentDirection } from '../../lib/agent-rules';
import { useBranch } from '../../lib/branch';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useBranchActivity, useBusinessAccess } from '../../lib/entitlement';
import { formatSmartDateTime, formatTime } from '../../lib/format';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { tabLabelKey } from '../../lib/navigation/registry';
import { isExchangePayload } from '../../lib/offline/agent-exchange';
import { useQueue } from '../../lib/offline/queue';
import type { QueueItem } from '../../lib/offline/queue-rules';
import { usePermission } from '../../lib/permissions';
import { localDay } from '../../lib/sale-payment-rules';
import { toast } from '../../lib/toast';

/**
 * The counter's exchanges — Transactions on an agent-only branch, Exchanges on
 * a combined one (docs/73 §5, D157).
 *
 * The exchanges this phone still holds come first, each with its state in
 * words (D161) — *Pending synchronization*, *Checking whether it was recorded*,
 * *Not recorded*, *Not recorded here* — never with a time the server did not
 * give them. Then the branch's exchanges from the server, newest first,
 * masked: the direction in words, the provider, the amount, `•••• 1234`, who
 * recorded it and when, and whether it was reversed. Every filter — the
 * period, the provider, the direction, who recorded it, the last four digits,
 * a reference — goes to the server.
 *
 * Reads are never refused for the branch's activity: a branch that left the
 * counter keeps its history here. Recording a new one needs the activity.
 */
export default function AgentTransactionsTab() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const activity = useBranchActivity();
  const access = useBusinessAccess();
  const canView = usePermission('agent.transaction.view');
  const canRecord = usePermission('agent.transaction.record') && activityAllows(activity, 'money_agent');

  const [period, setPeriod] = useState<HistoryPeriod>('today');
  const [mode, setMode] = useState<SearchMode>('number');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [direction, setDirection] = useState<AgentDirection | null>(null);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [reversedOnly, setReversedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [queued, setQueued] = useState<QueueItem | null>(null);

  // The branch's business day is the server's (the positions say it); the phone's date only until it answers.
  const positions = useAgentPositions({ enabled: canView });
  const businessDate = positions.data?.businessDate ?? localDay(new Date());
  const providers = useAgentProviders({ enabled: canView });
  const providerList = providers.data?.providers ?? [];
  const labelOf = (id: string) => providerList.find((p) => p.id === id)?.label ?? '';

  const searched = searchFilter(mode, search);
  const filters = {
    ...periodRange(period, businessDate),
    ...(providerId ? { providerId } : {}),
    ...(direction ? { direction } : {}),
    ...(who ? { recordedById: who.id } : {}),
    ...(reversedOnly ? { status: 'reversed' as const } : {}),
    ...(searched ?? {}),
  };
  const page = useAgentTransactions(filters, { enabled: canView && searched !== null });
  const pages = page.data?.pages;
  const rows = useMemo(() => pages?.flatMap((p) => p.rows) ?? [], [pages]);

  // The people seen in the list, to filter by — the person signed in always among them.
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    if (user) seen.set(user.id, user.name ?? '');
    for (const r of rows) seen.set(r.recordedBy.id, r.recordedBy.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows, user]);

  const items = useQueue((s) => s.items);
  const pending = queuedFirst(items, branchId);
  const scope = useExchangeScope();
  const extraFilters = (providerId ? 1 : 0) + (direction ? 1 : 0) + (who ? 1 : 0) + (reversedOnly ? 1 : 0);
  const title = t(tabLabelKey('agent', activity));

  if (!canView) {
    return (
      <Screen>
        <TabHeader context={branchName} title={title} />
        <PermissionNotice message={t('agent.permission.view')} />
      </Screen>
    );
  }

  const onPrepareAgain = async (item: QueueItem) => {
    if (!scope) return;
    const done = await prepareAgain(item, scope);
    setQueued(null);
    if (done === 'prepared') router.push('/agent/new' as Href);
    else if (done === 'busy') toast.info(t('agent.prepareAgain.busy'));
  };

  const header = (
    <View style={styles.header}>
      <TabHeader
        context={branchName}
        title={title}
        actions={
          canRecord && access.canWrite ? (
            <Button title={t('nav.agent.new')} icon={ArrowRightLeft} size="sm" onPress={() => router.push('/agent/new' as Href)} />
          ) : null
        }
      />
      <AccessNotice />
      <SearchInput
        value={typed}
        onChangeText={setTyped}
        onDebouncedChange={setSearch}
        placeholder={mode === 'number' ? t('agent.search.number') : t('agent.search.reference')}
        identifier
      />
      <View style={styles.chips}>
        <FilterChip label={t('agent.search.byNumber')} selected={mode === 'number'} onPress={() => setMode('number')} />
        <FilterChip label={t('agent.search.byReference')} selected={mode === 'reference'} onPress={() => setMode('reference')} />
      </View>
      {searched === null ? (
        <Text variant="caption" tone="warning">
          {mode === 'number' ? t('agent.search.number.hint') : t('agent.search.reference.hint')}
        </Text>
      ) : null}
      <FlatList
        horizontal
        data={HISTORY_PERIODS}
        keyExtractor={(p) => p}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        renderItem={({ item }) => <FilterChip label={t(`agent.period.${item}` as TranslationKey)} selected={period === item} onPress={() => setPeriod(item)} />}
      />
      <Button
        title={extraFilters > 0 ? t('agent.filters.count', { count: extraFilters }) : t('agent.filters')}
        icon={SlidersHorizontal}
        variant="tertiary"
        size="sm"
        onPress={() => setFiltersOpen(true)}
      />
      {pending.length > 0 ? (
        <View style={styles.pending}>
          <Text variant="label" tone="secondary">
            {t('agent.list.onThisPhone')}
          </Text>
          {pending.map((item) => (
            <QueuedRow key={item.id} item={item} provider={isExchangePayload(item.payload) ? labelOf(item.payload.providerId) : ''} onPress={() => setQueued(item)} />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      {page.isError ? (
        <View style={styles.list}>
          {header}
          <ErrorState error={page.error} onRetry={() => void page.refetch()} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          refreshing={page.isRefetching}
          onRefresh={() => void page.refetch()}
          ListEmptyComponent={
            page.isLoading ? (
              <SkeletonList count={4} />
            ) : (
              <EmptyState title={t('agent.list.empty')} body={extraFilters > 0 || search.trim() || period !== 'all' ? t('agent.list.empty.filtered') : t('agent.list.empty.body')} />
            )
          }
          renderItem={({ item }) => <ExchangeRow row={item} onPress={() => router.push(`/agent/${item.id}` as Href)} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
          }}
          ListFooterComponent={
            page.isFetchingNextPage ? (
              <SkeletonList count={2} />
            ) : rows.length > 0 && !page.hasNextPage ? (
              <Text variant="caption" tone="tertiary" style={styles.end}>
                {t('agent.list.end')}
              </Text>
            ) : null
          }
        />
      )}

      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t('agent.filters')}
        footer={
          <Button
            title={t('agent.filters.clear')}
            variant="secondary"
            fullWidth
            onPress={() => {
              setProviderId(null);
              setDirection(null);
              setWho(null);
              setReversedOnly(false);
            }}
          />
        }
      >
        <View style={styles.sheet}>
          <Text variant="label">{t('agent.filters.provider')}</Text>
          <View style={styles.wrap}>
            <FilterChip label={t('agent.filters.any')} selected={providerId === null} onPress={() => setProviderId(null)} />
            {providerList.map((p) => (
              <FilterChip key={p.id} label={p.label} selected={providerId === p.id} onPress={() => setProviderId(p.id)} />
            ))}
          </View>
          <Text variant="label">{t('agent.filters.direction')}</Text>
          <View style={styles.wrap}>
            <FilterChip label={t('agent.filters.any')} selected={direction === null} onPress={() => setDirection(null)} />
            {DIRECTIONS.map((d) => (
              <FilterChip key={d} label={t(`agent.summary.${d}`)} selected={direction === d} onPress={() => setDirection(d)} />
            ))}
          </View>
          <Text variant="label">{t('agent.filters.who')}</Text>
          <View style={styles.wrap}>
            <FilterChip label={t('agent.filters.everyone')} selected={who === null} onPress={() => setWho(null)} />
            {people.map((p) => (
              <FilterChip key={p.id} label={p.id === user?.id ? t('agent.filters.me') : p.name} selected={who?.id === p.id} onPress={() => setWho(p)} />
            ))}
          </View>
          <Text variant="label">{t('agent.filters.status')}</Text>
          <View style={styles.wrap}>
            <FilterChip label={t('agent.filters.any')} selected={!reversedOnly} onPress={() => setReversedOnly(false)} />
            <FilterChip label={t('agent.status.reversed')} selected={reversedOnly} onPress={() => setReversedOnly(true)} />
          </View>
        </View>
      </BottomSheet>

      <BottomSheet open={queued !== null} onClose={() => setQueued(null)} title={queued?.summary}>
        {queued ? (
          <View style={styles.sheet}>
            <QueuedExchange item={items.find((i) => i.id === queued.id) ?? queued} onPrepareAgain={() => void onPrepareAgain(queued)} />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

/** One exchange from the server: the direction in words, the provider, the amount, the masked number, who and when. */
function ExchangeRow({ row, onPress }: { row: AgentTransaction; onPress: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const openMistake = row.mistakes.some((m) => m.status === 'open');
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.row}>
        <View style={styles.rowHead}>
          <Text variant="bodyStrong" style={styles.grow}>
            {t(directionRowKey(row.direction) as TranslationKey, { provider: row.providerLabel })}
          </Text>
          <MoneyValue value={row.amount} size="small" />
        </View>
        <View style={styles.rowFoot}>
          <Text variant="caption" tone="secondary">
            {isolateLtr(row.customerNumberMasked)}
          </Text>
          <Text variant="caption" tone="tertiary" style={styles.grow} numberOfLines={1}>
            {`${row.recordedBy.name} · ${formatSmartDateTime(row.recordedAt)}`}
          </Text>
          {row.status === 'reversed' ? <Chip label={t('agent.status.reversed')} tone="neutral" size="sm" /> : null}
          {openMistake ? <Chip label={t('agent.status.mistake')} tone="warning" size="sm" /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * One exchange this phone still holds: never a server time, never "recorded" — its state in words beside its
 * colour (D161): pending, checking whether it was recorded, not recorded, or not recorded here.
 */
function QueuedRow({ item, provider, onPress }: { item: QueueItem; provider: string; onPress: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (!isExchangePayload(item.payload)) return null;
  const chip = outcomeChip(exchangeOutcome(item.state));
  const attention = chip.tone === 'warning';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={`queued-${item.id}`}>
      <Card variant={attention ? 'warning' : 'sunken'} style={styles.row}>
        <View style={styles.rowHead}>
          <Text variant="bodyStrong" style={styles.grow}>
            {t(directionRowKey(item.payload.direction) as TranslationKey, { provider: provider || t('agent.credit.digital') })}
          </Text>
          <MoneyValue value={item.payload.amount} size="small" />
        </View>
        <View style={styles.rowFoot}>
          <Chip label={t(chip.key as TranslationKey)} tone={chip.tone} size="sm" dot />
          <Text variant="caption" tone="tertiary">
            {t('agent.list.phoneTime', { time: isolateLtr(formatTime(item.payload.deviceRecordedAt)) })}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { backgroundColor: colors.surface.canvas, paddingBottom: space.sm, gap: space.sm },
  chips: { flexDirection: 'row', gap: space.xs, paddingVertical: space.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  pending: { gap: space.sm, marginTop: space.sm },
  list: { padding: space.base, paddingBottom: space['3xl'] },
  gap: { height: space.sm },
  row: { gap: space.xs },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowFoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1, minWidth: 0 },
  sheet: { gap: space.md },
  end: { textAlign: 'center', paddingVertical: space.base },
}));
