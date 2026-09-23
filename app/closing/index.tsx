import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { Button, Card, Chip, Divider, ErrorState, InlineNotice, MoneyValue, Screen, Section, SkeletonList, Text } from '../../components/ui';
import { ReopenSheet } from '../../components/closing/ReopenSheet';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { isolateLtr } from '../../lib/design/direction';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatDate, formatMoney, formatTime } from '../../lib/format';
import { historyKey, sinceLastCountTone, standingKey, standingTone, type ReopenMode } from '../../lib/home-day';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { useOpenClosing, useReopenDay, type ClosingHistoryEntry, type OpenClosing } from '../../lib/closing';

/**
 * Closing & history (docs/50 §3.2, reference 05): where the business day
 * stands, what the drawer should hold and what moved since the last count,
 * the one action that applies, and the day's history — every count, close,
 * reopen and each sale made after the first close. Counting itself lives one
 * tap away on `/closing/count`; this screen never closes anything by itself.
 */
export default function ClosingHistoryScreen() {
  const { t } = useTranslation();
  const view = useOpenClosing();

  if (view.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('closingHistory.title') }} />
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (view.isError || !view.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('closingHistory.title') }} />
        <ErrorState error={view.error} onRetry={() => void view.refetch()} />
      </Screen>
    );
  }
  return <Day day={view.data} onRefresh={() => void view.refetch()} refreshing={view.isRefetching} />;
}

function Day({ day, onRefresh, refreshing }: { day: OpenClosing; onRefresh: () => void; refreshing: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchName } = useBranch();
  const offline = !useConnectivity((s) => s.online);
  const canCount = usePermission('closing.count');
  const canClose = usePermission('closing.perform');
  const reopen = useReopenDay();
  const [sheet, setSheet] = useState(false);

  const standing = day.standing;
  const chipTone = standingTone(standing);
  const sinceTone = sinceLastCountTone(day.sinceLastCount);
  const dateWord = formatDate(`${day.businessDate}T00:00:00Z`);

  const confirmReopen = async (mode: ReopenMode) => {
    try {
      const fresh = await reopen.mutateAsync(mode);
      setSheet(false);
      toast.success(mode === 'start_new' ? t('reopen.started', { date: formatDate(`${day.nextDate}T00:00:00Z`) }) : t('reopen.done', { date: dateWord }));
      void fresh;
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

  const note =
    standing === 'reopened'
      ? t('closingHistory.reopened.note')
      : standing === 'closed'
        ? t('closingHistory.closed.note')
        : standing === 'needs_review'
          ? t('closingHistory.needsReview.note')
          : null;

  return (
    <Screen scroll gap="lg" onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ headerShown: true, title: t('closingHistory.title') }} />
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
            {t('closingHistory.lastCounted', { time: formatTime(day.lastCountedAt) })}
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

        {/* One action: count and close while the day is open; reopen once it is closed. */}
        {standing === 'closed' ? (
          canClose && day.canReopen ? (
            <Button title={t('closingHistory.reopen')} variant="secondary" fullWidth loading={reopen.isPending} disabled={offline || reopen.isPending} onPress={() => void onReopen()} />
          ) : null
        ) : canCount ? (
          <Button
            title={canClose ? t('closing.review') : t('closing.title')}
            fullWidth
            disabled={offline}
            onPress={() => router.push('/closing/count' as Href)}
          />
        ) : null}
        {!canClose && standing !== 'closed' ? (
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

      {/* ── The history ── */}
      <Section title={t('closingHistory.history')}>
        <Card style={styles.history}>
          {day.history.length === 0 ? (
            <Text variant="caption" tone="secondary">
              {t('closingHistory.history.empty')}
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
        choices={day.reopenChoices}
        busy={reopen.isPending}
        onConfirm={(mode) => void confirmReopen(mode)}
      />
    </Screen>
  );
}

/** A dot, what happened, when, and one line saying how much. */
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
      caption = t('closing.history.continues', { date: formatDate(entry.at) });
      break;
    case 'day_started_early':
      caption = t('reopen.started', { date: formatDate(entry.at) });
      break;
    case 'sale':
      caption =
        Number(p.owed ?? 0) > 0
          ? t('closing.history.saleOwed', { amount: money(p.total), owed: money(p.owed) })
          : t('closing.history.saleCash', { amount: money(p.cashIn ?? p.total) });
      break;
    default:
      caption = null;
  }
  return (
    <View style={[styles.row, !first && styles.rowJoin]}>
      <View style={[styles.dot, { backgroundColor: colors.semantic.primary }]} />
      <View style={styles.rowBody}>
        <View style={styles.between}>
          <Text variant="bodyStrong" style={styles.flex}>
            {`${t(historyKey(entry.kind) as never)}${entry.kind === 'sale' && p.item ? ` · ${String(p.item)}` : ''}`}
          </Text>
          <Text variant="body" tone="secondary">
            {formatTime(entry.at)}
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
