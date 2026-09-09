import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
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
import { usePermission } from '../../lib/permissions';
import { useTranslation } from '../../lib/i18n';
import { space } from '../../lib/design/tokens';
import { formatMoney, formatQuantity } from '../../lib/format';
import type {
  DashboardHome,
  HealthScore,
  RefundSummary,
  ReturnPage,
  TransferCounts,
} from '../../types/api';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The role landing screen.
 *
 * Rebuilt for the UX pilot (`docs/29`). What changed, and why:
 *
 * **Everyone gets one now.** This screen used to require `report.view` and
 * redirect anyone without it to Sell or Inventory, which meant two of the three
 * roles had no landing screen at all — only whichever tab happened to open
 * first. Instead of gating the whole screen, each *section* is gated: an
 * employee sees their work, an owner also sees the money.
 *
 * **Pending work comes first.** Approvals, reviews and confirmations used to be
 * invisible until someone went looking for them, feature by feature. A manager
 * opening the app now sees what is waiting on them before anything else,
 * because that is the reason they opened it.
 *
 * **No fake zeroes.** Every count here comes from a real endpoint. Supplier
 * payments awaiting confirmation have no aggregate endpoint yet, so there is a
 * way in but no number — an honest link beats an invented figure.
 */

export default function HomeScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const { branchId, branchName } = useBranch();

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
  const canManageSuppliers = usePermission('supplier.manage');
  const canReportSupplierPayment = usePermission('supplier.payment.report');
  const canViewSuppliers = canManageSuppliers || canReportSupplierPayment;

  const home = useQuery({
    queryKey: qk.home(branchId),
    queryFn: () => api.get<DashboardHome>('/home'),
    enabled: canViewReports,
  });
  const health = useQuery({
    queryKey: qk.health(branchId),
    queryFn: () => api.get<HealthScore>('/health-score'),
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
   * another — an approximate number that admits it is approximate, rather than
   * a precise-looking one that is wrong.
   */
  const pendingReturns = useQuery({
    queryKey: qk.returns(branchId, 'home-pending'),
    queryFn: () =>
      api.get<ReturnPage>('/returns?status=pending_investigation,under_review'),
    enabled: canViewReturns,
  });

  const refreshing =
    home.isFetching ||
    health.isFetching ||
    transfers.isFetching ||
    refunds.isFetching ||
    pendingReturns.isFetching;

  const onRefresh = () => {
    void home.refetch();
    void health.refetch();
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

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={refreshing} gap="xl">
      <View>
        <Text variant="label" tone="secondary">
          {branchName ?? t('home.branch.unknown')}
        </Text>
        <Text variant="title">{t('home.title')}</Text>
      </View>

      {/* ── What is waiting on you ─────────────────────────────────────────
          First, deliberately. This is why a manager opens the app. */}
      {hasPendingWork ? (
        <Section title={t('home.pending.title')}>
          {/*
            One surface, not three floating boxes. These are three answers to
            the same question — what is waiting on you — so they read as a list
            of outstanding work rather than as unrelated cards that happen to be
            stacked.
          */}
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

      {/* ── Start work ─────────────────────────────────────────────────────
          The employee's whole screen is really this. Big, thumb-reachable,
          and the first thing they can act on. */}
      <Section title={t('home.actions.title')}>
        <View style={styles.actions}>
          {canSell ? (
            <Button
              title={t('tab.sell')}
              icon={ScanLine}
              size="lg"
              fullWidth
              onPress={() => router.push('/(tabs)/sell')}
            />
          ) : null}
          <View style={styles.actionRow}>
            {canReceive ? (
              <View style={styles.actionHalf}>
                <Button
                  title={t('home.actions.receive')}
                  icon={PackagePlus}
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onPress={() => router.push('/receive' as Href)}
                />
              </View>
            ) : null}
            <View style={styles.actionHalf}>
              <Button
                title={t('tab.inventory')}
                icon={Boxes}
                variant="secondary"
                size="lg"
                fullWidth
                onPress={() => router.push('/(tabs)/inventory')}
              />
            </View>
          </View>
        </View>
      </Section>

      {/* ── Today ──────────────────────────────────────────────────────────
          Money only for those allowed to see it. Absent, not zeroed. */}
      {canViewReports ? (
        <Section title={t('home.today.title')}>
          {home.isPending ? (
            <View style={styles.statRow}>
              <SkeletonStat />
              <SkeletonStat />
            </View>
          ) : home.isError ? (
            <Card>
              <Text variant="bodyStrong">{t('home.today.unavailable.title')}</Text>
              <Text variant="body" tone="secondary">
                {t('home.today.unavailable.body')}
              </Text>
              <Button
                title={t('action.retry')}
                variant="secondary"
                size="sm"
                onPress={() => void home.refetch()}
                style={styles.retry}
              />
            </Card>
          ) : (
            <>
              <Card>
                <Text variant="label" tone="secondary">
                  {t('home.today.revenue')}
                </Text>
                <MoneyValue value={home.data?.today.revenue} size="display" />
                <View style={styles.inlineStats}>
                  <Text variant="caption" tone="tertiary">
                    {t('home.today.sales', { count: formatQuantity(home.data?.today.salesCount) })}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {t('home.today.items', { count: formatQuantity(home.data?.today.qtySold) })}
                  </Text>
                </View>
              </Card>

              <View style={styles.statRow}>
                {/*
                  `restricted` when the field is absent: the server strips
                  profit for a role without `cost.view`, and a tile that said
                  "0" there would misreport the shop's takings.
                */}
                <StatTile
                  label={t('home.today.profit')}
                  restricted={home.data?.today.grossProfit == null}
                  value={<MoneyValue value={home.data?.today.grossProfit} showCurrency={false} />}
                  valueLabel={formatMoney(home.data?.today.grossProfit)}
                />
                <StatTile
                  label={t('home.month.profit')}
                  restricted={home.data?.month.grossProfit == null}
                  value={<MoneyValue value={home.data?.month.grossProfit} showCurrency={false} />}
                  valueLabel={formatMoney(home.data?.month.grossProfit)}
                />
              </View>
            </>
          )}

          {health.data ? <HealthRow status={health.data.status} score={health.data.score} /> : null}
        </Section>
      ) : null}

      {/* ── Stock ──────────────────────────────────────────────────────────*/}
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

      {/* ── Everything else, one tap away ──────────────────────────────────
          Suppliers is here because until this pilot the whole payables
          workflow shipped with no way to reach it. */}
      <Section title={t('home.more.title')}>
        {/*
          Destinations, not cards. Five bordered boxes read as five decisions;
          one grouped list reads as a menu, which is what it is.
        */}
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
 * A piece of outstanding work. Warning-toned because it is somebody's unfinished
 * business, not a healthy resting state — the same reasoning the status registry
 * uses for `pending_approval`.
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
 * Store health, in words.
 *
 * It used to render `92 · GREEN` — a bare number beside the name of a colour,
 * untranslated, telling a shopkeeper nothing about what to do. The condition is
 * now stated in language, and the score follows as supporting detail rather
 * than leading.
 */
function HealthRow({ status, score }: { status: HealthScore['status']; score: number }) {
  const colors = useColors();
  const { t } = useTranslation();
  const tone =
    status === 'green' ? colors.intent.success : status === 'amber' ? colors.intent.warning : colors.intent.danger;
  const label =
    status === 'green'
      ? t('home.health.good')
      : status === 'amber'
        ? t('home.health.watch')
        : t('home.health.attention');

  return (
    <Card style={{ backgroundColor: tone.bg, borderColor: tone.border }}>
      <Text variant="label" tone="secondary">
        {t('home.health.title')}
      </Text>
      <Text variant="heading" style={{ color: tone.fg }}>
        {label}
      </Text>
      <Text variant="caption" tone="secondary">
        {t('home.health.score', { score: String(score) })}
      </Text>
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  actions: { gap: space.md },
  actionRow: { flexDirection: 'row', gap: space.md },
  actionHalf: { flex: 1 },
  statRow: { flexDirection: 'row', gap: space.md },
  inlineStats: { flexDirection: 'row', gap: space.base, marginTop: space.xs },
  retry: { alignSelf: 'flex-start', marginTop: space.sm },
}));
