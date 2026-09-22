import React, { memo, useCallback, useContext, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Banknote, Check, Lock, Smartphone } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../components/ui';
import { useConnectivity } from '../lib/connectivity';
import { radius, space } from '../lib/design/tokens';
import { makeStyles, useColors } from '../lib/design/theme';
import { isolateLtr } from '../lib/design/direction';
import { dialog } from '../lib/dialog';
import { toFriendlyError } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { HeaderShownContext } from '../lib/navigation/router-internals';
import { usePermission } from '../lib/permissions';
import { useClosingReminders } from '../lib/loans';
import {
  useOpenClosing,
  useRecordCount,
  useSignOffDay,
  type ChannelRow,
  type OpenClosing,
  type RecordCountBody,
} from '../lib/closing';

/**
 * The daily closing, counted one channel at a time (Milestone E).
 *
 * Counting records what is in front of you and locks nothing; signing off is
 * a distinct act by somebody accountable for the day. Nothing here blurs that.
 *
 * ## Why this screen does not use `Screen`
 *
 * `Screen` wraps its body in a full-screen keyboard-dismissal `Pressable`.
 * Fine for a form; on a list of twenty accounts each holding a text field it
 * is a JavaScript responder above every row, and a drag that begins on a
 * label or an amount is claimed by it before the native list can scroll. That
 * is the dead zone the handset showed. So this screen composes its own safe
 * area, keyboard avoidance and list, and nothing invisible sits above the rows:
 * the only things that answer a touch are the input and the buttons.
 *
 * ## Why one list, and rows that do not re-render each other
 *
 * The rows are a virtualised `FlatList` drawn as ONE bordered surface — a
 * shop with twenty accounts is a long day, not twenty cards. Each row is
 * memoised on the figures it shows, the submit handler never changes identity,
 * and the "saving" state names one row — so saving one count re-renders that
 * row and the summary, not the other nineteen.
 */
export default function ClosingScreen() {
  const { t } = useTranslation();
  const canCount = usePermission('closing.count');
  const view = useOpenClosing();

  if (view.isLoading) return <Loading title={t('closing.title')} />;
  if (view.isError) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('closing.title') }} />
        <ErrorState error={view.error} onRetry={() => void view.refetch()} />
      </Screen>
    );
  }

  const day = view.data!;
  if (day.isLocked) return <LockedDay day={day} />;
  return <CountingDay day={day} canCount={canCount} />;
}

// ── The open day ────────────────────────────────────────────────────────────

const rowKey = (c: Pick<ChannelRow, 'channel' | 'accountId'>) => `${c.channel}:${c.accountId ?? 'none'}`;

function CountingDay({ day, canCount }: { day: OpenClosing; canCount: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const offline = !useConnectivity((s) => s.online);
  const canSignOff = usePermission('closing.perform');
  const headerShown = useContext(HeaderShownContext);

  const { mutate: recordCount } = useRecordCount();
  const signOff = useSignOffDay();
  const [error, setError] = useState<unknown>(null);
  /** The one row being saved, by key — so the others are left alone. */
  const [saving, setSaving] = useState<string | null>(null);

  /*
   * Stable for the life of the screen: `mutate` is stable, and the error is
   * kept raw and worded at render time, so no translation function is closed
   * over. A handler that changed identity would defeat every row's memo.
   */
  const submit = useCallback(
    (body: RecordCountBody) => {
      setError(null);
      setSaving(rowKey({ channel: body.channel, accountId: body.accountId ?? null }));
      recordCount(body, {
        onError: (e) => setError(e),
        onSettled: () => setSaving(null),
      });
    },
    [recordCount],
  );

  /*
   * Measured, never assumed: the pinned footer's real height is what the list
   * reserves underneath, so the last row can always be scrolled clear of it
   * and of the keyboard.
   */
  const [footerHeight, setFooterHeight] = useState(0);
  const measureFooter = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setFooterHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  };

  // Sums of the server's own per-channel figures, for the one summary surface.
  const countable = day.channels.filter((c) => c.countable);
  const settled = countable.filter((c) => c.counted !== null);
  const expectedTotal = countable.reduce((s, c) => s + c.expected, 0);
  const countedTotal = settled.reduce((s, c) => s + (c.counted ?? 0), 0);
  const differenceTotal = settled.reduce((s, c) => s + (c.difference ?? 0), 0);
  const done = countable.filter((c) => c.counted !== null || c.isSkipped).length;
  const remaining = countable.length - done;

  const errorText = error ? toFriendlyError(error).body || t('closing.count.failed') : null;
  const rows = day.channels;
  const last = rows.length - 1;

  const renderRow: ListRenderItem<ChannelRow> = useCallback(
    ({ item, index }) => (
      <ChannelLine
        row={item}
        first={index === 0}
        last={index === last}
        disabled={!canCount || offline}
        saving={saving === rowKey(item)}
        onSubmit={submit}
      />
    ),
    [canCount, offline, saving, submit, last],
  );

  const review = async () => {
    const ok = await dialog.confirm({
      title: t('closing.review.title', { date: formatDate(day.date) }),
      message: t('closing.review.body', {
        expected: isolateLtr(formatMoney(expectedTotal)),
        counted: isolateLtr(formatMoney(countedTotal)),
        difference: isolateLtr(formatMoney(differenceTotal, { signed: true })),
      }),
      confirmLabel: t('closing.review.confirm'),
    });
    if (!ok) return;
    setError(null);
    signOff.mutate(undefined, {
      onSuccess: () => router.push('/analytics' as never),
      onError: (e) => setError(e),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={headerShown ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('closing.title') }} />
      <KeyboardAvoidingView
        style={styles.fill}
        // iOS only. Android's window already resizes for the keyboard.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={rows}
          keyExtractor={rowKey}
          renderItem={renderRow}
          ItemSeparatorComponent={RowSeparator}
          ListHeaderComponent={
            <View style={styles.header}>
              {offline ? <InlineNotice tone="warning">{t('closing.offline')}</InlineNotice> : null}
              {!canCount ? <InlineNotice tone="info">{t('closing.count.noPermission')}</InlineNotice> : null}
              {errorText ? <InlineNotice tone="danger">{errorText}</InlineNotice> : null}

              <Card style={styles.summary}>
                <View style={styles.summaryHead}>
                  <Text variant="label" tone="secondary">
                    {formatDate(day.date)}
                  </Text>
                  <Chip
                    tone={day.complete ? 'success' : 'warning'}
                    label={t('closing.summary.progress', { done: String(done), total: String(countable.length) })}
                    size="sm"
                    dot
                  />
                </View>
                <Text variant="caption" tone="secondary">
                  {t('closing.summary.expected')}
                </Text>
                <MoneyValue value={expectedTotal} size="large" />
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryCell}>
                    <Text variant="caption" tone="secondary">
                      {t('closing.summary.counted')}
                    </Text>
                    <MoneyValue value={countedTotal} size="small" />
                  </View>
                  <View style={styles.summaryCell}>
                    <Text variant="caption" tone="secondary">
                      {t('closing.summary.difference')}
                    </Text>
                    {/* Signed and sign-coloured: a shortage and a surplus are different problems. */}
                    <MoneyValue value={settled.length ? differenceTotal : null} size="small" tone="auto" signed />
                  </View>
                </View>
              </Card>

              <View style={styles.sectionHead}>
                <Text variant="heading" style={styles.flex}>
                  {t('closing.section.channels')}
                </Text>
                {remaining > 0 ? (
                  <Text variant="caption" tone="secondary">
                    {t('closing.progress.remaining', { count: String(remaining) })}
                  </Text>
                ) : null}
              </View>
            </View>
          }
          ListFooterComponent={
            <View style={styles.footerContent}>
              <LoanReminders />
              {canSignOff ? (
                <View style={styles.linkRow}>
                  <Button
                    title={t('closing.differences.link')}
                    variant="tertiary"
                    size="sm"
                    onPress={() => router.push('/discrepancies' as never)}
                  />
                </View>
              ) : (
                // Said, not hidden. Somebody who counted should know what
                // happens next and who does it.
                <Text variant="caption" tone="secondary">
                  {t('closing.signOff.notYours')}
                </Text>
              )}
            </View>
          }
          contentContainerStyle={[styles.content, { paddingBottom: footerHeight + space['3xl'] }]}
          /*
           * `handled` lets Save be pressed on the FIRST tap while the keyboard
           * is open, instead of the tap being spent closing it.
           */
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          // Rows hold text fields: never unmount one that may have focus.
          removeClippedSubviews={false}
          initialNumToRender={12}
          windowSize={7}
          showsVerticalScrollIndicator={false}
        />

        {canSignOff ? (
          <View style={styles.footer} onLayout={measureFooter}>
            {!day.complete ? (
              <Text variant="caption" tone="secondary" align="center">
                {t('closing.review.blocked')}
              </Text>
            ) : offline ? (
              <Text variant="caption" tone="secondary" align="center">
                {t('closing.offline')}
              </Text>
            ) : null}
            <Button
              title={t('closing.review')}
              icon={Check}
              fullWidth
              disabled={!day.complete || offline || signOff.isPending}
              loading={signOff.isPending}
              onPress={() => void review()}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── One row of the list ─────────────────────────────────────────────────────

interface ChannelLineProps {
  row: ChannelRow;
  first: boolean;
  last: boolean;
  disabled: boolean;
  saving: boolean;
  onSubmit: (body: RecordCountBody) => void;
}

/** Re-render only when what this row shows has changed — not because a neighbour was saved. */
function sameRow(a: ChannelLineProps, b: ChannelLineProps): boolean {
  return (
    a.row.counted === b.row.counted &&
    a.row.difference === b.row.difference &&
    a.row.isSkipped === b.row.isSkipped &&
    a.row.skipReason === b.row.skipReason &&
    a.row.expected === b.row.expected &&
    a.row.countable === b.row.countable &&
    a.row.isUnattributed === b.row.isUnattributed &&
    a.row.labelSnapshot === b.row.labelSnapshot &&
    a.first === b.first &&
    a.last === b.last &&
    a.disabled === b.disabled &&
    a.saving === b.saving &&
    a.onSubmit === b.onSubmit
  );
}

const ChannelLine = memo(function ChannelLine({ row, first, last, disabled, saving, onSubmit }: ChannelLineProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState('');

  const label =
    row.channel === 'cash'
      ? t('closing.channel.cash')
      : row.isUnattributed
        ? t('closing.channel.unattributed')
        : row.labelSnapshot;
  const settled = row.counted !== null || row.isSkipped;
  const Icon = row.channel === 'cash' ? Banknote : Smartphone;
  const body = { channel: row.channel, accountId: row.accountId ?? undefined } as const;

  return (
    <View style={[styles.row, first ? styles.rowFirst : null, last ? styles.rowLast : null]}>
      <View style={styles.rowHead}>
        <View style={styles.rowTitle}>
          <Icon size={18} color={colors.text.secondary} />
          <Text variant="bodyStrong" numberOfLines={2} style={styles.flex}>
            {label}
          </Text>
        </View>
        {/* Status in a word as well as a colour, always. */}
        {row.isSkipped ? (
          <Chip tone="neutral" label={t('closing.channel.skipped')} size="sm" dot />
        ) : row.counted !== null ? (
          <Chip tone="success" label={t('closing.channel.counted')} size="sm" dot />
        ) : row.countable ? (
          <Chip tone="warning" label={t('closing.channel.outstanding')} size="sm" dot />
        ) : (
          <Chip tone="neutral" label={t('closing.channel.reportOnly')} size="sm" dot />
        )}
      </View>

      <View style={styles.rowMeta}>
        <Text variant="caption" tone="secondary">
          {t('closing.expected')}
        </Text>
        <MoneyValue value={row.expected} size="small" />
      </View>

      {row.isUnattributed ? (
        // Reported, never counted: there is no account behind this money, so
        // there is no balance to compare a count against.
        <Text variant="caption" tone="secondary">
          {t('closing.channel.unattributed.why')}
        </Text>
      ) : settled ? (
        <SettledLine row={row} />
      ) : skipping ? (
        <View style={styles.form}>
          <TextField
            label={t('closing.skip.reason')}
            value={skipReason}
            onChangeText={setSkipReason}
            placeholder={t('closing.skip.reasonPlaceholder')}
          />
          <View style={styles.actions}>
            <Button title={t('action.cancel')} variant="tertiary" size="sm" onPress={() => setSkipping(false)} />
            <Button
              title={t('closing.skip.confirm')}
              size="sm"
              disabled={disabled || saving || skipReason.trim().length < 3}
              loading={saving}
              onPress={() => onSubmit({ ...body, skip: true, skipReason: skipReason.trim() })}
            />
          </View>
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.countLine}>
            <MoneyField
              accessibilityLabel={row.channel === 'cash' ? t('closing.countedLabel') : t('closing.countedBalance')}
              placeholder={row.channel === 'cash' ? t('closing.countedLabel') : t('closing.countedBalance')}
              value={value}
              onChangeText={setValue}
              editable={!disabled && !saving}
              containerStyle={styles.flex}
            />
            {/* One explicit Save per row. Nothing is sent as you type. */}
            <Button
              title={t('closing.row.save')}
              disabled={disabled || saving || value.trim() === ''}
              loading={saving}
              onPress={() => onSubmit({ ...body, counted: Number(value) })}
            />
          </View>
          {/*
            Skipping is offered for accounts only. The drawer is always in
            front of whoever is closing, so there is no honest reason to skip it.
          */}
          {row.channel === 'account' ? (
            <View style={styles.linkRow}>
              <Button title={t('closing.skip.action')} variant="tertiary" size="sm" onPress={() => setSkipping(true)} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}, sameRow);

/** A channel that has been settled, and by how much it was out. */
function SettledLine({ row }: { row: ChannelRow }) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (row.isSkipped) {
    return (
      <Text variant="caption" tone="secondary">
        {t('closing.skip.recorded', { reason: row.skipReason ?? '' })}
      </Text>
    );
  }
  const difference = row.difference ?? 0;
  return (
    <View style={styles.settled}>
      <View style={styles.rowMeta}>
        <Text variant="caption" tone="secondary">
          {t('closing.counted')}
        </Text>
        <MoneyValue value={row.counted ?? 0} size="small" />
      </View>
      <View style={styles.rowMeta}>
        <Text variant="caption" tone="secondary">
          {t('closing.difference')}
        </Text>
        <MoneyValue value={difference} size="small" tone="auto" signed />
      </View>
      {difference !== 0 ? (
        <Text variant="caption" tone="secondary">
          {t(difference < 0 ? 'closing.short' : 'closing.over')}
        </Text>
      ) : null}
    </View>
  );
}

function RowSeparator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

/**
 * Loans waiting for somebody, while the day is being closed (Milestone I).
 *
 * A nudge, and nothing more — it changes no figure the closing computes, and it
 * renders nothing at all when there is nothing to chase.
 */
function LoanReminders() {
  const styles = useStyles();
  const { t } = useTranslation();
  const canSee = usePermission('loan.view');
  const router = useRouter();
  const reminders = useClosingReminders();

  const r = reminders.data;
  if (!canSee || !r) return null;
  const nothing =
    r.proposalsNeedingAnswer === 0 && r.paymentsAwaitingConfirmation === 0 && r.balancesOutstanding === 0;
  if (nothing) return null;

  return (
    <Card variant="sunken" padding="md" style={styles.reminders}>
      <Text variant="label">{t('closing.loans.title')}</Text>
      {r.proposalsNeedingAnswer > 0 ? (
        <Text variant="caption">{t('closing.loans.answer', { count: String(r.proposalsNeedingAnswer) })}</Text>
      ) : null}
      {r.paymentsAwaitingConfirmation > 0 ? (
        <Text variant="caption">{t('closing.loans.confirm', { count: String(r.paymentsAwaitingConfirmation) })}</Text>
      ) : null}
      {r.balancesOutstanding > 0 ? (
        <Text variant="caption">
          {t('closing.loans.outstanding', {
            count: String(r.balancesOutstanding),
            amount: isolateLtr(formatMoney(r.totalOutstanding)),
          })}
        </Text>
      ) : null}
      {/* Read from the payload, so this line cannot keep claiming something the server stopped meaning. */}
      {!r.affectsExpectedCash ? (
        <Text variant="caption" tone="tertiary">
          {t('closing.loans.hint')}
        </Text>
      ) : null}
      <View style={styles.linkRow}>
        <Button title={t('nav.loans')} variant="tertiary" size="sm" onPress={() => router.push('/loans' as never)} />
      </View>
    </Card>
  );
}

// ── A day already signed off ────────────────────────────────────────────────

function LockedDay({ day }: { day: OpenClosing }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <Screen gap="base">
      <Stack.Screen options={{ headerShown: true, title: t('closing.title') }} />
      <View style={styles.doneHead}>
        <Lock size={32} />
        <Text variant="title">{t('closing.done.headline', { date: formatDate(day.date) })}</Text>
      </View>
      <InlineNotice tone="info">{t('closing.locked.body')}</InlineNotice>
      <Section title={t('closing.channels')}>
        <Card>
          {day.channels.map((c, i) => (
            <View key={rowKey(c)}>
              {i > 0 ? <Divider style={styles.divider} /> : null}
              <ChannelSummary channel={c} />
            </View>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}

function ChannelSummary({ channel }: { channel: ChannelRow }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const label =
    channel.channel === 'cash'
      ? t('closing.channel.cash')
      : channel.isUnattributed
        ? t('closing.channel.unattributed')
        : channel.labelSnapshot;
  return (
    <View>
      <View style={styles.rowMeta}>
        <Text variant="bodyStrong">{label}</Text>
        {channel.isSkipped ? (
          <Chip tone="neutral" label={t('closing.channel.skipped')} size="sm" dot />
        ) : channel.counted === null ? (
          <Chip tone="neutral" label={t('closing.channel.notCounted')} size="sm" dot />
        ) : (
          <MoneyValue value={channel.difference ?? 0} tone="auto" signed size="small" />
        )}
      </View>
      <View style={styles.rowMeta}>
        <Text variant="caption" tone="secondary">
          {t('closing.expected')}
        </Text>
        <MoneyValue value={channel.expected} size="small" />
      </View>
    </View>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title }} />
      <SkeletonList count={3} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.surface.canvas },
  fill: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: space.base },
  header: { gap: space.md, paddingBottom: space.md },
  summary: { gap: space.xs },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginBottom: space.xs },
  summaryGrid: { flexDirection: 'row', gap: space.base, marginTop: space.sm },
  summaryCell: { flex: 1, gap: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm, marginTop: space.xs },
  /*
   * The rows draw ONE surface between them: side edges on every row, the top
   * edge and radii on the first, the bottom on the last, a hairline between.
   */
  row: {
    backgroundColor: colors.surface.card,
    borderColor: colors.border.subtle,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: space.sm,
  },
  rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border.subtle, marginHorizontal: StyleSheet.hairlineWidth },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, minWidth: 0 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  form: { gap: space.xs },
  countLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  linkRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  settled: { gap: space.xs },
  footerContent: { gap: space.md, paddingTop: space.base },
  reminders: { gap: space.xs },
  footer: {
    backgroundColor: colors.surface.card,
    paddingHorizontal: space.base,
    paddingTop: space.md,
    paddingBottom: space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    gap: space.sm,
  },
  divider: { marginVertical: space.xs },
  doneHead: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
}));
