import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { PackagePlus, ScanLine, ShoppingCart, Truck, Undo2, Wallet, type LucideIcon } from 'lucide-react-native';
import {
  Button,
  Card,
  Disclosure,
  InlineNotice,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
  SkeletonStat,
  StatTile,
  TabHeader,
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
import { formatDate, formatMoney, formatRelative } from '../../lib/format';
import { monthToDate } from '../../lib/home-metrics';
import { homeFigures } from '../../lib/home-figures';
import { usePeriodSummary } from '../../lib/analytics-summary';
import type { RefundSummary, ReturnPage, TransferCounts } from '../../types/api';
import { makeStyles } from '../../lib/design/theme';

/**
 * Home — the fastest operational screen.
 *
 * Greeting, then the two things a counter does all day (Sell, Receive) side by
 * side, then what is waiting on this person, then the month's four figures.
 * Nothing else: stock value lives on Stock, and every other destination is in
 * More, so Home never becomes a second menu.
 *
 * **Every figure is the server's.** `/analytics/summary` owns the arithmetic
 * and this screen only picks the window. Without `cost.view` the server strips
 * the whole profit block — which is also where "sales after returns" lives — so
 * those figures are hidden here, not shown as zero and not described in any
 * label or accessibility text (`lib/home-figures.ts`).
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

  /** A shortcut opens the camera only once branch and permissions are known. */
  const shortcutsReady = Boolean(branchId) && permissionsReady;

  const month = React.useMemo(() => monthToDate(), []);
  const summary = usePeriodSummary(month.from, month.to, { enabled: canViewReports });

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
  /** A cursor page with no total: counts one page and says "N+" when there is more. */
  const pendingReturns = useQuery({
    queryKey: qk.returns(branchId, 'home-pending'),
    queryFn: () => api.get<ReturnPage>('/returns?status=pending_investigation,under_review'),
    enabled: canViewReturns,
  });

  const onRefresh = () => {
    if (canViewReports) void summary.refetch();
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
  const figures = summary.data ? homeFigures(summary.data) : null;

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={summary.isRefetching} gap="lg">
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
              icon={ShoppingCart}
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

      {/* ── The month's figures — money only for those allowed to see it ── */}
      {canViewReports ? (
        <Section
          title={t('home.figures.title')}
          subtitle={t('home.figures.range', {
            from: formatDate(`${month.from}T00:00:00Z`),
            to: formatDate(`${month.to}T00:00:00Z`),
          })}
        >
          {offline ? <InlineNotice tone="warning">{t('home.month.offline')}</InlineNotice> : null}

          {summary.isPending ? (
            <>
              <SkeletonStat />
              <View style={styles.statRow}>
                <SkeletonStat />
                <SkeletonStat />
              </View>
            </>
          ) : summary.isError || !figures ? (
            <InlineNotice
              tone="warning"
              title={t('home.month.unavailable')}
              action={
                <Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void summary.refetch()} />
              }
            >
              {t('home.today.unavailable.body')}
            </InlineNotice>
          ) : (
            <>
              {figures.profit ? (
                <Card style={styles.profitCard}>
                  <Text variant="label" tone="secondary">
                    {t('home.figure.profit')}
                  </Text>
                  <MoneyValue value={figures.profit.value} size="display" tone="auto" signed />
                  <Disclosure title={t('home.profit.how')}>
                    <Line label={t('home.profit.salesAfterReturns')} value={figures.profit.salesAfterReturns} />
                    <Line label={t('home.profit.cost')} value={-figures.profit.cost} />
                    <Line label={t('home.profit.expenses')} value={-figures.profit.expenses} />
                  </Disclosure>
                </Card>
              ) : null}

              <View style={styles.statRow}>
                {figures.sales !== null ? (
                  <StatTile
                    label={t('home.figure.sales')}
                    value={<MoneyValue value={figures.sales} showCurrency={false} />}
                    valueLabel={formatMoney(figures.sales)}
                  />
                ) : null}
                <StatTile
                  label={t('home.figure.expenses')}
                  value={<MoneyValue value={figures.expenses} showCurrency={false} />}
                  valueLabel={formatMoney(figures.expenses)}
                />
                {figures.collected !== null ? (
                  <StatTile
                    label={t('home.figure.collected')}
                    value={<MoneyValue value={figures.collected} showCurrency={false} />}
                    valueLabel={formatMoney(figures.collected)}
                  />
                ) : null}
              </View>

              {figures.allZero ? (
                <Text variant="caption" tone="secondary">
                  {t('home.figures.empty')}
                </Text>
              ) : null}
              {summary.dataUpdatedAt ? (
                <Text variant="caption" tone="tertiary">
                  {t('home.month.stale', { time: formatRelative(summary.dataUpdatedAt) })}
                </Text>
              ) : null}
            </>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text variant="body" tone="secondary" style={styles.lineLabel}>
        {label}
      </Text>
      <MoneyValue value={value} size="small" />
    </View>
  );
}

/** Outstanding work — warning-toned, because it is somebody's unfinished business. */
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
  return <ListRow flat leading={icon} title={label} value={count} valueTone="warning" onPress={onPress} />;
}

const useStyles = makeStyles(() => ({
  shortcuts: { gap: space.xs },
  actionRow: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
  fullSale: { alignSelf: 'center' },
  profitCard: { gap: space.xs },
  statRow: { flexDirection: 'row', gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  lineLabel: { flex: 1 },
}));
