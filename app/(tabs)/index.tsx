import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  ClipboardCheck,
  Minus,
  PackagePlus,
  ReceiptText,
  ScanLine,
  Truck,
  Undo2,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Button,
  Card,
  InlineNotice,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
  SkeletonStat,
  StatTile,
  Text,
} from '../../components/ui';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { useBranch } from '../../lib/branch';
import { useAuth } from '../../hooks/useAuth';
import { useConnectivity } from '../../lib/connectivity';
import { usePermission, usePermissionStatus } from '../../lib/permissions';
import { useTranslation } from '../../lib/i18n';
import { space } from '../../lib/design/tokens';
import { isolateLtr } from '../../lib/design/direction';
import { formatMoney, formatQuantity, formatRelative } from '../../lib/format';
import { monthToDate } from '../../lib/home-metrics';
import { trendOf, usePeriodSummary, type Comparison } from '../../lib/analytics-summary';
import type {
  DashboardHome,
  RefundSummary,
  ReturnPage,
  TransferCounts,
} from '../../types/api';
import { makeStyles } from '../../lib/design/theme';

/**
 * The landing screen ("Improvement").
 *
 * Three things it now does, and the reason for each:
 *
 * **It greets the person, not the shop.** A compact branch line, then their
 * name. What was here before was a decorative phone and a slogan, which is
 * space spent on nothing a shopkeeper can act on. The welcome says only what is
 * actually known — who is signed in and where — and never invents a
 * performance claim to sound encouraging.
 *
 * **Two shortcuts, both camera-first.** Sell and Receive replace the old
 * Sell/Scanner pair. Both open the scanner the moment the screen is ready, so
 * the common path is one tap and a phone held up; typing stays permanently
 * available underneath, because whether a handset carries a scannable code is
 * up to its manufacturer.
 *
 * **Four monthly figures, all the server's.** Nothing here computes profit.
 * `/analytics/summary` owns the arithmetic — see `accounting-rules.ts` for why
 * it is written down once — and this screen only chooses the window and says
 * what each number means. A figure the server cannot compute is named as
 * unavailable rather than drawn as a zero that looks measured.
 */
export default function HomeScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const offline = !useConnectivity((s) => s.online);

  const permissionsReady = usePermissionStatus() === 'ready';
  const canViewReports = usePermission('report.view');
  const canSell = usePermission('sale.create');
  const canReceive = usePermission('purchase.manage');
  const canViewTransfers = usePermission('transfer.view');
  const canViewReturns = usePermission('return.view');
  const canViewSales = usePermission('sale.view');
  /**
   * There is no `supplier.view`. Anyone who can manage suppliers or report a
   * payment against one needs the way in — gating this on `supplier.manage`
   * alone would hide payables from the employee who reports the payment.
   */
  /*
   * Both hooks called unconditionally, then combined. Writing this as
   * `usePermission(a) || usePermission(b)` short-circuits, so the second hook
   * is skipped whenever the first is true — hooks must run in the same order
   * on every render.
   */
  const canManageSuppliers = usePermission('supplier.manage');
  const canReportSupplierPayment = usePermission('supplier.payment.report');
  const canViewSuppliers = canManageSuppliers || canReportSupplierPayment;

  /**
   * A shortcut may only open the camera once the branch and the permission set
   * have both resolved. Opening it first would put a viewfinder in front of
   * somebody who is about to be told they may not sell here.
   */
  const shortcutsReady = Boolean(branchId) && permissionsReady;

  const month = React.useMemo(() => monthToDate(), []);
  const summary = usePeriodSummary(month.from, month.to);

  const home = useQuery({
    queryKey: qk.home(branchId),
    queryFn: () => api.get<DashboardHome>('/home'),
    enabled: canViewReports,
  });
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
  /**
   * Returns waiting on a decision. The list endpoint is a cursor page with no
   * total, so this counts what one page holds and says "N+" when there is
   * another — an approximate number that admits it is approximate.
   */
  const pendingReturns = useQuery({
    queryKey: qk.returns(branchId, 'home-pending'),
    queryFn: () =>
      api.get<ReturnPage>('/returns?status=pending_investigation,under_review'),
    enabled: canViewReturns,
  });

  const refreshing =
    summary.isFetching ||
    home.isFetching ||
    transfers.isFetching ||
    refunds.isFetching ||
    pendingReturns.isFetching;

  const onRefresh = () => {
    void summary.refetch();
    void home.refetch();
    void transfers.refetch();
    void refunds.refetch();
    void pendingReturns.refetch();
  };

  const pendingTransferCount = transfers.data?.pendingApproval ?? 0;
  const awaitingRefundCount = refunds.data?.awaitingConfirmation.count ?? 0;
  const returnRows = pendingReturns.data?.rows.length ?? 0;
  const returnsMore = Boolean(pendingReturns.data?.nextCursor);
  const hasPendingWork =
    pendingTransferCount > 0 || awaitingRefundCount > 0 || returnRows > 0;

  /** The comparison window's length, for wording it honestly on screen. */
  const comparedDays = summary.data
    ? Math.round(
        (Date.parse(`${summary.data.comparison.period.to}T00:00:00.000Z`) -
          Date.parse(`${summary.data.comparison.period.from}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1
    : 0;

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={refreshing} gap="xl">
      {/* ── Who, and where ──────────────────────────────────────────────────
          Compact on purpose: it is context for everything below, not a banner. */}
      <View>
        <Text variant="label" tone="secondary">
          {branchName ?? t('home.branch.unknown')}
        </Text>
        <Text variant="title" accessibilityRole="header">
          {user?.name ? t('home.welcome.hello', { name: user.name }) : t('home.title')}
        </Text>
        <Text variant="body" tone="tertiary">
          {/*
            Said only when it is true. While the branch or the permission set is
            still resolving the shortcuts below cannot open a camera, and
            claiming readiness would be a lie the very next tap disproves.

            There is deliberately no "you sold N today, keep going" here: an
            encouraging number nobody asked for is a performance claim, and this
            screen has no business inventing one.
          */}
          {shortcutsReady ? t('home.welcome.ready') : t('home.welcome.preparing')}
        </Text>
      </View>

      {/* ── The two shortcuts ───────────────────────────────────────────────
          Camera-first, and the shortest path to the two things a counter does
          all day. Each opens its own quick screen, which leaves the full Sell
          and Receive workflows — and any draft in them — untouched. */}
      {canSell || canReceive ? (
        <View style={styles.shortcuts}>
          {canSell ? (
            <Button
              title={t('home.shortcut.sell')}
              icon={ScanLine}
              size="lg"
              fullWidth
              disabled={!shortcutsReady}
              onPress={() => router.push('/quick-sell' as Href)}
            />
          ) : null}
          {canSell ? (
            <Text variant="caption" tone="tertiary">
              {t('home.shortcut.sell.hint')}
            </Text>
          ) : null}
          {canReceive ? (
            <Button
              title={t('home.shortcut.receive')}
              icon={PackagePlus}
              variant="secondary"
              size="lg"
              fullWidth
              disabled={!shortcutsReady}
              onPress={() => router.push('/quick-receive' as Href)}
            />
          ) : null}
          {canReceive ? (
            <Text variant="caption" tone="tertiary">
              {t('home.shortcut.receive.hint')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── What is waiting on you ──────────────────────────────────────────*/}
      {hasPendingWork ? (
        <Section title={t('home.pending.title')}>
          <RowGroup>
            {pendingTransferCount > 0 ? (
              <PendingRow
                icon={Truck}
                label={t('home.pending.transfers')}
                count={String(pendingTransferCount)}
                onPress={() => router.push('/transfers' as Href)}
              />
            ) : null}
            {returnRows > 0 ? (
              <PendingRow
                icon={Undo2}
                label={t('home.pending.returns')}
                count={returnsMore ? `${returnRows}+` : String(returnRows)}
                onPress={() => router.push('/returns' as Href)}
              />
            ) : null}
            {awaitingRefundCount > 0 ? (
              <PendingRow
                icon={Wallet}
                label={t('home.pending.refunds')}
                count={String(awaitingRefundCount)}
                onPress={() => router.push('/returns' as Href)}
              />
            ) : null}
          </RowGroup>
        </Section>
      ) : null}

      {/* ── The month ───────────────────────────────────────────────────────
          Money only for those allowed to see it. Absent, never zeroed. */}
      {canViewReports ? (
        <Section title={t('home.month.title')}>
          {offline ? (
            <InlineNotice tone="warning">{t('home.month.offline')}</InlineNotice>
          ) : null}

          {summary.isPending ? (
            <View style={styles.statRow}>
              <SkeletonStat />
              <SkeletonStat />
            </View>
          ) : summary.isError || !summary.data ? (
            <Card>
              <Text variant="bodyStrong">{t('home.month.unavailable')}</Text>
              <Text variant="body" tone="secondary">
                {t('home.today.unavailable.body')}
              </Text>
              <Button
                title={t('action.retry')}
                variant="secondary"
                size="sm"
                onPress={() => void summary.refetch()}
                style={styles.retry}
              />
            </Card>
          ) : (
            <>
              {/*
                The one focal figure: the operating result the server already
                computes — revenue net of returns, less recognised COGS, less
                CONFIRMED expenses. Never sales minus what was spent on stock:
                buying inventory is not an expense, and a good month of
                restocking would otherwise read as a catastrophe.
              */}
              <Card>
                <Text variant="label" tone="secondary">
                  {t('home.month.result')}
                </Text>
                <MoneyValue value={summary.data.profit.netOperatingProfit} size="display" />
                <Text variant="caption" tone="tertiary">
                  {t('home.month.result.basis')}
                </Text>
                <Trend
                  comparison={summary.data.comparison.netOperatingProfit}
                  days={comparedDays}
                />
                {summary.dataUpdatedAt ? (
                  <Text variant="caption" tone="tertiary">
                    {t('home.month.stale', {
                      time: formatRelative(summary.dataUpdatedAt),
                    })}
                  </Text>
                ) : null}
              </Card>

              <View style={styles.statRow}>
                <StatTile
                  label={t('home.month.sales')}
                  value={<MoneyValue value={summary.data.profit.netRevenue} showCurrency={false} />}
                  valueLabel={formatMoney(summary.data.profit.netRevenue)}
                />
                <StatTile
                  label={t('home.month.expenses')}
                  value={<MoneyValue value={summary.data.expenseDetail.total} showCurrency={false} />}
                  valueLabel={formatMoney(summary.data.expenseDetail.total)}
                />
              </View>

              {/*
                Money collected — a different question from both of the above.
                A credit sale is revenue nobody has paid yet; settling an old
                balance is money arriving against no new sale. An older server
                does not send it at all, and that is said rather than drawn as
                a zero somebody would read as "we took nothing".
              */}
              {summary.data.collected ? (
                <Card>
                  <Text variant="label" tone="secondary">
                    {t('home.month.collected')}
                  </Text>
                  <MoneyValue value={summary.data.collected.total} />
                  <Text variant="caption" tone="tertiary">
                    {t('home.month.collected.hint')}
                  </Text>
                </Card>
              ) : (
                <InlineNotice tone="info">
                  {t('home.month.collected.unavailable')}
                </InlineNotice>
              )}
            </>
          )}
        </Section>
      ) : null}

      {/* ── Stock ───────────────────────────────────────────────────────────*/}
      {canViewReports && home.data ? (
        <Section title={t('home.stock.title')}>
          <RowGroup>
            <ListRow
              flat
              leading={Boxes}
              title={t('home.stock.value')}
              accessory={<MoneyValue value={home.data.inventory.inventoryValue} size="small" />}
            />
            <ListRow
              flat
              leading={PackagePlus}
              title={t('home.stock.low')}
              subtitle={t('home.stock.low.hint')}
              value={formatQuantity(home.data.lowStockCount)}
              valueTone="warning"
              onPress={() => router.push('/(tabs)/inventory')}
            />
          </RowGroup>
        </Section>
      ) : null}

      {/* ── Everything else, one tap away ───────────────────────────────────*/}
      <Section title={t('home.more.title')}>
        <RowGroup>
          {canViewSales ? (
            <ListRow
              flat
              leading={ReceiptText}
              title={t('nav.sales')}
              onPress={() => router.push('/sales' as Href)}
            />
          ) : null}
          {canViewReturns ? (
            <ListRow
              flat
              leading={Undo2}
              title={t('nav.returns')}
              onPress={() => router.push('/returns' as Href)}
            />
          ) : null}
          {canViewSuppliers ? (
            <ListRow
              flat
              leading={Wallet}
              title={t('nav.suppliers')}
              subtitle={t('nav.suppliers.hint')}
              onPress={() => router.push('/suppliers' as Href)}
            />
          ) : null}
          {canViewTransfers ? (
            <ListRow
              flat
              leading={ArrowLeftRight}
              title={t('nav.transfers')}
              onPress={() => router.push('/transfers' as Href)}
            />
          ) : null}
          {canViewReports ? (
            <ListRow
              flat
              leading={ClipboardCheck}
              title={t('nav.closing')}
              onPress={() => router.push('/closing')}
            />
          ) : null}
        </RowGroup>
      </Section>
    </Screen>
  );
}

/**
 * A piece of outstanding work. Warning-toned because it is somebody's
 * unfinished business, not a healthy resting state.
 */
function PendingRow({
  icon,
  label,
  count,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  count: string;
  onPress: () => void;
}) {
  return (
    <ListRow flat leading={icon} title={label} value={count} valueTone="warning" onPress={onPress} />
  );
}

/**
 * The comparison, in words as well as an arrow — and silent when there is
 * nothing to compare against.
 *
 * The server compares against the preceding window of EQUAL LENGTH, so twelve
 * days into a month are measured against the twelve days before them rather
 * than against a whole previous month. The wording says how many days, because
 * "vs last month" would describe a comparison nobody made.
 *
 * A zero base is reported as unavailable rather than as a percentage: "up 100%"
 * from nothing is a division nobody checked, and a shop reads it as a result.
 */
function Trend({ comparison, days }: { comparison: Comparison; days: number }) {
  const { t } = useTranslation();
  const direction = trendOf(comparison);

  if (!comparison.available || direction === null) {
    return (
      <Text variant="caption" tone="secondary">
        {t('home.month.noComparison')}
      </Text>
    );
  }

  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  return (
    <View style={styles0.trend}>
      {/* Colour is never the only carrier: the arrow and the words are there. */}
      <Icon size={14} />
      <Text variant="caption" tone="secondary">
        {t('home.month.compare', {
          direction: t(`money.direction.${direction}` as never),
          percent: isolateLtr(String(Math.abs(Math.round(comparison.changePercent)))),
          days: String(days),
        })}
      </Text>
    </View>
  );
}

const styles0 = { trend: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.xs } };

const useStyles = makeStyles(() => ({
  shortcuts: { gap: space.sm },
  statRow: { flexDirection: 'row', gap: space.md },
  retry: { alignSelf: 'flex-start', marginTop: space.sm },
}));
