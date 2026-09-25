import React, { useContext, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeaderShownContext } from '../../lib/navigation/router-internals';
import { Stack, useRouter, type Href } from 'expo-router';
import { CalendarDays, PencilLine, Scale } from 'lucide-react-native';
import { Button, Card, Chip, Disclosure, Divider, ErrorState, FilterChip, InlineNotice, ListRow, MoneyValue, RowGroup, Section, SkeletonList, Text } from '../../components/ui';
import { SelectSheet } from '../../components/overlay/SelectSheet';
import { ReopenSheet } from '../../components/closing/ReopenSheet';
import { CloseReviewSheet } from '../../components/closing/CloseReviewSheet';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { isolateLtr } from '../../lib/design/direction';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatDate, formatMoney, formatTime } from '../../lib/format';
import { dayChoices, dayWordKey, historyKey, openingKey, standingKey, standingTone, type ReopenMode } from '../../lib/home-day';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { useOpenClosing, useOpenDay, useReopenDay, type ClosingHistoryEntry, type OpenClosing } from '../../lib/closing';
import { useDailyReport, type DailyReport, type ReportChannel } from '../../lib/closing-report';
import { channelLabel, reportFreshness, verificationKey, verificationTone, warningKey, type Freshness } from '../../lib/closing-report-view';

/**
 * The Daily closing (docs/51, reference 05): one business date as a short,
 * bill-like statement built on the server from what was already recorded —
 * what the boutique sold, where the money went, the expenses, the result and
 * the balances the drawer and each account should show. Nothing is typed
 * again; the physical check is optional and one tap away.
 *
 * The body is a plain `ScrollView` with nothing above the rows: a drag that
 * starts on a card scrolls the page (the shared `Screen` wraps its body in a
 * keyboard-dismissing `Pressable`, and this screen has no field to dismiss).
 */
export default function DailyClosingScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const headerShown = useContext(HeaderShownContext);
  /** Undefined = the branch's current business day, whatever the phone's clock says. */
  const [date, setDate] = useState<string | undefined>(undefined);
  const report = useDailyReport(date);
  const day = useOpenClosing(date);
  /** Remembered from the last read so the selector stays while another day loads (derived, no effect). */
  const [today, setToday] = useState<string | null>(null);
  const serverToday = report.data?.today ?? day.data?.today ?? null;
  if (serverToday && serverToday !== today) setToday(serverToday);

  const refresh = () => {
    void report.refetch();
    void day.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={headerShown ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('dailyReport.title') }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={report.isRefetching || day.isRefetching} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
      >
        {today ? <DateBar today={today} date={date ?? today} onPick={setDate} /> : null}
        {report.isPending || day.isPending ? (
          <SkeletonList count={4} />
        ) : report.isError || !report.data ? (
          <ErrorState error={report.error} onRetry={refresh} />
        ) : (
          <Report report={report.data} fetchedAt={report.dataUpdatedAt} day={day.data ?? null} date={date} onRefresh={refresh} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Today, yesterday, or a day picked from the last sixty — the business dates the server keys on. */
function DateBar({ today, date, onPick }: { today: string; date: string; onPick: (date: string | undefined) => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const yesterday = dayChoices(today, 1)[1];
  const custom = date !== today && date !== yesterday;
  const items = useMemo(() => dayChoices(today, 60), [today]);
  const word = (d: string) => {
    const key = dayWordKey(d, today);
    return key ? t(key as never) : undefined;
  };
  return (
    <View style={styles.dates}>
      <FilterChip label={t('closingHistory.today')} selected={date === today} onPress={() => onPick(undefined)} />
      <FilterChip label={t('closingHistory.yesterday')} selected={date === yesterday} onPress={() => onPick(yesterday)} />
      <FilterChip label={custom ? formatDate(`${date}T00:00:00Z`) : t('closingHistory.pickDate')} selected={custom} onPress={() => setOpen(true)} />
      <SelectSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('closingHistory.pickDate.title')}
        subtitle={t('closingHistory.pickDate.subtitle')}
        items={items}
        keyExtractor={(d: string) => d}
        labelExtractor={(d: string) => formatDate(`${d}T00:00:00Z`)}
        descriptionExtractor={word}
        leadingIcon={CalendarDays}
        selectedKeys={[date]}
        searchable={false}
        onSelect={(d: string) => {
          onPick(d === today ? undefined : d);
          setOpen(false);
        }}
      />
    </View>
  );
}

function Report({
  report,
  fetchedAt,
  day,
  date,
  onRefresh,
}: {
  report: DailyReport;
  fetchedAt: number;
  day: OpenClosing | null;
  date: string | undefined;
  onRefresh: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchName } = useBranch();
  const online = useConnectivity((s) => s.online);
  const canCount = usePermission('closing.count');
  const canClose = usePermission('closing.perform');
  const canCorrect = usePermission('financial.correction.request');
  const reopen = useReopenDay(date);
  const openDay = useOpenDay(date);
  const [reopenSheet, setReopenSheet] = useState(false);
  const [review, setReview] = useState(false);

  const freshness: Freshness = reportFreshness(fetchedAt, online);
  const dateWord = formatDate(`${report.date}T00:00:00Z`);
  const words = { cash: t('closing.channel.cash'), unattributed: t('closing.channel.unattributed') };
  const money = (v: number) => isolateLtr(formatMoney(v));
  const warningParams = (p?: Record<string, string | number>) =>
    Object.fromEntries(
      Object.entries(p ?? {}).map(([k, v]) => [
        k,
        k === 'date' || k === 'anchorDate' ? formatDate(`${String(v)}T00:00:00Z`) : typeof v === 'number' && k !== 'count' && k !== 'days' ? money(v) : String(v),
      ]),
    );

  const confirmReopen = async (mode: ReopenMode) => {
    try {
      await reopen.mutateAsync(mode);
      setReopenSheet(false);
      toast.success(mode === 'start_new' ? t('reopen.started', { date: formatDate(`${day?.nextDate}T00:00:00Z`) }) : t('reopen.done', { date: dateWord }));
      onRefresh();
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('reopen.failed'));
    }
  };
  const onReopen = async () => {
    if (day?.reopenChoices.includes('start_new')) {
      setReopenSheet(true);
      return;
    }
    const ok = await dialog.confirm({
      title: t('reopen.simple.title', { date: dateWord }),
      message: t('reopen.simple.body'),
      confirmLabel: t('reopen.confirm'),
      cancelLabel: t('action.cancel'),
    });
    if (ok) await confirmReopen('continue');
  };
  const onOpen = async () => {
    try {
      const fresh = await openDay.mutateAsync();
      toast.success(t('closingHistory.open.done', { time: isolateLtr(fresh.opening?.localTime ?? fresh.localNow) }));
      onRefresh();
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('closingHistory.open.failed'));
    }
  };

  const standing = report.standing;
  const closed = standing === 'closed';
  const showOpen = report.isToday && canCount && !!day?.canOpen && !closed;
  const openingLine = day
    ? t(
        openingKey(day.opening, report.isToday) as never,
        day.opening ? { date: formatDate(`${day.opening.localDate}T00:00:00Z`), time: isolateLtr(day.opening.localTime) } : undefined,
      )
    : null;
  const headline = report.sales ? report.sales.value : report.money.totals.in;
  const cash = report.expected.cash;

  return (
    <View style={styles.report}>
      {/* ── Where and when, the standing, and how fresh the figures are ── */}
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="label" tone="secondary">
            {t('closingHistory.context', { date: dateWord, branch: branchName ?? '' })}
          </Text>
          {openingLine ? (
            <Text variant="caption" tone={day?.opening ? 'secondary' : 'tertiary'}>
              {openingLine}
            </Text>
          ) : null}
        </View>
        <Chip tone={standingTone(standing)} label={t(standingKey(standing) as never)} size="sm" dot />
      </View>
      <FreshnessLine report={report} freshness={freshness} fetchedAt={fetchedAt} />

      {standing === 'inactive' ? <InlineNotice tone="info">{t('closingHistory.inactive.note')}</InlineNotice> : null}

      {/* ── The one figure that matters most ── */}
      <View style={styles.hero}>
        <Text variant="body" tone="secondary">
          {report.sales ? t('dailyReport.headline') : t('dailyReport.money.in')}
        </Text>
        <MoneyValue value={headline} size="display" />
        {report.sales ? (
          <Text variant="caption" tone="secondary">
            {t('dailyReport.counts', { count: String(report.sales.count), items: String(report.sales.itemsSold) })}
          </Text>
        ) : (
          <Text variant="caption" tone="tertiary">
            {t('dailyReport.hidden.sales')}
          </Text>
        )}
      </View>

      <Warnings report={report} params={warningParams} />

      {/* ── 1. Sales ── */}
      {report.sales ? (
        <Section title={t('dailyReport.sales.title')}>
          <Card style={styles.card}>
            <Line label={t('dailyReport.sales.value')} value={report.sales.value} />
            {report.sales.returns.count > 0 ? (
              <Line label={t('dailyReport.sales.returns', { count: String(report.sales.returns.count) })} value={-report.sales.returns.netRefundDue} signed />
            ) : null}
            {/* A sale cancelled today comes off here, whatever day it was sold on (0079). */}
            {report.sales.cancellations.count > 0 ? (
              <Line label={t('dailyReport.sales.cancelled', { count: String(report.sales.cancellations.count) })} value={-report.sales.cancellations.value} signed />
            ) : null}
            {report.sales.returns.count > 0 || report.sales.cancellations.count > 0 ? (
              <Line label={t('dailyReport.sales.net')} value={report.sales.netSalesValue} strong />
            ) : null}
            <Divider />
            <Disclosure title={t('dailyReport.sales.collected')} summary={<MoneyValue value={report.sales.collected.total} size="small" />}>
              <Line label={t('dailyReport.sales.atCheckout')} value={report.sales.collected.atCheckout} quiet />
              <Line label={t('dailyReport.sales.laterSameDay')} value={report.sales.collected.laterSameDay} quiet />
              {report.sales.collected.corrections !== 0 ? (
                <Line label={t('dailyReport.sales.byCorrections')} value={report.sales.collected.corrections} quiet signed />
              ) : null}
            </Disclosure>
            <Line label={t('dailyReport.sales.owed')} value={report.sales.owed} tone={report.sales.owed > 0 ? 'negative' : 'default'} />
          </Card>
        </Section>
      ) : null}

      {/* ── 2. Money received and paid out ── */}
      <Section title={t('dailyReport.money.title')}>
        <Card style={styles.card}>
          {report.money.channels
            .filter((c) => c.countable || c.in.total !== 0 || c.out.total !== 0)
            .map((c) => (
              <Line key={c.key} label={channelLabel(c, words)} value={c.in.total} />
            ))}
          <Divider />
          <Line label={t('dailyReport.money.in')} value={report.money.totals.in} strong />
          {report.money.totals.olderDebts > 0 ? <Line label={t('dailyReport.money.olderDebts')} value={report.money.totals.olderDebts} quiet /> : null}
          <Line label={t('dailyReport.money.out')} value={-report.money.totals.out} signed />
          <Line label={t('dailyReport.money.net')} value={report.money.totals.net} strong signed />
          <Disclosure title={t('dailyReport.money.details')}>
            {report.money.channels.map((c) => (
              <ChannelDetail key={c.key} channel={c} label={channelLabel(c, words)} />
            ))}
          </Disclosure>
        </Card>
      </Section>

      {/* ── 3. Expenses ── */}
      {report.expenses ? (
        <Section title={t('dailyReport.expenses.title')}>
          <Card style={styles.card}>
            {report.expenses.count === 0 && report.expenses.reversals.length === 0 ? (
              <Text variant="caption" tone="secondary">
                {t('dailyReport.expenses.none')}
              </Text>
            ) : (
              <>
                {report.expenses.byCategory.slice(0, 3).map((c) => (
                  <Line key={c.category} label={c.category} value={c.amount} quiet />
                ))}
                {/* A confirmed expense reversed today, whatever day it was recorded (0079). */}
                {report.expenses.reversals.map((r) => (
                  <Line key={r.correctionId} label={t('dailyReport.expenses.reversal', { category: r.category })} value={-r.amount} quiet signed />
                ))}
                <Line label={t('dailyReport.expenses.total')} value={report.expenses.total} strong />
                {report.expenses.fixed > 0 ? <Line label={t('dailyReport.expenses.fixed')} value={report.expenses.fixed} quiet /> : null}
                {report.expenses.count > 3 ? (
                  <Disclosure title={t('dailyReport.expenses.all')}>
                    {report.expenses.lines.map((l) => (
                      <Line key={l.id} label={`${l.category}${l.accountLabel ? ` · ${l.accountLabel}` : ''}`} value={l.amount} quiet />
                    ))}
                  </Disclosure>
                ) : null}
              </>
            )}
          </Card>
        </Section>
      ) : null}

      {/* ── 4. Result ── */}
      {report.result.status !== 'hidden' ? (
        <Section title={t('dailyReport.result.title')}>
          <Card style={styles.card}>
            {report.result.status === 'cannot_calculate' ? (
              <>
                <Text variant="bodyStrong">{t('dailyReport.result.cannot')}</Text>
                <Text variant="caption" tone="secondary">
                  {t('dailyReport.result.cannot.reason', { count: String(report.result.missingCostLines) })}
                </Text>
              </>
            ) : (
              <>
                <Line label={t('dailyReport.sales.net')} value={report.result.netSales ?? 0} />
                <Line label={t('dailyReport.result.cost')} value={-(report.result.costOfUnitsSold ?? 0)} signed />
                <Line label={t('dailyReport.result.gross')} value={report.result.grossProfit ?? 0} strong signed />
                <Line label={t('dailyReport.expenses.title')} value={-(report.result.variableExpenses + report.result.fixedExpenses)} signed />
                <Divider />
                <Line label={t('dailyReport.result.after')} value={report.result.resultAfterExpenses ?? 0} strong signed />
                {report.result.fixedExpenses > 0 ? <Line label={t('dailyReport.result.beforeFixed')} value={report.result.resultBeforeFixed ?? 0} quiet signed /> : null}
                <Text variant="caption" tone="tertiary">
                  {t('dailyReport.result.scope')}
                </Text>
              </>
            )}
            <Disclosure title={t('dailyReport.result.how')}>
              <Text variant="caption" tone="secondary">
                {t('dailyReport.result.how.body')}
              </Text>
            </Disclosure>
          </Card>
        </Section>
      ) : null}

      {/* ── 5. Expected balances ── */}
      <Section title={t('dailyReport.expected.title')}>
        <Card style={styles.card}>
          <View style={styles.between}>
            <Text variant="bodyStrong" style={styles.flex}>
              {t('dailyReport.expected.cash')}
            </Text>
            <Chip tone={verificationTone(cash.verification, cash.difference)} label={t(verificationKey(cash.verification) as never)} size="sm" dot />
          </View>
          <Line
            label={
              cash.opening.anchorDate === null
                ? t('dailyReport.expected.noOpening')
                : cash.opening.carriedDays > 0
                  ? t('dailyReport.expected.openingCarried', { date: formatDate(`${cash.opening.anchorDate}T00:00:00Z`), days: String(cash.opening.carriedDays) })
                  : t('dailyReport.expected.opening', { date: formatDate(`${cash.opening.anchorDate}T00:00:00Z`) })
            }
            value={cash.opening.amount}
            quiet
          />
          <Line label={t('dailyReport.money.in')} value={cash.in} quiet signed />
          <Line label={t('dailyReport.money.out')} value={-cash.out} quiet signed />
          <Line label={t('dailyReport.expected.expected')} value={cash.expected} strong />
          {cash.counted !== null ? (
            <>
              <Line label={t('dailyReport.expected.counted')} value={cash.counted} />
              <Line label={t('dailyReport.expected.difference')} value={cash.difference ?? 0} signed tone="auto" />
            </>
          ) : null}
          {report.expected.accounts
            .filter((a) => a.accountId !== null)
            .map((a) => (
              <View key={a.key} style={styles.account}>
                <Divider />
                <View style={styles.between}>
                  <Text variant="bodyStrong" style={styles.flex}>
                    {a.label}
                  </Text>
                  <Chip tone={verificationTone(a.verification, a.difference)} label={t(verificationKey(a.verification) as never)} size="sm" dot />
                </View>
                <Line label={t('dailyReport.expected.account')} value={a.expectedMovement} signed />
                {a.counted !== null ? <Line label={t('dailyReport.expected.difference')} value={a.difference ?? 0} signed tone="auto" /> : null}
              </View>
            ))}
          {report.expected.accounts.some((a) => a.accountId !== null) ? (
            <Text variant="caption" tone="tertiary">
              {t('dailyReport.expected.account.note')}
            </Text>
          ) : null}
        </Card>
      </Section>

      {/* ── The actions of the day ── */}
      <View style={styles.actions}>
        {showOpen ? (
          <Button title={t('closingHistory.open')} fullWidth loading={openDay.isPending} disabled={!online || openDay.isPending} onPress={() => void onOpen()} />
        ) : null}
        {report.isToday && canClose && report.close?.canClose ? (
          <Button title={t('dailyReport.close')} fullWidth variant={showOpen ? 'secondary' : 'primary'} disabled={!online} onPress={() => setReview(true)} />
        ) : null}
        {report.isToday && closed && canClose && day?.canReopen ? (
          <Button title={t('closingHistory.reopen')} fullWidth variant="secondary" loading={reopen.isPending} disabled={!online || reopen.isPending} onPress={() => void onReopen()} />
        ) : null}
        {/*
          The two secondary paths are rows, not buttons: a button keeps its label on one line, and
          "Check physical cash or account balance" is cut at 320 pt or at large text (found by the checks).
        */}
        {(report.isToday && canCount && !closed) || ((canClose || canCorrect) && standing !== 'inactive') ? (
          <RowGroup>
            {report.isToday && canCount && !closed ? (
              <ListRow flat leading={Scale} title={t('dailyReport.check')} onPress={() => router.push('/closing/count' as Href)} />
            ) : null}
            {(canClose || canCorrect) && standing !== 'inactive' ? (
              <ListRow
                flat
                leading={PencilLine}
                title={t('dailyReport.correct')}
                onPress={() => router.push({ pathname: '/closing/sources', params: { date: report.date } } as never)}
              />
            ) : null}
          </RowGroup>
        ) : null}
        {report.isToday && !canClose && !closed ? (
          <Text variant="caption" tone="secondary">
            {t('dailyReport.notYours')}
          </Text>
        ) : null}
      </View>

      {/* ── What happened, in order ── */}
      {day ? (
        <Section title={t('dailyReport.history')}>
          <Card style={styles.history}>
            <Disclosure title={t('closingHistory.history')} summary={<Text variant="caption" tone="secondary">{String(day.history.length)}</Text>}>
              {day.history.length === 0 ? (
                <Text variant="caption" tone="secondary">
                  {t(report.isToday ? 'closingHistory.history.empty' : 'closingHistory.history.past.empty')}
                </Text>
              ) : (
                day.history.map((h, i) => <HistoryRow key={`${h.kind}-${h.at}-${i}`} entry={h} first={i === 0} />)
              )}
            </Disclosure>
          </Card>
          <Text variant="caption" tone="tertiary">
            {t('closingHistory.history.note')}
          </Text>
        </Section>
      ) : null}

      {day ? (
        <ReopenSheet
          open={reopenSheet}
          onClose={() => setReopenSheet(false)}
          businessDate={day.businessDate}
          nextDate={day.nextDate}
          now={day.localNow}
          choices={day.reopenChoices}
          busy={reopen.isPending}
          onConfirm={(mode) => void confirmReopen(mode)}
        />
      ) : null}
      {report.close ? (
        <CloseReviewSheet
          open={review}
          onClose={() => {
            setReview(false);
            onRefresh();
          }}
          report={report}
          freshness={freshness}
          onChanged={onRefresh}
        />
      ) : null}
    </View>
  );
}

/** "Last updated", said plainly — and never presenting stale or offline figures as final. */
function FreshnessLine({ report, freshness, fetchedAt }: { report: DailyReport; freshness: Freshness; fetchedAt: number }) {
  const { t } = useTranslation();
  const time = isolateLtr(formatTime(new Date(fetchedAt)));
  if (report.source === 'snapshot' && report.snapshot) {
    const at = isolateLtr(formatTime(report.snapshot.at));
    return (
      <View>
        <Text variant="caption" tone="secondary">
          {report.snapshot.by ? t('dailyReport.snapshot', { time: at, name: report.snapshot.by }) : t('dailyReport.snapshot.noName', { time: at })}
        </Text>
        {report.snapshot.verification.reason ? (
          <Text variant="caption" tone="tertiary">
            {t('dailyReport.snapshot.reason', { reason: report.snapshot.verification.reason })}
          </Text>
        ) : null}
      </View>
    );
  }
  if (freshness === 'offline') return <InlineNotice tone="warning">{t('dailyReport.offline', { time })}</InlineNotice>;
  if (freshness === 'stale') return <InlineNotice tone="info">{t('dailyReport.stale', { time })}</InlineNotice>;
  return (
    <Text variant="caption" tone="tertiary">
      {t('dailyReport.lastUpdated', { time })}
    </Text>
  );
}

/** The warnings as one compact list — never a stack of large boxes. */
function Warnings({ report, params }: { report: DailyReport; params: (p?: Record<string, string | number>) => Record<string, string> }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const shown = report.warnings.filter((w) => w.code !== 'account_movement_not_balance');
  if (shown.length === 0) return null;
  return (
    <Card variant="sunken" padding="md" style={styles.warnings}>
      {shown.map((w) => (
        <View key={w.code} style={styles.warning}>
          <View style={[styles.bullet, w.severity === 'info' ? null : styles.bulletWarn]} />
          <Text variant="caption" tone={w.severity === 'info' ? 'secondary' : 'primary'} style={styles.flex}>
            {t(warningKey(w.code) as never, params(w.params))}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** One channel's own in and out, for "Details by channel". */
function ChannelDetail({ channel, label }: { channel: ReportChannel; label: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const lines: [string, number][] = [
    [t('dailyReport.money.todaysSales'), channel.in.todaysSales],
    [t('dailyReport.money.olderDebts'), channel.in.olderDebts],
    [t('dailyReport.money.correctionsIn'), channel.in.correctionsIn],
    [t('dailyReport.money.refunds'), -channel.out.refunds],
    [t('dailyReport.money.stockPurchases'), -channel.out.stockPurchases],
    [t('dailyReport.money.expenses'), -channel.out.expenses],
    [t('dailyReport.money.correctionsOut'), -channel.out.correctionsOut],
  ];
  return (
    <View style={styles.channel}>
      <View style={styles.between}>
        <Text variant="bodyStrong" style={styles.flex}>
          {label}
        </Text>
        <MoneyValue value={channel.net} size="small" signed tone="auto" />
      </View>
      {lines
        .filter(([, v]) => v !== 0)
        .map(([l, v]) => (
          <Line key={l} label={l} value={v} quiet signed />
        ))}
    </View>
  );
}

/** A statement line: words on one side, an aligned MRU figure on the other. */
function Line({
  label,
  value,
  strong,
  quiet,
  signed,
  tone,
}: {
  label: string;
  value: number;
  strong?: boolean;
  quiet?: boolean;
  signed?: boolean;
  tone?: 'default' | 'positive' | 'negative' | 'muted' | 'auto';
}) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyStrong' : quiet ? 'caption' : 'body'} tone={strong ? 'primary' : 'secondary'} style={styles.flex}>
        {label}
      </Text>
      <MoneyValue value={value} size={strong ? 'default' : 'small'} signed={signed} tone={tone ?? (quiet ? 'muted' : 'default')} />
    </View>
  );
}

/** A dot, what happened, when (store time), who, and one line saying how much. */
function HistoryRow({ entry, first }: { entry: ClosingHistoryEntry; first: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const p = entry.payload;
  const money = (v: unknown) => isolateLtr(formatMoney(Number(v ?? 0)));
  let caption: string | null = null;
  switch (entry.kind) {
    case 'count_saved':
      caption = p.skipped ? String(p.label ?? '') : `${String(p.label ?? '')} · ${t('closing.history.counted', { amount: money(p.counted) })}`;
      break;
    case 'closed':
    case 'reclosed':
      // A close without a physical check says so — never "0 counted".
      caption =
        p.countedCash == null
          ? t('closing.history.notVerified', { count: String(p.unverifiedCount ?? '') })
          : `${t('closing.history.counted', { amount: money(p.countedCash) })} · ${t('closing.history.difference', { amount: isolateLtr(formatMoney(Number(p.difference ?? 0), { signed: true })) })}`;
      break;
    case 'reopened':
    case 'auto_reopened':
      caption = t('closing.history.continues', { date: formatDate(`${entry.localDate}T00:00:00Z`) });
      break;
    case 'day_started_early':
      caption = t('reopen.started', { date: formatDate(`${entry.localDate}T00:00:00Z`) });
      break;
    case 'first_activity':
    case 'sale':
      caption =
        Number(p.owed ?? 0) > 0
          ? t('closing.history.saleOwed', { amount: money(p.total), owed: money(p.owed) })
          : t('closing.history.saleCash', { amount: money(p.cashIn ?? p.total) });
      break;
    default:
      caption = null;
  }
  const withItem = entry.kind === 'sale' || entry.kind === 'first_activity';
  return (
    <View style={[styles.row, !first && styles.rowJoin]}>
      <View style={[styles.dot, { backgroundColor: colors.semantic.primary }]} />
      <View style={styles.rowBody}>
        <View style={styles.between}>
          <Text variant="bodyStrong" style={styles.flex}>
            {`${t(historyKey(entry.kind) as never)}${withItem && p.item ? ` · ${String(p.item)}` : ''}`}
          </Text>
          <Text variant="body" tone="secondary">
            {isolateLtr(entry.localTime)}
          </Text>
        </View>
        {caption ? (
          <Text variant="caption" tone="secondary">
            {caption}
          </Text>
        ) : null}
        {entry.actor ? (
          <Text variant="caption" tone="tertiary">
            {t('closing.history.by', { name: entry.actor })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.surface.canvas },
  content: { padding: space.base, gap: space.lg, paddingBottom: space['3xl'] },
  report: { gap: space.lg },
  dates: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  hero: { gap: 2 },
  card: { gap: space.sm },
  account: { gap: space.sm },
  channel: { gap: space.xs, paddingVertical: space.xs },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 28 },
  flex: { flex: 1, minWidth: 0 },
  actions: { gap: space.sm },
  warnings: { gap: space.xs },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bullet: { width: 8, height: 8, borderRadius: radius.full, marginTop: 6, backgroundColor: colors.border.strong },
  bulletWarn: { backgroundColor: colors.semantic.warning },
  history: { gap: 0 },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  rowJoin: { borderTopWidth: 1, borderTopColor: colors.border.subtle },
  dot: { width: 10, height: 10, borderRadius: radius.full, marginTop: 6 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
}));
