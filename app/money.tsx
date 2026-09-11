import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ExportAction } from '../components/reports/ExportAction';
import { Stack } from 'expo-router';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react-native';
import {
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  FilterChip,
  InlineNotice,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  Text,
} from '../components/ui';
import { isolateLtr } from '../lib/design/direction';
import { space } from '../lib/design/tokens';
import { formatMoney, formatNumber } from '../lib/format';
import { useConnectivity } from '../lib/connectivity';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import {
  trendOf,
  usePeriodSummary,
  windowOf,
  type Comparison,
  type PeriodSummary,
} from '../lib/analytics-summary';

/**
 * Where the money is (Milestone L).
 *
 * The order is the point. A shopkeeper asks the same questions in the same
 * sequence — did we make anything, did money actually move, who owes whom, what
 * is on the shelf, what did not add up — and the screen answers them in that
 * order rather than in whatever order the API returns them.
 *
 * **Profit and cash are never mixed.** A shop can be profitable and short of
 * cash in the same week: it sold well, paid three suppliers and refunded a
 * customer. Presenting one as the other is the most misleading thing a retail
 * report can do, so they are separate blocks with separate headings.
 *
 * Every figure comes from the server. Nothing here recomputes a total, and
 * anything the server could not compute is shown as unavailable rather than
 * drawn as a zero that looks measured.
 */
export default function MoneyScreen() {
  const { t } = useTranslation();
  const canView = usePermission('report.view');
  const offline = !useConnectivity((s) => s.online);
  const [days, setDays] = useState(7);

  const period = useMemo(() => windowOf(days), [days]);
  const query = usePeriodSummary(period.from, period.to);

  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('money.title') }} />
        {/* Said, not hidden. Somebody who cannot see the figures should know
            that is a role boundary rather than an empty shop. */}
        <EmptyState icon={AlertTriangle} title={t('money.noPermission.title')} body={t('money.noPermission.body')} />
      </Screen>
    );
  }

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('money.title') }} />
        <SkeletonList count={4} />
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('money.title') }} />
        {offline ? <InlineNotice tone="warning">{t('money.offline')}</InlineNotice> : null}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const s = query.data;
  // Every period figure is labelled with its period; balances say they are "as of now".
  const periodLabel = t(PERIODS.find((p) => p.days === days)?.labelKey ?? 'money.period.week');
  const nothingHappened = s.profit.grossSales === 0 && s.cash.inflow === 0 && s.cash.outflow === 0;

  return (
    <Screen scroll={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('money.title'),
          /* The export follows the period the user is already looking at. */
          headerRight: () => <ExportAction days={days} />,
        }}
      />

      <View style={styles.controls} accessibilityRole="radiogroup">
        {PERIODS.map((p) => (
          <FilterChip key={p.days} label={t(p.labelKey)} selected={days === p.days} onPress={() => setDays(p.days)} />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {offline ? <InlineNotice tone="warning">{t('money.offline')}</InlineNotice> : null}

        {nothingHappened ? (
          <EmptyState icon={Minus} title={t('money.empty.title')} body={t('money.empty.body')} />
        ) : null}

        {/* 1 & 2 — the period, then profit. */}
        <Section title={t('money.profit')} subtitle={periodLabel}>
          <Card style={styles.card}>
            <Headline
              label={t('money.netOperatingProfit')}
              value={s.profit.netOperatingProfit}
              comparison={s.comparison.netOperatingProfit}
            />
            <Divider style={styles.divider} />
            <Line label={t('money.netRevenue')} value={s.profit.netRevenue} comparison={s.comparison.netRevenue} />
            <Line label={t('money.returnsRevenue')} value={-s.profit.returnsRevenue} />
            <Line label={t('money.cogs')} value={-s.profit.netCogs} />
            <Line label={t('money.grossProfit')} value={s.profit.grossProfit} comparison={s.comparison.grossProfit} strong />
            <Line label={t('money.expenses')} value={-s.profit.expenses} />
            <Text variant="caption" tone="secondary">
              {t('money.expenses.detail', {
                fixed: isolateLtr(formatMoney(s.expenseDetail.fixed)),
                salaries: isolateLtr(formatMoney(s.expenseDetail.salaries)),
              })}
            </Text>
          </Card>
        </Section>

        {/* 3 — cash, which is a different question. */}
        <Section title={t('money.cash')} subtitle={periodLabel}>
          <Card style={styles.card}>
            <Text variant="caption" tone="secondary">
              {t('money.cash.hint')}
            </Text>
            <Line label={t('money.cash.in')} value={s.cash.salesReceived} />
            <Line label={t('money.cash.refunds')} value={-s.cash.refundsPaid} />
            <Line label={t('money.cash.suppliers')} value={-s.cash.supplierPaymentsConfirmed} />
            <Line label={t('money.cash.expenses')} value={-s.cash.expensesCash} />
            <Divider style={styles.divider} />
            <Line label={t('money.cash.net')} value={s.cash.net} strong />
          </Card>
        </Section>

        {/* 4 — owed and owing. Point in time, and said so. */}
        <Section title={t('money.owed')}>
          <Card style={styles.card}>
            <Text variant="caption" tone="secondary">
              {t('money.owed.hint')}
            </Text>
            <Line label={t('money.owed.toUs')} value={s.balances.loansReceivable} />
            <Line label={t('money.owed.byUs')} value={s.balances.loansPayable} />
            <Line label={t('money.owed.consignment')} value={s.balances.consignmentBalance} />
            <Unavailable summary={s} />
          </Card>
        </Section>

        {/* 6 — what did not add up. Never folded into profit. */}
        {s.discrepancies.open > 0 ? (
          <Section title={t('money.discrepancies')}>
            <Card style={styles.card}>
              <InlineNotice tone="warning">
                {t('money.discrepancies.open', {
                  count: String(s.discrepancies.open),
                  amount: isolateLtr(formatMoney(s.discrepancies.total)),
                })}
              </InlineNotice>
              <Text variant="caption" tone="secondary">
                {t('money.discrepancies.hint')}
              </Text>
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** The one figure the screen leads with. */
function Headline({
  label,
  value,
  comparison,
}: {
  label: string;
  value: number;
  comparison: Comparison;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.headline}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <MoneyValue value={value} size="display" />
      <Trend comparison={comparison} label={t('money.vsPrevious')} />
    </View>
  );
}

function Line({
  label,
  value,
  comparison,
  strong,
}: {
  label: string;
  value: number;
  comparison?: Comparison;
  strong?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? undefined : 'secondary'}>
          {label}
        </Text>
        {comparison ? <Trend comparison={comparison} label={t('money.vsPrevious')} /> : null}
      </View>
      <MoneyValue value={value} size={strong ? undefined : 'small'} />
    </View>
  );
}

/**
 * The comparison, in words as well as an arrow.
 *
 * When there is nothing to compare against the server says so, and the screen
 * says so too — rather than drawing a flat arrow that reads as "no change".
 */
function Trend({ comparison, label }: { comparison: Comparison; label: string }) {
  const { t } = useTranslation();
  const direction = trendOf(comparison);

  if (!comparison.available) {
    return (
      <Text variant="caption" tone="secondary">
        {t('money.noComparison')}
      </Text>
    );
  }

  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  return (
    <View style={styles.trend}>
      <Icon size={14} />
      {/* Colour is never the only carrier: the sign and the words are there. */}
      <Text variant="caption" tone="secondary">
        {t('money.change', {
          // Grouped and whole: "141 531 %", never "141530.72 %".
          percent: isolateLtr(formatNumber(Math.abs(comparison.changePercent))),
          direction: t(`money.direction.${direction ?? 'flat'}`),
          label,
        })}
      </Text>
    </View>
  );
}

/**
 * Figures the server could not compute.
 *
 * Named rather than drawn as zero. A shop cannot tell a measured zero from a
 * number nobody calculated, and the difference matters when the number is what
 * they owe a supplier.
 */
function Unavailable({ summary }: { summary: PeriodSummary }) {
  const { t } = useTranslation();
  if (summary.unavailable.length === 0) return null;
  return (
    <>
      <Divider style={styles.divider} />
      <View style={styles.chips}>
        {summary.unavailable.map((metric) => (
          <Chip key={metric} tone="neutral" label={t(`money.unavailable.${metric}` as never)} size="sm" />
        ))}
      </View>
      <Text variant="caption" tone="secondary">
        {t('money.unavailable.hint')}
      </Text>
    </>
  );
}

const PERIODS = [
  { days: 1, labelKey: 'money.period.today' },
  { days: 7, labelKey: 'money.period.week' },
  { days: 30, labelKey: 'money.period.month' },
] as const;

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingBottom: space.sm },
  list: { gap: space.base, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  headline: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  rowText: { flex: 1, gap: 2 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  divider: { marginVertical: space.xs },
});
