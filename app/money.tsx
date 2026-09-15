import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import { ExportAction } from '../components/reports/ExportAction';
import { PeriodSelector } from '../components/money/PeriodSelector';
import {
  Card,
  Chip,
  Disclosure,
  EmptyState,
  ErrorState,
  InlineNotice,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  Text,
} from '../components/ui';
import { isolateLtr } from '../lib/design/direction';
import { space } from '../lib/design/tokens';
import { makeStyles } from '../lib/design/theme';
import { formatMoney } from '../lib/format';
import { useConnectivity } from '../lib/connectivity';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import { periodDays, periodRange, usePeriod } from '../lib/period';
import { usePeriodSummary, type PeriodSummary } from '../lib/analytics-summary';
import { resultLines } from '../lib/results';

/**
 * Results — what the shop earned in the period Money is showing.
 *
 * Reached from Money and reading the SAME period (`usePeriod`), so the two
 * screens never describe different days. One dominant figure, then the
 * calculation behind it, closed until asked for.
 *
 * **Every number is the server's.** `/analytics/summary` computes profit once
 * (`accounting-rules.ts`); this screen only lays the lines out. Without
 * `cost.view` the server strips the whole profit block, and the screen says the
 * figures are not shown to this role rather than drawing zeros.
 *
 * Balances owed and unresolved counting differences are point-in-time facts,
 * not period results. They stay here, below the result, in their own disclosures.
 */
export default function ResultsScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const canView = usePermission('report.view');
  const offline = !useConnectivity((s) => s.online);
  const key = usePeriod((s) => s.key);
  const range = periodRange(key);
  const query = usePeriodSummary(range.from, range.to, { enabled: canView });

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: t('results.title'),
        headerRight: canView ? () => <ExportAction days={periodDays(key)} /> : undefined,
      }}
    />
  );

  if (!canView) {
    return (
      <Screen>
        {header}
        <EmptyState icon={AlertTriangle} title={t('money.noPermission.title')} body={t('money.noPermission.body')} />
      </Screen>
    );
  }

  const s = query.data;
  const lines = s?.profit ? resultLines(s.profit) : null;
  const nothingHappened = Boolean(
    s && (s.profit ? s.profit.grossSales === 0 && s.profit.expenses === 0 : s.expenseDetail.total === 0),
  );

  return (
    <Screen scroll gap="lg" onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      {header}
      <PeriodSelector />
      {offline ? <InlineNotice tone="warning">{t('money.offline')}</InlineNotice> : null}

      {query.isPending ? (
        <SkeletonList count={3} />
      ) : query.isError || !s ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {lines ? (
            <Card style={styles.card}>
              <Text variant="label" tone="secondary">
                {t('results.profit')}
              </Text>
              <MoneyValue value={lines.finalProfit} size="display" tone="auto" signed />
              <Text variant="caption" tone="secondary">
                {nothingHappened ? t('results.empty') : t('results.basis')}
              </Text>

              <Disclosure title={t('results.breakdown')}>
                <Line label={t('results.sales')} value={lines.sales} />
                <Line label={t('results.returns')} value={-lines.approvedReturns} />
                <Line label={t('results.salesAfterReturns')} value={lines.salesAfterReturns} strong />
                <Line label={t('results.cost')} value={-lines.costOfSoldItems} />
                <Line label={t('results.beforeExpenses')} value={lines.profitBeforeExpenses} strong />
                <Line label={t('results.expenses')} value={-lines.expenses} />
                <Text variant="caption" tone="secondary">
                  {t('money.expenses.detail', {
                    fixed: isolateLtr(formatMoney(s.expenseDetail.fixed)),
                    salaries: isolateLtr(formatMoney(s.expenseDetail.salaries)),
                  })}
                </Text>
                <View style={styles.rule} />
                <Line label={t('results.final')} value={lines.finalProfit} strong />
              </Disclosure>

              <Disclosure title={t('results.returnsTiming')}>
                {(['approval', 'due', 'reported', 'confirmed'] as const).map((k) => (
                  <Text key={k} variant="caption" tone="secondary">
                    {t(`results.returnsTiming.${k}` as never)}
                  </Text>
                ))}
              </Disclosure>
            </Card>
          ) : (
            <InlineNotice tone="info" title={t('results.hidden.title')}>
              {t('results.hidden.body')}
            </InlineNotice>
          )}

          <Section>
            <Card style={styles.card}>
              <Disclosure title={t('money.owed')}>
                <Text variant="caption" tone="secondary">
                  {t('money.owed.hint')}
                </Text>
                <Line label={t('money.owed.toUs')} value={s.balances.loansReceivable} />
                <Line label={t('money.owed.byUs')} value={s.balances.loansPayable} />
                <Line label={t('money.owed.consignment')} value={s.balances.consignmentBalance} />
                <Unavailable summary={s} />
              </Disclosure>
            </Card>
          </Section>

          {s.discrepancies.open > 0 ? (
            <InlineNotice tone="warning" title={t('money.discrepancies')}>
              {t('money.discrepancies.open', {
                count: String(s.discrepancies.open),
                amount: isolateLtr(formatMoney(s.discrepancies.total)),
              })}
            </InlineNotice>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? undefined : 'secondary'} style={styles.lineLabel}>
        {label}
      </Text>
      <MoneyValue value={value} size={strong ? 'default' : 'small'} />
    </View>
  );
}

/** Figures the server could not compute — named, never drawn as zero. */
function Unavailable({ summary }: { summary: PeriodSummary }) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (summary.unavailable.length === 0) return null;
  return (
    <>
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

const useStyles = makeStyles((colors) => ({
  card: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  lineLabel: { flex: 1 },
  rule: { height: 1, backgroundColor: colors.border.subtle },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
}));
