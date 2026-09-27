import React, { useContext, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeaderShownContext } from '../../lib/navigation/router-internals';
import { Stack, useRouter } from 'expo-router';
import { CalendarDays, HelpCircle, PencilLine, Scale } from 'lucide-react-native';
import { Button, Card, Chip, Divider, ErrorState, Expandable, FilterChip, IconButton, InlineNotice, ListRow, MoneyValue, RowGroup, SkeletonList, Text } from '../../components/ui';
import { SelectSheet } from '../../components/overlay/SelectSheet';
import { DayChoiceSheet } from '../../components/closing/DayChoiceSheet';
import { CloseDaySheet } from '../../components/closing/CloseDaySheet';
import { HistoryPanel } from '../../components/closing/HistoryPanel';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { isolateLtr } from '../../lib/design/direction';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatDate, formatMoney, formatTime } from '../../lib/format';
import { dayChoices, dayWordKey, historyKey, openingKey, openingPrompt, standingKey, standingTone, type ReopenMode } from '../../lib/home-day';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { useOpenClosing, useOpenDay, useReopenDay, type ClosingHistoryEntry, type OpenClosing } from '../../lib/closing';
import { useDailyReport, type DailyReport } from '../../lib/closing-report';
import { channelLabel, reportFreshness, warningKey, type Freshness } from '../../lib/closing-report-view';

/**
 * The Daily closing (docs/51, docs/58): one business date as a short,
 * bill-like statement built on the server from what was already recorded.
 *
 * First the boutique, the date, the recorded opening and the standing; then
 * the statement — sales and items, and gross profit, expenses and result where
 * the person may see them and they can be calculated — with the figure rows
 * one tap away and the words behind a (?); then the money movements, always in
 * view; then the day's actions — *Close the business day* opens the popup
 * that asks whether the cash and account movements were checked, takes the
 * amounts right there or the person's word, and closes — and its history as
 * one rectangle that slides open. Nothing is typed again, nothing is added up
 * here, and the physical check stays optional.
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
          <Report
            report={report.data}
            fetchedAt={report.dataUpdatedAt}
            day={day.data ?? null}
            date={date}
            refreshing={report.isFetching || day.isFetching}
            onRefresh={refresh}
          />
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
      <FilterChip label={custom ? formatDate(date) : t('closingHistory.pickDate')} selected={custom} onPress={() => setOpen(true)} />
      <SelectSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('closingHistory.pickDate.title')}
        subtitle={t('closingHistory.pickDate.subtitle')}
        items={items}
        keyExtractor={(d: string) => d}
        labelExtractor={(d: string) => formatDate(d)}
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
  refreshing,
  onRefresh,
}: {
  report: DailyReport;
  fetchedAt: number;
  day: OpenClosing | null;
  date: string | undefined;
  /** The report or the live view is being read again. */
  refreshing: boolean;
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
  const [openSheet, setOpenSheet] = useState(false);
  /** Remounts the opening sheet each time it is asked for, so the safe default is selected again. */
  const [openSheetNonce, setOpenSheetNonce] = useState(0);
  const [closing, setClosing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const freshness: Freshness = reportFreshness(fetchedAt, online);
  const dateWord = formatDate(report.date);
  const words = { cash: t('closing.channel.cash'), unattributed: t('closing.channel.unattributed') };
  const money = (v: number) => isolateLtr(formatMoney(v));
  const warningParams = (p?: Record<string, string | number>) =>
    Object.fromEntries(
      Object.entries(p ?? {}).map(([k, v]) => [
        k,
        k === 'date' || k === 'anchorDate' ? formatDate(String(v)) : typeof v === 'number' && k !== 'count' && k !== 'days' ? money(v) : String(v),
      ]),
    );

  const confirmReopen = async (mode: ReopenMode) => {
    try {
      await reopen.mutateAsync(mode);
      setReopenSheet(false);
      toast.success(mode === 'start_new' ? t('reopen.started', { date: day?.nextDate ? formatDate(day.nextDate) : dateWord }) : t('reopen.done', { date: dateWord }));
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
  const recordOpening = async (mode?: ReopenMode) => {
    try {
      const fresh = await openDay.mutateAsync(mode);
      const time = isolateLtr(fresh.opening?.localTime ?? fresh.localNow);
      toast.success(mode === 'start_new' ? t('openChoice.started', { date: formatDate(fresh.businessDate), time }) : t('closingHistory.open.done', { time }));
      setOpenSheet(false);
      onRefresh();
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('closingHistory.open.failed'));
    }
  };
  /*
    Before 06:00 the store's calendar date has moved on but the business date has not (docs/56).
    The Owner, offered the early start, chooses which day the opening is for BEFORE it is
    recorded; anybody else is told which business day it is and that new sales count for it.
    The prompt, the dates and the time are the server's — the phone's clock plays no part.
  */
  const onOpen = async () => {
    if (!day) return;
    const prompt = openingPrompt(day.openChoices, day.localNowDate, day.businessDate);
    if (prompt === 'choice') {
      setOpenSheetNonce((n) => n + 1);
      setOpenSheet(true);
      return;
    }
    if (prompt === 'notice') {
      const ok = await dialog.confirm({
        title: t('openChoice.notice.title', { date: formatDate(day.businessDate) }),
        message: t('openChoice.notice.body', {
          time: isolateLtr(day.localNow),
          calendarDate: formatDate(day.localNowDate),
          date: formatDate(day.businessDate),
          next: formatDate(day.nextDate),
        }),
        confirmLabel: t('closingHistory.open'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
    }
    await recordOpening();
  };

  const standing = report.standing;
  const closed = standing === 'closed';
  const showOpen = report.isToday && canCount && !!day?.canOpen && !closed;
  const openingLine = day
    ? t(
        openingKey(day.opening, report.isToday) as never,
        day.opening ? { date: formatDate(day.opening.localDate), time: isolateLtr(day.opening.localTime) } : undefined,
      )
    : null;
  const headline = report.sales ? report.sales.value : report.money.totals.in;
  const result = report.result;
  const resultOk = result.status === 'ok';
  const resultBlocked = result.status === 'cannot_calculate';
  const adjusted = report.sales ? report.sales.returns.count > 0 || report.sales.cancellations.count > 0 : false;

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

      {/* ── The statement: sales and items; gross profit, expenses and result where permitted and calculable ── */}
      <Card style={styles.statement}>
        <View style={styles.hero}>
          <Text variant="body" tone="secondary">
            {report.sales ? t('dailyReport.headline') : t('dailyReport.money.in')}
          </Text>
          <MoneyValue value={headline} size="display" />
          {report.sales ? (
            <Text variant="caption" tone="secondary">
              {t('dailyReport.counts', {
                count: String(report.sales.salesCount ?? report.sales.count),
                items: String(report.sales.unitsSold ?? report.sales.itemsSold),
              })}
            </Text>
          ) : (
            <Text variant="caption" tone="tertiary">
              {t('dailyReport.hidden.sales')}
            </Text>
          )}
        </View>
        {resultOk || resultBlocked || report.expenses ? (
          <View style={styles.statementLines}>
            <Divider />
            {resultOk ? <Line label={t('dailyReport.result.gross')} value={result.grossProfit ?? 0} signed /> : null}
            {report.expenses ? <Line label={t('dailyReport.expenses.title')} value={-report.expenses.total} signed /> : null}
            {resultOk ? <Line label={t('dailyReport.result.after')} value={result.resultAfterExpenses ?? 0} strong signed /> : null}
            {resultBlocked ? (
              <Text variant="caption" tone="secondary">
                {t('dailyReport.result.cannot.short', { count: String(result.missingCostLines) })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/*
          Sales details: the figure rows only — how the sales value becomes the result. A cancellation or a return
          row appears only when it has a value and is needed to explain net sales. What the figures mean is one tap
          away on the (?), never on the page. One line: the title with its chevron right after it, the (?) at the end
          and outside the toggle — the rows below keep the full width, so every amount sits in the statement's column.
        */}
        {report.sales ? (
          <Expandable
            title={t('dailyReport.salesDetails')}
            tone="accent"
            chevron="afterTitle"
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            trailing={
              <IconButton
                icon={HelpCircle}
                variant="plain"
                accessibilityLabel={t('dailyReport.salesDetails.help')}
                onPress={() =>
                  void dialog.alert({
                    title: t('dailyReport.salesDetails'),
                    message: [
                      t('dailyReport.countRule'),
                      resultOk || resultBlocked ? t('dailyReport.result.how.body') : null,
                      resultOk ? t('dailyReport.result.scope') : null,
                      resultBlocked ? `${t('dailyReport.result.cannot')} ${t('dailyReport.result.cannot.reason', { count: String(result.missingCostLines) })}` : null,
                    ]
                      .filter(Boolean)
                      .join('\n\n'),
                  })
                }
              />
            }
          >
            <View style={styles.detail}>
              <Line label={t('dailyReport.salesDetails.invoiced')} value={report.sales.value} />
              {report.sales.cancellations.count > 0 && report.sales.cancellations.value !== 0 ? (
                <Line
                  label={t('dailyReport.sales.cancelled', { count: String(report.sales.cancellations.count), items: String(report.sales.cancellations.items) })}
                  value={-report.sales.cancellations.value}
                  signed
                />
              ) : null}
              {report.sales.returns.count > 0 && report.sales.returns.netRefundDue !== 0 ? (
                <Line label={t('dailyReport.sales.returns', { count: String(report.sales.returns.count) })} value={-report.sales.returns.netRefundDue} signed />
              ) : null}
              <Line label={t('dailyReport.sales.net')} value={report.sales.netSalesValue} strong={adjusted} />
              {resultOk ? (
                <>
                  <Line label={t('dailyReport.result.cost')} value={-(result.costOfUnitsSold ?? 0)} signed />
                  <Line label={t('dailyReport.result.gross')} value={result.grossProfit ?? 0} strong signed />
                  <Line label={t('dailyReport.expenses.title')} value={-(result.variableExpenses + result.fixedExpenses)} signed />
                  <Line label={t('dailyReport.result.after')} value={result.resultAfterExpenses ?? 0} strong signed />
                </>
              ) : null}
            </View>
          </Expandable>
        ) : null}
      </Card>

      <Warnings report={report} params={warningParams} />

      {/*
        Money movements, always in view: each channel's recorded movement for the day (money in less money out through
        it), then — under a line — the debt settled this day (already inside the channels above, never added again) and
        the total recorded movement across these channels. The server's figures; the phone sums nothing. A total of
        recorded movement is not counted cash and not a provider balance, and the card says so.
      */}
      <Card style={styles.card}>
        <Text variant="heading">{t('dailyReport.movements')}</Text>
        {report.money.channels
          .filter((c) => c.countable || c.net !== 0)
          .map((c) => (
            // The drawer is named as the closing popup names it, so the two read as one.
            <Line key={c.key} label={c.channel === 'cash' ? t('dailyReport.expected.cash') : channelLabel(c, words)} value={c.net} signed tone="auto" />
          ))}
        <Divider />
        <Line label={t('dailyReport.movements.debtSettled')} value={report.money.totals.olderDebts} quiet />
        <Line label={t('dailyReport.movements.total')} value={report.money.totals.net} strong signed />
        <Text variant="caption" tone="tertiary">
          {t('dailyReport.movements.total.note')}
        </Text>
      </Card>

      {/* ── The actions of the day ── */}
      <View style={styles.actions}>
        {showOpen ? (
          <Button title={t('closingHistory.open')} fullWidth loading={openDay.isPending} disabled={!online || openDay.isPending} onPress={() => void onOpen()} />
        ) : null}
        {report.isToday && canClose && report.close?.canClose ? (
          <Button title={t('dailyReport.closeDay')} fullWidth variant={showOpen ? 'secondary' : 'primary'} disabled={!online} onPress={() => setClosing(true)} />
        ) : null}
        {report.isToday && closed && canClose && day?.canReopen ? (
          <Button title={t('closingHistory.reopen')} fullWidth variant="secondary" loading={reopen.isPending} disabled={!online || reopen.isPending} onPress={() => void onReopen()} />
        ) : null}
        {/* Rows, not buttons: each keeps its whole label at 320 pt and at large text. */}
        {(canClose || canCorrect) && standing !== 'inactive' ? (
          <RowGroup>
            <ListRow
              flat
              leading={PencilLine}
              title={t('dailyReport.correct')}
              onPress={() => router.push({ pathname: '/closing/sources', params: { date: report.date } } as never)}
            />
            {canClose ? <ListRow flat leading={Scale} title={t('closing.differences.link')} onPress={() => router.push('/discrepancies' as never)} /> : null}
          </RowGroup>
        ) : null}
        {report.isToday && !canClose && !closed ? (
          <Text variant="caption" tone="secondary">
            {t('dailyReport.notYours')}
          </Text>
        ) : null}
      </View>


      {/* ── What happened, in order: one rectangle that slides open ── */}
      {day ? (
        <View style={styles.historyBlock}>
          <HistoryPanel title={t('dailyReport.history')} count={day.history.length}>
            {day.history.length === 0 ? (
              <Text variant="caption" tone="secondary" style={styles.historyEmpty}>
                {t(report.isToday ? 'closingHistory.history.empty' : 'closingHistory.history.past.empty')}
              </Text>
            ) : (
              day.history.map((h, i) => <HistoryRow key={`${h.kind}-${h.at}-${i}`} entry={h} first={i === 0} />)
            )}
          </HistoryPanel>
          <Text variant="caption" tone="tertiary">
            {t('closingHistory.history.note')}
          </Text>
        </View>
      ) : null}

      {day ? (
        <>
          <DayChoiceSheet
            intent="reopen"
            open={reopenSheet}
            onClose={() => setReopenSheet(false)}
            businessDate={day.businessDate}
            nextDate={day.nextDate}
            calendarDate={day.localNowDate}
            now={day.localNow}
            choices={day.reopenChoices}
            busy={reopen.isPending}
            onConfirm={(mode) => void confirmReopen(mode)}
          />
          <DayChoiceSheet
            key={openSheetNonce}
            intent="open"
            open={openSheet}
            onClose={() => setOpenSheet(false)}
            businessDate={day.businessDate}
            nextDate={day.nextDate}
            calendarDate={day.localNowDate}
            now={day.localNow}
            choices={day.openChoices ?? ['continue']}
            busy={openDay.isPending}
            onConfirm={(mode) => void recordOpening(mode)}
          />
        </>
      ) : null}
      {report.close ? (
        <CloseDaySheet
          open={closing}
          // The close and its refusals refresh the day themselves; closing the popup reads nothing again.
          onClose={() => setClosing(false)}
          report={report}
          day={day}
          freshness={freshness}
          refreshing={refreshing}
          canCount={canCount}
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
        {/* Closed on the person's word: said as such — never as counted, never as a difference of nothing. */}
        {(report.snapshot.verification.attested?.length ?? 0) > 0 ? (
          <Text variant="caption" tone="tertiary">
            {t('closeDay.checkedNoAmounts')}
          </Text>
        ) : null}
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
      // An account's check is the movement its app showed, never a count.
      caption = p.skipped
        ? String(p.label ?? '')
        : `${String(p.label ?? '')} · ${t(p.channel === 'account' ? 'closing.history.checked' : 'closing.history.counted', { amount: money(p.counted) })}`;
      break;
    case 'closed':
    case 'reclosed':
      // A close without a physical check says so — never "0 counted"; a close on the person's word says that,
      // and a close with the drawer counted still names the balances it took on the person's word.
      caption =
        p.countedCash == null
          ? Number(p.attestedCount ?? 0) > 0 && Number(p.unverifiedCount ?? 0) === 0
            ? t('closing.history.attested', { count: String(p.attestedCount) })
            : t('closing.history.notVerified', { count: String(p.unverifiedCount ?? '') })
          : [
              `${t('closing.history.counted', { amount: money(p.countedCash) })} · ${t('closing.history.difference', { amount: isolateLtr(formatMoney(Number(p.difference ?? 0), { signed: true })) })}`,
              Number(p.attestedCount ?? 0) > 0 ? t('closing.history.attested', { count: String(p.attestedCount) }) : null,
            ]
              .filter(Boolean)
              .join(' · ');
      break;
    case 'reopened':
    case 'auto_reopened':
      caption = t('closing.history.continues', { date: formatDate(entry.localDate) });
      break;
    case 'day_started_early':
      caption = t('reopen.started', { date: formatDate(entry.localDate) });
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
  statement: { gap: space.md },
  statementLines: { gap: space.xs },
  detail: { gap: space.xs },
  card: { gap: space.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 28 },
  flex: { flex: 1, minWidth: 0 },
  actions: { gap: space.sm },
  warnings: { gap: space.xs },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bullet: { width: 8, height: 8, borderRadius: radius.full, marginTop: 6, backgroundColor: colors.border.strong },
  bulletWarn: { backgroundColor: colors.semantic.warning },
  historyBlock: { gap: space.sm },
  historyEmpty: { paddingVertical: space.sm },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  rowJoin: { borderTopWidth: 1, borderTopColor: colors.border.subtle },
  dot: { width: 10, height: 10, borderRadius: radius.full, marginTop: 6 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
}));
