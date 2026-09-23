import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format as formatDateFns, isToday, isYesterday } from 'date-fns';
import { ChevronRight, PackagePlus, ScanLine, ShoppingCart, Truck, Undo2, Wallet, type LucideIcon } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  InlineNotice,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
  SegmentedControl,
  SkeletonStat,
  TabHeader,
  Text,
} from '../../components/ui';
import { SalesBars } from '../../components/home/SalesBars';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { useBranch } from '../../lib/branch';
import { useAuth } from '../../hooks/useAuth';
import { useConnectivity } from '../../lib/connectivity';
import { dateLocaleFor } from '../../lib/date-locale';
import { usePermission, usePermissionStatus } from '../../lib/permissions';
import { getLanguage, t as translate, useTranslation } from '../../lib/i18n';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { CURRENCY_CODE, formatDayRange, formatMoney, formatRelative, formatTime } from '../../lib/format';
import { freshness, standingKey, standingTone, type HomePeriod, HOME_PERIODS } from '../../lib/home-day';
import { useHome, type HomeArrival, type HomeBar } from '../../lib/home';
import type { RefundSummary, ReturnPage, TransferCounts } from '../../types/api';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Home — the fastest operational screen (docs/50 §3.5).
 *
 * Greeting, the two counter actions, what is waiting on this person, then one
 * read of the server: the period's sales value, collected, expenses and what
 * is still owed on those sales, the bars that add up to that value, the top
 * boutique of all time, the three latest phones received, and where the
 * business day stands. Every figure, date and bar is the server's, keyed on
 * the branch's business date; without `report.view` the server sends no
 * figures and this screen shows none — never a zero.
 */
export default function HomeScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const offline = !useConnectivity((s) => s.online);
  const [period, setPeriod] = useState<HomePeriod>('week');

  const permissionsReady = usePermissionStatus() === 'ready';
  const canSell = usePermission('sale.create');
  const canReceive = usePermission('purchase.manage');
  const canViewTransfers = usePermission('transfer.view');
  const canViewReturns = usePermission('return.view');
  const shortcutsReady = Boolean(branchId) && permissionsReady;

  const home = useHome(period, { enabled: permissionsReady });
  const transfers = useQuery({
    queryKey: qk.transferCounts(branchId),
    queryFn: () => api.get<TransferCounts>('/transfers/counts'),
    enabled: canViewTransfers,
  });
  const refunds = useQuery({
    queryKey: qk.refundSummary(branchId, 'home'),
    queryFn: () => api.get<RefundSummary>('/returns/refunds/summary'),
    enabled: canViewReturns,
  });
  const pendingReturns = useQuery({
    queryKey: qk.returns(branchId, 'home-pending'),
    queryFn: () => api.get<ReturnPage>('/returns?status=pending_investigation,under_review'),
    enabled: canViewReturns,
  });

  const onRefresh = () => {
    void home.refetch();
    void transfers.refetch();
    void refunds.refetch();
    void pendingReturns.refetch();
  };

  const pendingTransferCount = transfers.data?.pendingApproval ?? 0;
  const awaitingRefundCount = refunds.data?.awaitingConfirmation.count ?? 0;
  const returnRows = pendingReturns.data?.rows.length ?? 0;
  const returnsMore = Boolean(pendingReturns.data?.nextCursor);
  const hasPendingWork = pendingTransferCount > 0 || awaitingRefundCount > 0 || returnRows > 0;

  const firstName = user?.name?.trim().split(/\s+/)[0];
  const data = home.data;
  const figures = data?.figures ?? null;
  const periodWord = t(`period.${period}` as never);
  const fresh = freshness(home.dataUpdatedAt || null);

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={home.isRefetching} gap="lg">
      <TabHeader
        context={branchName ?? t('home.branch.unknown')}
        title={firstName ? t('home.welcome.hello', { name: firstName }) : t('home.title')}
        subtitle={shortcutsReady ? t('home.welcome.ready') : t('home.welcome.preparing')}
        bell
      />

      {/* ── The two counter actions, side by side ── */}
      {canSell || canReceive ? (
        <View style={styles.shortcuts}>
          <View style={styles.actionRow}>
            {canSell ? (
              <Button
                title={t('home.shortcut.sell')}
                icon={ScanLine}
                size="lg"
                disabled={!shortcutsReady}
                onPress={() => router.push('/quick-sell' as Href)}
                accessibilityHint={t('home.shortcut.sell.hint')}
                style={styles.action}
              />
            ) : null}
            {canReceive ? (
              <Button
                title={t('home.shortcut.receive')}
                icon={PackagePlus}
                variant="secondary"
                size="lg"
                disabled={!shortcutsReady}
                onPress={() => router.push('/quick-receive' as Href)}
                accessibilityHint={t('home.shortcut.receive.hint')}
                style={styles.action}
              />
            ) : null}
          </View>
          {canSell ? (
            <Button
              title={t('home.shortcut.fullSale')}
              icon={ChevronRight}
              iconPosition="end"
              variant="tertiary"
              size="sm"
              disabled={!shortcutsReady}
              onPress={() => router.push('/(tabs)/sell')}
              style={styles.fullSale}
            />
          ) : null}
        </View>
      ) : null}

      {/* ── What is waiting on you ── */}
      {hasPendingWork ? (
        <Section title={t('home.pending.title')}>
          <RowGroup>
            {pendingTransferCount > 0 ? (
              <PendingRow icon={Truck} label={t('home.pending.transfers')} count={String(pendingTransferCount)} onPress={() => router.push('/transfers' as Href)} />
            ) : null}
            {returnRows > 0 ? (
              <PendingRow icon={Undo2} label={t('home.pending.returns')} count={returnsMore ? `${returnRows}+` : String(returnRows)} onPress={() => router.push('/returns' as Href)} />
            ) : null}
            {awaitingRefundCount > 0 ? (
              <PendingRow icon={Wallet} label={t('home.pending.refunds')} count={String(awaitingRefundCount)} onPress={() => router.push('/returns' as Href)} />
            ) : null}
          </RowGroup>
        </Section>
      ) : null}

      {/* ── The period, and the figures the server gives for it ── */}
      {home.isError && !data ? (
        <InlineNotice
          tone="warning"
          title={t('home.month.unavailable')}
          action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void home.refetch()} />}
        >
          {t('home.today.unavailable.body')}
        </InlineNotice>
      ) : null}

      {data?.figures !== undefined || home.isPending ? (
        <View style={styles.block}>
          <SegmentedControl<HomePeriod>
            value={period}
            onChange={setPeriod}
            options={HOME_PERIODS.map((k) => ({ value: k, label: t(`period.${k}` as never) }))}
          />
          {offline && data ? <InlineNotice tone="warning">{t('home.month.offline')}</InlineNotice> : null}

          {home.isPending ? (
            <>
              <SkeletonStat />
              <View style={styles.statRow}>
                <SkeletonStat />
                <SkeletonStat />
                <SkeletonStat />
              </View>
            </>
          ) : figures && data?.series ? (
            <>
              <View>
                <Text variant="body" tone="secondary">
                  {t('home.sales.value')}
                </Text>
                <MoneyValue value={figures.salesValue} size="display" accessibilityLabel={`${t('home.sales.value')} ${formatMoney(figures.salesValue)}`} />
                <Text variant="caption" tone="tertiary">
                  {formatDayRange(data.range.from, data.range.to)}
                </Text>
              </View>

              <View style={styles.statRow}>
                <Figure label={t('home.sales.collected')} value={figures.collected} tone="success" />
                <Figure label={t('home.sales.expenses')} value={figures.expenses} tone="primary" divider />
                <Figure label={t('home.sales.owed')} value={figures.stillOwed} tone={figures.stillOwed > 0 ? 'danger' : 'primary'} divider caption={t('home.sales.owed.scope')} />
              </View>

              <View style={styles.chart}>
                <Text variant="heading">{t(`home.chart.${period}` as never)}</Text>
                {data.series.total === 0 ? (
                  <Text variant="caption" tone="secondary">
                    {t('home.chart.empty')}
                  </Text>
                ) : null}
                <SalesBars bars={data.series.bars} unit={data.series.unit} labelOf={barLabel(data.series.unit)} />
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {data ? (
        <>
          <Text variant="label" tone="secondary">
            {t('home.context', { branch: branchName ?? '', period: periodWord })}
          </Text>

          {/* ── Top boutique · all time ── */}
          {data.partners.available ? (
            <Card style={styles.card}>
              <View style={styles.cardHead}>
                <Text variant="heading" style={styles.flex}>
                  {t('home.top.title')}
                </Text>
                <SeeMore onPress={() => router.push('/partners/ranking' as Href)} />
              </View>
              {data.topPartner ? (
                <>
                  <Text variant="title" numberOfLines={2}>
                    {data.topPartner.name}
                  </Text>
                  <Divider />
                  <View style={styles.between}>
                    <Text variant="body" tone="secondary">
                      {t('home.top.trades', { count: String(data.topPartner.completedTrades) })}
                    </Text>
                    <MoneyValue value={data.topPartner.value} size="large" />
                  </View>
                </>
              ) : (
                <View style={styles.emptyInCard}>
                  <Text variant="bodyStrong">{data.partners.partnersExist ? t('home.top.empty.title') : t('home.top.empty.title')}</Text>
                  <Text variant="caption" tone="secondary">
                    {data.partners.partnersExist ? t('home.top.empty.body') : t('home.top.noPartners')}
                  </Text>
                </View>
              )}
            </Card>
          ) : null}

          {/* ── Latest phones received ── */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Text variant="heading" style={styles.flex}>
                {t('home.arrivals.title')}
              </Text>
              <SeeMore onPress={() => router.push({ pathname: '/(tabs)/inventory', params: { category: 'phone', status: 'all', sort: 'received' } } as Href)} />
            </View>
            {data.arrivals.length === 0 ? (
              <Text variant="caption" tone="secondary">
                {t('home.arrivals.empty')}
              </Text>
            ) : (
              data.arrivals.map((a, i) => (
                <View key={a.unitId}>
                  {i > 0 ? <Divider /> : null}
                  <ArrivalRow arrival={a} />
                </View>
              ))
            )}
          </Card>

          {/* ── The business day ── */}
          {data.closing ? (
            <Card style={styles.card}>
              <View style={styles.closingRow}>
                <View style={styles.flex}>
                  <Text variant="heading">{t('home.closing.title')}</Text>
                  <View style={styles.standingLine}>
                    <Text variant="body" tone="secondary">
                      {t('home.closing.today', { standing: t(standingKey(data.closing.standing) as never) })}
                    </Text>
                  </View>
                  {data.closing.previousDay.needsReview ? (
                    <Chip tone="warning" label={t('home.closing.previous')} size="sm" dot style={styles.previousChip} />
                  ) : null}
                </View>
                <Button title={t('home.closing.review')} variant="secondary" onPress={() => router.push('/closing' as Href)} />
              </View>
            </Card>
          ) : null}

          {/* Honest about age: live within a minute, dated after, offline said outright. */}
          <Text variant="caption" tone="tertiary">
            {offline
              ? t('home.offline.stale', { time: formatRelative(home.dataUpdatedAt) })
              : fresh === 'now'
                ? t('home.refreshed.now')
                : t('home.refreshed.at', { time: formatRelative(home.dataUpdatedAt) })}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

/** One of the three figures under the sales value: a word, a number, the unit. */
function Figure({ label, value, tone, divider, caption }: { label: string; value: number; tone: 'success' | 'danger' | 'primary'; divider?: boolean; caption?: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={[styles.figure, divider && styles.figureDivider]} accessible accessibilityLabel={`${label} ${formatMoney(value)}${caption ? `, ${caption}` : ''}`}>
      <Text variant="caption" tone="secondary" numberOfLines={2}>
        {label}
      </Text>
      <MoneyValue value={value} size="large" tone={tone === 'success' ? 'positive' : tone === 'danger' ? 'negative' : 'default'} showCurrency={false} />
      <Text variant="caption" tone="tertiary">
        {isolateLtr(CURRENCY_CODE)}
      </Text>
      {caption ? (
        <Text variant="caption" tone="tertiary" numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
      {/* Rendered for the screen reader only when there is nothing else to say. */}
      {!caption && value === 0 ? <Text variant="caption" tone="tertiary" style={styles.srOnly}>{t('home.chart.empty')}</Text> : null}
    </View>
  );
}

function SeeMore({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return <Button title={t('home.seeMore')} icon={ChevronRight} iconPosition="end" variant="tertiary" size="sm" onPress={onPress} />;
}

/**
 * One phone that arrived: model, when, and the last four digits — never the
 * full identifier. Not a link: the identifier needed to open a unit is exactly
 * what Home does not carry; "See more" opens the Stock list instead.
 */
function ArrivalRow({ arrival }: { arrival: HomeArrival }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const colors = useColors();
  const when = receivedWhen(arrival.receivedAt);
  const masked = t(arrival.identifierKind === 'imei' ? 'home.arrivals.imei' : 'home.arrivals.serial', { last4: arrival.identifierLast4 });
  return (
    <ListRow
      flat
      title={arrival.label}
      subtitle={when}
      value={<Text variant="body" style={{ color: colors.text.secondary }}>{isolateLtr(masked)}</Text>}
      style={styles.arrival}
    />
  );
}

/** "Today · 14:20", "Yesterday · 17:05", otherwise "21 Sep · 10:30". */
function receivedWhen(iso: string): string {
  const d = new Date(iso);
  const time = formatTime(d);
  if (isToday(d)) return `${translate('history.today')} · ${time}`;
  if (isYesterday(d)) return `${translate('history.yesterday')} · ${time}`;
  return `${formatDateFns(d, 'd MMM', { locale: dateLocaleFor(getLanguage()) })} · ${time}`;
}

/** The printed label of a bar: the hour, the weekday, or the span of days. */
function barLabel(unit: 'hour' | 'day' | 'week'): (bar: HomeBar) => string {
  if (unit === 'day') return (bar) => formatDateFns(new Date(`${bar.from}T12:00:00Z`), 'EEE', { locale: dateLocaleFor(getLanguage()) });
  if (unit === 'week') return (bar) => bar.label;
  return (bar) => bar.label;
}

/** Outstanding work — warning-toned, because it is somebody's unfinished business. */
function PendingRow({ icon, label, count, onPress }: { icon: LucideIcon; label: string; count: string; onPress: () => void }) {
  return <ListRow flat leading={icon} title={label} value={count} valueTone="warning" onPress={onPress} />;
}

const useStyles = makeStyles((colors) => ({
  shortcuts: { gap: space.xs },
  actionRow: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
  fullSale: { alignSelf: 'center' },
  block: { gap: space.base },
  statRow: { flexDirection: 'row', gap: space.sm },
  figure: { flex: 1, gap: 2, minWidth: 0 },
  figureDivider: { borderStartWidth: 1, borderStartColor: colors.border.subtle, paddingStart: space.sm },
  chart: { gap: space.sm },
  card: { gap: space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  emptyInCard: { gap: 2 },
  arrival: { paddingHorizontal: 0 },
  closingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  standingLine: { marginTop: 2 },
  previousChip: { alignSelf: 'flex-start', marginTop: space.xs },
  flex: { flex: 1, minWidth: 0 },
  srOnly: { height: 0, opacity: 0 },
}));
