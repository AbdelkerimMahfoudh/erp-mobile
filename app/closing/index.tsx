import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { Button, Card, Chip, Divider, ErrorState, FilterChip, InlineNotice, MoneyValue, Screen, Section, SkeletonList, Text } from '../../components/ui';
import { SelectSheet } from '../../components/overlay/SelectSheet';
import { ReopenSheet } from '../../components/closing/ReopenSheet';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { isolateLtr } from '../../lib/design/direction';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatDate, formatMoney } from '../../lib/format';
import { dayChoices, dayWordKey, historyKey, openingKey, sinceLastCountTone, standingKey, standingTone, type ReopenMode } from '../../lib/home-day';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { useOpenClosing, useOpenDay, useReopenDay, type ClosingHistoryEntry, type OpenClosing } from '../../lib/closing';

/**
 * Closing & history (docs/50 §3.2 and §6, reference 05): any business day —
 * today by default, yesterday, or one chosen from the last sixty — where it
 * stands, when the boutique opened (or that no opening time was recorded),
 * what the drawer should hold and what moved since the last count, the one
 * action that applies, and the day's timeline: every opening, count, close,
 * reopen, the first sale and each sale after the first close, in store time.
 * Counting itself lives one tap away on `/closing/count`; this screen never
 * closes anything by itself.
 */
export default function ClosingHistoryScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  /** Undefined = the branch's current business day, whatever the phone's clock says. */
  const [date, setDate] = useState<string | undefined>(undefined);
  const view = useOpenClosing(date);
  /** Remembered from the last read so the selector stays while another day loads (derived, no effect). */
  const [today, setToday] = useState<string | null>(null);
  if (view.data && view.data.today !== today) setToday(view.data.today);

  const bar = today ? <DateBar today={today} date={date ?? today} onPick={setDate} /> : null;

  if (view.isPending) {
    return (
      <Screen gap="lg">
        <Stack.Screen options={{ headerShown: true, title: t('closingHistory.title') }} />
        {bar}
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (view.isError || !view.data) {
    return (
      <Screen gap="lg">
        <Stack.Screen options={{ headerShown: true, title: t('closingHistory.title') }} />
        {bar}
        <ErrorState error={view.error} onRetry={() => void view.refetch()} />
      </Screen>
    );
  }
  return (
    <Day day={view.data} date={date} onRefresh={() => void view.refetch()} refreshing={view.isRefetching}>
      <View style={styles.bar}>{bar}</View>
    </Day>
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

function Day({
  day,
  date,
  onRefresh,
  refreshing,
  children,
}: {
  day: OpenClosing;
  date: string | undefined;
  onRefresh: () => void;
  refreshing: boolean;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchName } = useBranch();
  const offline = !useConnectivity((s) => s.online);
  const canCount = usePermission('closing.count');
  const canClose = usePermission('closing.perform');
  const reopen = useReopenDay(date);
  const openDay = useOpenDay(date);
  const [sheet, setSheet] = useState(false);

  const standing = day.standing;
  const isToday = day.businessDate === day.today;
  const chipTone = standingTone(standing);
  const sinceTone = sinceLastCountTone(day.sinceLastCount);
  const dateWord = formatDate(`${day.businessDate}T00:00:00Z`);

  const confirmReopen = async (mode: ReopenMode) => {
    try {
      await reopen.mutateAsync(mode);
      setSheet(false);
      toast.success(mode === 'start_new' ? t('reopen.started', { date: formatDate(`${day.nextDate}T00:00:00Z`) }) : t('reopen.done', { date: dateWord }));
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('reopen.failed'));
    }
  };

  const onReopen = async () => {
    if (day.reopenChoices.includes('start_new')) {
      setSheet(true);
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

  /** "Open the boutique": the physical opening, recorded with the store's time and the person's name. */
  const onOpen = async () => {
    try {
      const fresh = await openDay.mutateAsync();
      toast.success(t('closingHistory.open.done', { time: isolateLtr(fresh.opening?.localTime ?? fresh.localNow) }));
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('closingHistory.open.failed'));
    }
  };

  const openingLine = t(
    openingKey(day.opening, isToday) as never,
    day.opening ? { date: formatDate(`${day.opening.localDate}T00:00:00Z`), time: isolateLtr(day.opening.localTime) } : undefined,
  );

  const note = !isToday
    ? t('closingHistory.past.note')
    : standing === 'reopened'
      ? t('closingHistory.reopened.note')
      : standing === 'closed'
        ? t('closingHistory.closed.note')
        : standing === 'needs_review'
          ? t('closingHistory.needsReview.note')
          : null;

  const showOpen = isToday && canCount && day.canOpen && standing !== 'closed';

  return (
    <Screen scroll gap="lg" onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ headerShown: true, title: t('closingHistory.title') }} />
      {children}
      <Text variant="label" tone="secondary">
        {t('closingHistory.context', { date: dateWord, branch: branchName ?? '' })}
      </Text>
      {offline ? <InlineNotice tone="warning">{t('closing.offline')}</InlineNotice> : null}

      {/* ── The business day ── */}
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text variant="title" style={styles.flex}>
            {t('closingHistory.businessDay')}
          </Text>
          <Chip tone={chipTone} label={t(standingKey(standing) as never)} size="sm" dot />
        </View>
        {/* When a person opened — never inferred from 06:00 or from a sale. */}
        <Text variant="caption" tone={day.opening ? 'secondary' : 'tertiary'}>
          {openingLine}
        </Text>
        <View>
          <Text variant="body" tone="secondary">
            {t('closingHistory.expected')}
          </Text>
          <MoneyValue value={day.expectedCash} size="display" />
          {day.openingCash !== 0 ? (
            <Text variant="caption" tone="tertiary">
              {`${t('closingHistory.opening')} ${isolateLtr(formatMoney(day.openingCash))}`}
            </Text>
          ) : null}
        </View>
        <Divider />
        <View style={styles.between}>
          <Text variant="body" tone="secondary">
            {t('closingHistory.since')}
          </Text>
          {day.sinceLastCount === null ? (
            <Text variant="body" tone="secondary">
              {t('closingHistory.notCounted')}
            </Text>
          ) : (
            <MoneyValue value={day.sinceLastCount} size="large" tone={sinceTone === 'neutral' ? 'default' : sinceTone === 'success' ? 'positive' : 'negative'} signed />
          )}
        </View>
        {day.lastCountedAt ? (
          <Text variant="caption" tone="secondary">
            {t('closingHistory.lastCounted', { time: isolateLtr(day.lastCountedLocalTime ?? '') })}
          </Text>
        ) : null}
        {day.freshCountRequired ? (
          <Chip tone="warning" label={t('closingHistory.fresh')} size="sm" dot style={styles.selfStart} />
        ) : null}
        {note ? (
          <Text variant="caption" tone="tertiary">
            {note}
          </Text>
        ) : null}

        {/* The actions of today: open the boutique once; count and close; reopen once it is closed. */}
        {standing === 'closed' ? (
          isToday && canClose && day.canReopen ? (
            <Button title={t('closingHistory.reopen')} variant="secondary" fullWidth loading={reopen.isPending} disabled={offline || reopen.isPending} onPress={() => void onReopen()} />
          ) : null
        ) : isToday && canCount ? (
          <>
            {showOpen ? (
              <Button title={t('closingHistory.open')} fullWidth loading={openDay.isPending} disabled={offline || openDay.isPending} onPress={() => void onOpen()} />
            ) : null}
            <Button
              title={canClose ? t('closing.review') : t('closing.title')}
              variant={showOpen ? 'secondary' : 'primary'}
              fullWidth
              disabled={offline}
              onPress={() => router.push('/closing/count' as Href)}
            />
            {showOpen ? (
              <Text variant="caption" tone="tertiary">
                {t('closingHistory.open.note')}
              </Text>
            ) : null}
          </>
        ) : null}
        {isToday && !canClose && standing !== 'closed' ? (
          <Text variant="caption" tone="secondary">
            {t('closing.signOff.notYours')}
          </Text>
        ) : null}
      </Card>

      {day.previousDay?.needsReview ? (
        <InlineNotice tone="warning">
          {t('closingHistory.previous', {
            date: formatDate(`${day.previousDay.businessDate}T00:00:00Z`),
            standing: t(standingKey(day.previousDay.standing) as never),
          })}
        </InlineNotice>
      ) : null}

      {/* ── The timeline ── */}
      <Section title={t('closingHistory.history')}>
        <Card style={styles.history}>
          {day.history.length === 0 ? (
            <Text variant="caption" tone="secondary">
              {t(isToday ? 'closingHistory.history.empty' : 'closingHistory.history.past.empty')}
            </Text>
          ) : (
            day.history.map((h, i) => <HistoryRow key={`${h.kind}-${h.at}-${i}`} entry={h} first={i === 0} />)
          )}
        </Card>
        <Text variant="caption" tone="tertiary">
          {t('closingHistory.history.note')}
        </Text>
      </Section>

      <ReopenSheet
        open={sheet}
        onClose={() => setSheet(false)}
        businessDate={day.businessDate}
        nextDate={day.nextDate}
        now={day.localNow}
        choices={day.reopenChoices}
        busy={reopen.isPending}
        onConfirm={(mode) => void confirmReopen(mode)}
      />
    </Screen>
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
      caption = `${t('closing.history.counted', { amount: money(p.countedCash) })} · ${t('closing.history.difference', { amount: isolateLtr(formatMoney(Number(p.difference ?? 0), { signed: true })) })}`;
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
  bar: { marginBottom: -space.sm },
  dates: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  flex: { flex: 1, minWidth: 0 },
  selfStart: { alignSelf: 'flex-start' },
  history: { gap: 0 },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  rowJoin: { borderTopWidth: 1, borderTopColor: colors.border.subtle },
  dot: { width: 10, height: 10, borderRadius: radius.full, marginTop: 6 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
}));
