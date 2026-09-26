import React, { useState } from 'react';
import { PixelRatio, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format as formatDateFns } from 'date-fns';
import { ChevronRight, PackagePlus, ScanLine, Truck, Undo2, Wallet, type LucideIcon } from 'lucide-react-native';
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
  Text,
} from '../../components/ui';
import { HomeHeader } from '../../components/home/HomeHeader';
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
import { radius, space } from '../../lib/design/tokens';
import { calendarDate } from '../../lib/day-range';
import { toFriendlyError } from '../../lib/errors';
import { CURRENCY_CODE, formatDate, formatDayRange, formatMoney, formatRelative } from '../../lib/format';
import { arrivalDay, changeText, changeTone, daySpan, freshness, standingKey, type HomePeriod, HOME_PERIODS } from '../../lib/home-day';
import { useHome, type HomeArrival, type HomeBar } from '../../lib/home';
import type { RefundSummary, ReturnPage, TransferCounts } from '../../types/api';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Home — the fastest operational screen (docs/50 §3.5, docs/56).
 *
 * The store's name and a greeting on one quiet tint, with the bell and the
 * store's date; the two counter actions; what is waiting on this person; then
 * one read of the server: the period's sales value with its bars and, when
 * the server could compare it, how it stands against the window before;
 * collected, expenses and what is still owed as three plain lines; the top
 * boutique of all time, the three latest phones received, and where the
 * business day stands. Every figure, date and bar is the server's, keyed on
 * the branch's business date; without `report.view` the server sends no
 * figures and this screen shows none — never a zero.
 */
export default function HomeScreen() {
  const styles = useStyles();
  const colors = useColors();
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

  /*
    Only what this person may read. `refetch()` runs a query even when it is disabled,
    so refreshing used to ask for transfers and returns a seller may not see — and the
    server answered each with a refusal.
  */
  const onRefresh = () => {
    if (permissionsReady) void home.refetch();
    if (canViewTransfers) void transfers.refetch();
    if (canViewReturns) {
      void refunds.refetch();
      void pendingReturns.refetch();
    }
  };

  const pendingTransferCount = transfers.data?.pendingApproval ?? 0;
  const awaitingRefundCount = refunds.data?.awaitingConfirmation.count ?? 0;
  const returnRows = pendingReturns.data?.rows.length ?? 0;
  const returnsMore = Boolean(pendingReturns.data?.nextCursor);
  const hasPendingWork = pendingTransferCount > 0 || awaitingRefundCount > 0 || returnRows > 0;

  const firstName = user?.name?.trim().split(/\s+/)[0];
  const data = home.data;
  const figures = data?.figures ?? null;
  const fresh = freshness(home.dataUpdatedAt || null);
  const failure = home.isError && !data ? toFriendlyError(home.error) : null;
  const adjusted = figures ? figures.cancellations.count > 0 || figures.returns.count > 0 : false;

  /*
    The store's calendar date, from the server's reply and in the store's timezone —
    informational, never a picker. Before 06:00 the business day is still yesterday's,
    so the header says which day new sales count for (docs/56).
  */
  const storeDate = data ? formatDateFns(calendarDate(data.businessDay.localDate), 'EEE d MMM', { locale: dateLocaleFor(getLanguage()) }) : null;
  const previousDayRunning = data ? data.businessDay.businessDate !== data.businessDay.localDate : false;
  const dayNote = data && previousDayRunning ? t('home.day.previous', { date: formatDate(data.businessDay.businessDate) }) : null;

  /* A percentage only when the server compared against a window that sold something; otherwise not a word. */
  const comparison = figures?.comparison?.salesValue;
  const change = comparison?.available ? changeText(comparison.changePercent) : null;

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={home.isRefetching} gap="lg">
      <HomeHeader
        context={branchName ?? t('home.branch.unknown')}
        title={firstName ? t('home.welcome.hello', { name: firstName }) : t('home.title')}
        subtitle={shortcutsReady ? t('home.welcome.ready') : t('home.welcome.preparing')}
        date={storeDate}
        note={dayNote}
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
      {/* A server that answered in an older shape says so: no figure is shown, none as zero (docs/54). */}
      {failure ? (
        <InlineNotice
          tone="warning"
          title={failure.titleKey === 'state.error.title' ? t('home.figures.unavailable') : failure.title}
          action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void home.refetch()} />}
        >
          {failure.titleKey === 'state.error.title' ? t('home.today.unavailable.body') : failure.body}
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
              {/* ── The sales value, how it compares, and its bars ── */}
              <View style={styles.hero}>
                <Text variant="body" tone="secondary">
                  {t('home.sales.value')}
                </Text>
                <MoneyValue value={figures.salesValue} size="display" accessibilityLabel={`${t('home.sales.value')} ${formatMoney(figures.salesValue)}`} />
                <View style={styles.heroMeta}>
                  <Text variant="caption" tone="tertiary">
                    {formatDayRange(data.range.from, data.range.to)}
                  </Text>
                  {change && comparison?.available ? (
                    <Text variant="captionStrong" style={{ color: changeColour(changeTone(comparison.changePercent), colors) }}>
                      {period === 'today'
                        ? t('home.compare.yesterday', { change: isolateLtr(change) })
                        : t('home.compare.previous', { change: isolateLtr(change), days: String(daySpan(comparison ? figures.comparison!.period.from : data.range.from, comparison ? figures.comparison!.period.to : data.range.to)) })}
                    </Text>
                  ) : null}
                </View>
                <SalesBars bars={data.series.bars} unit={data.series.unit} labelOf={barLabel(data.series.unit)} height={96} />
                <Text variant="caption" tone="tertiary">
                  {data.series.total === 0 ? t('home.chart.empty') : t('home.chart.basis')}
                </Text>
                {/* A sale cancelled in this period comes off here, on the cancellation's day; the value above keeps it on the day it was sold. */}
                {figures.cancellations.count > 0 ? (
                  <View style={styles.between}>
                    <Text variant="caption" tone="secondary" style={styles.flex}>
                      {t('home.sales.cancelled', { count: String(figures.cancellations.count) })}
                    </Text>
                    <MoneyValue value={-figures.cancellations.value} size="small" />
                  </View>
                ) : null}
                {/* A return approved in this period comes off on its approval day, by what goes back (docs/53). */}
                {figures.returns.count > 0 ? (
                  <View style={styles.between}>
                    <Text variant="caption" tone="secondary" style={styles.flex}>
                      {t('home.sales.returns', { count: String(figures.returns.count) })}
                    </Text>
                    <MoneyValue value={-figures.returns.value} size="small" />
                  </View>
                ) : null}
                {/* What the period comes to once they are off — the Daily closing's net sales; below zero on a day holding only an adjustment. */}
                {adjusted ? (
                  <View style={[styles.between, styles.netLine]} accessible accessibilityLabel={`${t('home.sales.net')} ${formatMoney(figures.netSalesValue)}`}>
                    <Text variant="bodyStrong" style={styles.flex}>
                      {t('home.sales.net')}
                    </Text>
                    <MoneyValue value={figures.netSalesValue} size="large" />
                  </View>
                ) : null}
              </View>

              {/* ── Collected, expenses, still owed: three quiet cards, each a word, its scope and the amount ── */}
              <View style={styles.figureRow}>
                <FigureCard label={t('home.sales.collected')} value={figures.collected} tone="positive" caption={t('home.sales.collected.scope')} />
                <FigureCard
                  label={t('home.sales.expenses')}
                  value={figures.expenses}
                  tone="default"
                  caption={figures.expensesReversed > 0 ? t('home.sales.expenses.reversed', { amount: isolateLtr(formatMoney(-figures.expensesReversed)) }) : undefined}
                />
                <FigureCard label={t('home.sales.owed')} value={figures.stillOwed} tone={figures.stillOwed > 0 ? 'negative' : 'muted'} caption={t('home.sales.owed.scope')} />
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {data ? (
        <>
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
                  <Text variant="bodyStrong">{t('home.top.empty.title')}</Text>
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
                  <ArrivalRow arrival={a} storeToday={data.businessDay.localDate} />
                </View>
              ))
            )}
          </Card>

          {/* ── The business day: one entry that opens the Daily closing, and closes nothing here ── */}
          {data.closing ? (
            <Card style={styles.entryCard}>
              <ListRow
                flat
                title={t('home.closing.title')}
                subtitle={
                  data.closing.businessDate === data.businessDay.localDate
                    ? t('home.closing.today', { standing: t(standingKey(data.closing.standing) as never) })
                    : t('home.closing.day', { date: formatDate(data.closing.businessDate), standing: t(standingKey(data.closing.standing) as never) })
                }
                onPress={() => router.push('/closing' as Href)}
                style={styles.entryRow}
              />
              {data.closing.previousDay.needsReview ? <Chip tone="warning" label={t('home.closing.previous')} size="sm" dot style={styles.previousChip} /> : null}
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

/**
 * One of the three cards under the sales value: a word, the amount, the unit,
 * its scope — text first, no icon, the colour only a soft tint that follows the
 * amount's meaning. Three abreast where they fit, two and one at 320 points,
 * one under another when the system text is large.
 */
function FigureCard({ label, value, tone, caption }: { label: string; value: number; tone: 'positive' | 'negative' | 'muted' | 'default'; caption?: string }) {
  const styles = useStyles();
  const colors = useColors();
  const tint = tone === 'positive' ? colors.intent.success : tone === 'negative' ? colors.intent.danger : null;
  const largeText = PixelRatio.getFontScale() >= 1.2;
  return (
    <View
      style={[styles.figureCard, largeText && styles.figureFull, tint ? { backgroundColor: tint.bg, borderColor: tint.border } : null]}
      accessible
      accessibilityLabel={`${label} ${formatMoney(value)}${caption ? `, ${caption}` : ''}`}
    >
      <Text variant="caption" tone="secondary" numberOfLines={2}>
        {label}
      </Text>
      <MoneyValue value={value} tone={tone} showCurrency={false} />
      <Text variant="caption" tone="tertiary">
        {isolateLtr(CURRENCY_CODE)}
      </Text>
      {caption ? (
        <Text variant="caption" tone="tertiary">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** The colour of the comparison — a word travels with it, so the colour never carries the meaning alone. */
function changeColour(tone: ReturnType<typeof changeTone>, colors: ReturnType<typeof useColors>): string {
  if (tone === 'positive') return colors.intent.success.fg;
  if (tone === 'negative') return colors.intent.danger.fg;
  return colors.text.secondary;
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
function ArrivalRow({ arrival, storeToday }: { arrival: HomeArrival; storeToday: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const colors = useColors();
  const when = receivedWhen(arrival, storeToday);
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

/**
 * "Today · 14:20", "Yesterday · 17:05", otherwise "21 Sep · 10:30" — the store's
 * date and wall-clock time, as the server read them in the store's timezone. The
 * phone's own clock and zone play no part (docs/54).
 */
function receivedWhen(arrival: HomeArrival, storeToday: string): string {
  const time = isolateLtr(arrival.receivedLocalTime);
  switch (arrivalDay(arrival.receivedLocalDate, storeToday)) {
    case 'today':
      return `${translate('history.today')} · ${time}`;
    case 'yesterday':
      return `${translate('history.yesterday')} · ${time}`;
    default:
      return `${formatDateFns(calendarDate(arrival.receivedLocalDate), 'd MMM', { locale: dateLocaleFor(getLanguage()) })} · ${time}`;
  }
}

/** The printed label of a bar: the hour, the weekday, or the span of days. */
function barLabel(unit: 'hour' | 'day' | 'week'): (bar: HomeBar) => string {
  if (unit === 'day') return (bar) => formatDateFns(calendarDate(bar.from), 'EEE', { locale: dateLocaleFor(getLanguage()) });
  if (unit === 'week') return (bar) => bar.label;
  return (bar) => bar.label;
}

/** Outstanding work — warning-toned, because it is somebody's unfinished business. */
function PendingRow({ icon, label, count, onPress }: { icon: LucideIcon; label: string; count: string; onPress: () => void }) {
  return <ListRow flat leading={icon} title={label} value={count} valueTone="warning" onPress={onPress} />;
}

const useStyles = makeStyles((colors) => ({
  shortcuts: { gap: space.xs },
  /*
    Side by side where both labels fit; one above the other below ~360 points, where
    "Réceptionner" needed 90 of the 71 points a half-width button leaves (docs/54).
  */
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1, flexBasis: 160 },
  fullSale: { alignSelf: 'center' },
  block: { gap: space.base },
  statRow: { flexDirection: 'row', gap: space.sm },
  hero: { gap: space.xs },
  heroMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: 2 },
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  figureCard: {
    flexGrow: 1,
    flexBasis: 104,
    minWidth: 0,
    gap: 2,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.card,
  },
  figureFull: { flexBasis: '100%' },
  card: { gap: space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  netLine: { marginTop: space.xs, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: colors.border.subtle },
  emptyInCard: { gap: 2 },
  arrival: { paddingHorizontal: 0 },
  entryCard: { gap: space.xs, paddingVertical: space.xs },
  entryRow: { paddingHorizontal: 0 },
  previousChip: { alignSelf: 'flex-start', marginBottom: space.xs },
  flex: { flex: 1, minWidth: 0 },
}));
