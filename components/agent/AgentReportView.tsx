import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Card, Chip, Divider, ErrorState, IconButton, MoneyValue, PermissionNotice, Screen, Section, SegmentedControl, SkeletonList, TabHeader, Text } from '../ui';
import { FloatsCard } from './FloatsCard';
import { useAgentReport, type AgentReport, type FloatView, type ReportDiscrepancy, type ReportFigures, type ReportRebalancings } from '../../lib/agent';
import { differenceKind } from '../../lib/agent-money';
import type { PositionRow } from '../../lib/agent-positions';
import { REPORT_PERIODS, isEmptyPeriod, reportRange, stepDate, type ReportPeriod } from '../../lib/agent-reports';
import { useBranch } from '../../lib/branch';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate, formatDayRange, formatMonth, formatMoney } from '../../lib/format';
import { useBusinessDay } from '../../lib/home';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';

/**
 * The counter's reports (D157): a day, a week (Monday to Sunday), a month or a
 * year by month, on the branch's business days — every figure the server's.
 *
 * Count, volume and commission count the period's completed exchanges; the
 * cash received and paid and the credit sent and received are their two sides.
 * Reversals are listed on their own line and never inside those figures;
 * rebalancings on theirs, never as exchanges. Then the same by provider and by
 * employee, the year month by month, the floats as they stood at the period's
 * end, and every float count whose difference opened a question at a closing.
 * No PDF and no customer receipt in this version (A3).
 *
 * Reads are never refused for the branch's activity: a branch that left the
 * counter keeps its reports. The tab of an agent-only branch and Money's row
 * on a combined one are this one screen.
 */
export function AgentReportView({ tab = false }: { tab?: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { branchName } = useBranch();
  const canView = usePermission('agent.report.view');
  const [period, setPeriod] = useState<ReportPeriod>('day');
  /** A business date inside the period shown; null for the current one — which shares Home's cache for today. */
  const [date, setDate] = useState<string | null>(null);
  const businessDay = useBusinessDay({ enabled: canView });
  const today = businessDay.data?.businessDate ?? null;
  const query = useAgentReport(period, date, { enabled: canView });
  const title = tab ? t('tab.reports') : t('nav.agent.reports');
  const header = tab ? <TabHeader context={branchName} title={title} /> : <Stack.Screen options={{ title }} />;

  if (!canView) {
    return (
      <Screen>
        {header}
        <PermissionNotice message={t('agent.reports.permission')} />
      </Screen>
    );
  }

  const report = query.data;
  const range = report ? { from: report.from, to: report.to } : reportRange(period, date ?? today ?? new Date().toISOString().slice(0, 10));
  /** A date in the period chosen, or the current period when that one holds the business day (or is later). */
  const go = (candidate: string, nextPeriod: ReportPeriod) => setDate(today === null || reportRange(nextPeriod, candidate).to >= today ? null : candidate);

  return (
    <Screen scroll gap="lg" onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      {header}
      <SegmentedControl<ReportPeriod>
        variant="filled"
        value={period}
        onChange={(next) => {
          setPeriod(next);
          // The same date in the new period: a past day becomes its week, its month, its year.
          if (date !== null) go(date, next);
        }}
        options={REPORT_PERIODS.map((p) => ({ value: p, label: t(`agent.reports.period.${p}` as TranslationKey) }))}
      />
      <View style={styles.stepper}>
        <IconButton icon={ChevronLeft} directional accessibilityLabel={t('agent.reports.earlier')} onPress={() => setDate(stepDate(range, -1))} />
        <View style={styles.periodLabel}>
          {/* Not LTR-isolated: a localised date carries its own month word. */}
          <Text variant="bodyStrong" align="center">
            {periodLabel(period, range)}
          </Text>
          {date === null ? (
            <Text variant="caption" tone="tertiary" align="center">
              {t('agent.reports.soFar')}
            </Text>
          ) : null}
        </View>
        <IconButton icon={ChevronRight} directional accessibilityLabel={t('agent.reports.later')} disabled={date === null} onPress={() => go(stepDate(range, 1), period)} />
      </View>

      {query.isPending ? (
        <SkeletonList count={4} />
      ) : query.isError || !report ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ReportBody report={report} />
      )}
    </Screen>
  );
}

function periodLabel(period: ReportPeriod, range: { from: string; to: string }): string {
  switch (period) {
    case 'day':
      return formatDate(range.from);
    case 'week':
      return formatDayRange(range.from, range.to);
    case 'month':
      return formatMonth(range.from.slice(0, 7));
    default:
      return range.from.slice(0, 4);
  }
}

function ReportBody({ report }: { report: AgentReport }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const totals = report.totals;
  const empty = isEmptyPeriod(totals);
  const floats: PositionRow[] = report.positions.floats.map(floatRow);
  const decimals = (values: number[]) => (values.some((v) => Math.round(v * 100) % 100 !== 0) ? 2 : 0);

  return (
    <>
      <Card style={styles.card} testID="agent-report-totals">
        <View style={styles.figures}>
          <View style={styles.figure}>
            <Text variant="caption" tone="secondary">
              {t('agent.reports.count')}
            </Text>
            <Text variant="title">{String(totals.count)}</Text>
          </View>
          <View style={styles.figure}>
            <Text variant="caption" tone="secondary">
              {t('agent.reports.commission')}
            </Text>
            <MoneyValue value={totals.commission} size="large" decimals={decimals([totals.commission])} />
          </View>
        </View>
        {empty ? (
          <Text variant="caption" tone="tertiary">
            {t('agent.reports.empty')}
          </Text>
        ) : null}
        <Divider />
        <Line label={t('agent.reports.volume')} value={totals.volume} strong />
        <Line label={t('agent.reports.cashReceived')} value={totals.cashReceived} />
        <Line label={t('agent.reports.cashPaid')} value={totals.cashPaid} />
        <Line label={t('agent.reports.creditSent')} value={totals.creditSent} />
        <Line label={t('agent.reports.creditReceived')} value={totals.creditReceived} />
        <Text variant="caption" tone="tertiary">
          {t('agent.reports.countRule')}
        </Text>
      </Card>

      {/* Reversals and rebalancings: each on its own line, never inside the figures above. */}
      {totals.reversals.count > 0 ? <ReversalsLine reversals={totals.reversals} /> : null}
      {totals.rebalancings.count > 0 ? <RebalancingsCard rebalancings={totals.rebalancings} /> : null}

      {report.byMonth && report.byMonth.length > 0 ? (
        <Section title={t('agent.reports.byMonth')} gap="xs">
          {report.byMonth.map((m) => (
            <FiguresRow key={m.month} title={formatMonth(m.month)} figures={m} testID={`agent-report-month-${m.month}`} />
          ))}
        </Section>
      ) : null}

      {report.byProvider.length > 0 ? (
        <Section title={t('agent.reports.byProvider')} gap="xs">
          {report.byProvider.map((p) => (
            <FiguresRow key={p.providerId} title={p.label} figures={p} sides testID={`agent-report-provider-${p.providerId}`} />
          ))}
        </Section>
      ) : null}

      {report.byEmployee.length > 0 ? (
        <Section title={t('agent.reports.byEmployee')} gap="xs">
          {report.byEmployee.map((e) => (
            <Card key={e.userId} style={styles.card} testID={`agent-report-employee-${e.userId}`}>
              <View style={[AMOUNT_ROW, styles.line]}>
                <View style={AMOUNT_LABEL}>
                  <Text variant="bodyStrong">{e.name}</Text>
                  <Text variant="caption" tone="secondary">
                    {t('agent.reports.countVolume', { count: e.count, volume: isolateLtr(formatMoney(e.volume)) })}
                  </Text>
                </View>
                <MoneyValue value={e.commission} size="small" />
              </View>
              {e.reversals.count > 0 ? (
                <Text variant="caption" tone="tertiary">
                  {t('agent.reports.reversedBy', { count: e.reversals.count })}
                </Text>
              ) : null}
            </Card>
          ))}
        </Section>
      ) : null}

      {floats.length > 0 ? (
        <Section title={t('agent.reports.floats')} gap="xs">
          <FloatsCard rows={floats} provisionalCount={0} />
        </Section>
      ) : null}

      <Section title={t('agent.reports.discrepancies')} gap="xs">
        {report.positions.discrepancies.length === 0 ? (
          <Text variant="caption" tone="tertiary">
            {t('agent.reports.discrepancies.none')}
          </Text>
        ) : (
          report.positions.discrepancies.map((d, i) => <DiscrepancyCard key={`${d.businessDate}-${d.providerId}-${i}`} discrepancy={d} />)
        )}
      </Section>
    </>
  );
}

/** A float at the period's end, as the positions card draws it: the server's figure, never provisional here. */
function floatRow(f: FloatView): PositionRow {
  return { key: `provider:${f.providerId}`, kind: 'provider', label: f.providerLabel, known: f.known, position: f.known ? f.position : null, provisional: false, movement: f.movement };
}

/** One provider or one month: count and volume, commission; for a provider, both sides of its exchanges too. */
function FiguresRow({ title, figures, sides = false, testID }: { title: string; figures: ReportFigures; sides?: boolean; testID?: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Card style={styles.card} testID={testID}>
      <View style={[AMOUNT_ROW, styles.line]}>
        <View style={AMOUNT_LABEL}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" tone="secondary">
            {t('agent.reports.countVolume', { count: figures.count, volume: isolateLtr(formatMoney(figures.volume)) })}
          </Text>
        </View>
        <MoneyValue value={figures.commission} size="small" />
      </View>
      {sides && figures.count > 0 ? (
        <Text variant="caption" tone="tertiary">
          {t('agent.reports.sides', { received: isolateLtr(formatMoney(figures.cashReceived)), paid: isolateLtr(formatMoney(figures.cashPaid)) })}
        </Text>
      ) : null}
      {figures.reversals.count > 0 ? (
        <Text variant="caption" tone="tertiary">
          {t('agent.reports.reversedLine', { count: figures.reversals.count, volume: isolateLtr(formatMoney(figures.reversals.volume)) })}
        </Text>
      ) : null}
    </Card>
  );
}

function ReversalsLine({ reversals }: { reversals: { count: number; volume: number; commission: number } }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Card style={styles.card} testID="agent-report-reversals">
      <Text variant="bodyStrong">{t('agent.reports.reversals', { count: reversals.count })}</Text>
      <Line label={t('agent.reports.reversals.volume')} value={reversals.volume} />
      <Line label={t('agent.reports.reversals.commission')} value={-reversals.commission} signed />
      <Text variant="caption" tone="tertiary">
        {t('agent.reports.reversals.note')}
      </Text>
    </Card>
  );
}

function RebalancingsCard({ rebalancings }: { rebalancings: ReportRebalancings }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Card style={styles.card} testID="agent-report-rebalancings">
      <Text variant="bodyStrong">{t('agent.reports.rebalancings', { count: rebalancings.count })}</Text>
      <Line label={t('agent.reports.rebalancings.cashIn')} value={rebalancings.cashIn} />
      <Line label={t('agent.reports.rebalancings.cashOut')} value={rebalancings.cashOut} />
      <Line label={t('agent.reports.rebalancings.floatIn')} value={rebalancings.floatIn} />
      <Line label={t('agent.reports.rebalancings.floatOut')} value={rebalancings.floatOut} />
      <Text variant="caption" tone="tertiary">
        {t('agent.reports.rebalancings.note')}
      </Text>
    </Card>
  );
}

/** Expected against counted at a closing: the difference in words and figures; Unknown expected stays Unknown. */
function DiscrepancyCard({ discrepancy: d }: { discrepancy: ReportDiscrepancy }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const kind = differenceKind(d.difference);
  return (
    <Card style={styles.card} testID={`agent-report-discrepancy-${d.providerId}`}>
      <View style={styles.between}>
        <Text variant="bodyStrong" style={styles.grow}>
          {t('agent.positions.float', { provider: d.label })}
        </Text>
        {kind && kind !== 'none' ? <Chip label={t(`agent.difference.${kind}` as TranslationKey)} tone={kind === 'short' ? 'warning' : 'info'} size="sm" dot /> : null}
      </View>
      <Text variant="caption" tone="secondary">
        {formatDate(d.businessDate)}
      </Text>
      <View style={[AMOUNT_ROW, styles.line]}>
        <View style={AMOUNT_LABEL}>
          <Text variant="body" tone="secondary">
            {t('agent.count.expected')}
          </Text>
        </View>
        {d.expected !== null ? (
          <MoneyValue value={d.expected} size="small" signed={d.expected < 0} />
        ) : (
          <Text variant="bodyStrong" tone="secondary">
            {t('moneyTab.held.unknown')}
          </Text>
        )}
      </View>
      {d.counted !== null ? <Line label={t('agent.count.counted')} value={d.counted} /> : null}
      <Line label={t('agent.count.difference')} value={d.difference} signed />
      {d.explanation ? (
        <Text variant="caption" tone="secondary">
          {t('agent.count.explanationShown', { explanation: d.explanation })}
        </Text>
      ) : null}
      {d.status ? (
        <Text variant="caption" tone="tertiary">
          {t(d.status === 'resolved' ? 'agent.reports.discrepancy.resolved' : 'agent.reports.discrepancy.open')}
        </Text>
      ) : null}
    </Card>
  );
}

function Line({ label, value, strong, signed }: { label: string; value: number; strong?: boolean; signed?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[AMOUNT_ROW, styles.line]}>
      <View style={AMOUNT_LABEL}>
        <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'primary' : 'secondary'}>
          {label}
        </Text>
      </View>
      <MoneyValue value={value} size={strong ? 'default' : 'small'} signed={signed} tone={signed ? 'auto' : 'default'} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  periodLabel: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  figure: { flexGrow: 1, flexBasis: '40%', minWidth: 120, gap: 2 },
  line: { minHeight: 28 },
  between: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
}));
