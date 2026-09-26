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
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Banknote, Lock, Smartphone } from 'lucide-react-native';
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
} from '../../components/ui';
import { useConnectivity } from '../../lib/connectivity';
import { useDailyReport } from '../../lib/closing-report';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { isolateLtr } from '../../lib/design/direction';
import { toFriendlyError } from '../../lib/errors';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { HeaderShownContext } from '../../lib/navigation/router-internals';
import { usePermission } from '../../lib/permissions';
import { useClosingReminders } from '../../lib/loans';
import {
  useOpenClosing,
  useRecordCount,
  type ChannelRow,
  type OpenClosing,
  type RecordCountBody,
} from '../../lib/closing';

/** A channel as the live view sends it: `stale` when its count predates a reopen. */
type CheckRow = ChannelRow & { stale?: boolean };

/**
 * "Check physical cash or account balance" (docs/51 D2) — optional.
 *
 * The Daily closing report already knows what was recorded; this is where a
 * person who wants to can count the drawer, or read an account's movement in
 * its app, and compare. A count stays a count, with its difference; nothing
 * here is required to close the day, and closing happens on the report, never
 * here. Counting records what is in front of you and locks nothing.
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

  if (view.isLoading) return <Loading title={t('closingCheck.title')} />;
  if (view.isError) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('closingCheck.title') }} />
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
  const headerShown = useContext(HeaderShownContext);

  /** The one channel the Daily closing asked to check (`cash`, or an account id): its field takes focus (docs/58). */
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  /*
    Whether the drawer's expected figure rests on a counted opening (docs/58 §1.2). The
    report already knows; it is read from the cache the person just came from. Without an
    anchor the figure is only the day's recorded movement from 0, and the row says so.
  */
  const report = useDailyReport();
  const cashAnchored: boolean | null = report.data ? report.data.expected.cash.opening.anchorDate !== null : null;
  const { mutate: recordCount } = useRecordCount();
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

  // No totals are added up here: the Daily closing report is the one place figures are summed, on the server.
  const errorText = error ? toFriendlyError(error).body || t('closing.count.failed') : null;
  const rows: CheckRow[] = day.channels;
  const last = rows.length - 1;

  const renderRow: ListRenderItem<CheckRow> = useCallback(
    ({ item, index }) => (
      <ChannelLine
        row={item}
        first={index === 0}
        last={index === last}
        disabled={!canCount || offline}
        saving={saving === rowKey(item)}
        focused={focus !== undefined && focus === (item.channel === 'cash' ? 'cash' : (item.accountId ?? ''))}
        cashAnchored={cashAnchored}
        onSubmit={submit}
      />
    ),
    [canCount, offline, saving, submit, last, focus, cashAnchored],
  );

  return (
    <SafeAreaView style={styles.safe} edges={headerShown ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('closingCheck.title') }} />
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
                <Text variant="label" tone="secondary">
                  {formatDate(day.date)}
                </Text>
                <Text variant="body" tone="secondary">
                  {t('closingCheck.intro')}
                </Text>
              </Card>

              <View style={styles.sectionHead}>
                <Text variant="heading" style={styles.flex}>
                  {t('closing.section.channels')}
                </Text>
              </View>
            </View>
          }
          ListFooterComponent={
            <View style={styles.footerContent}>
              <LoanReminders />
              <View style={styles.linkRow}>
                <Button
                  title={t('closing.differences.link')}
                  variant="tertiary"
                  size="sm"
                  onPress={() => router.push('/discrepancies' as never)}
                />
              </View>
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

        {/* Back to the report: closing happens there, never here, and nothing here is required. */}
        <View style={styles.footer} onLayout={measureFooter}>
          <Button title={t('closingCheck.back')} icon={ArrowLeft} variant="secondary" fullWidth onPress={() => router.back()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── One row of the list ─────────────────────────────────────────────────────

interface ChannelLineProps {
  row: CheckRow;
  first: boolean;
  last: boolean;
  disabled: boolean;
  saving: boolean;
  /** Asked for by name from the Daily closing: the field takes focus, and a saved count reopens for counting again. */
  focused?: boolean;
  /** Whether the drawer's expected figure rests on a counted opening; null while the report is not known. */
  cashAnchored?: boolean | null;
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
    a.row.stale === b.row.stale &&
    a.first === b.first &&
    a.last === b.last &&
    a.disabled === b.disabled &&
    a.saving === b.saving &&
    a.focused === b.focused &&
    a.cashAnchored === b.cashAnchored &&
    a.onSubmit === b.onSubmit
  );
}

const ChannelLine = memo(function ChannelLine({ row, first, last, disabled, saving, focused = false, cashAnchored = null, onSubmit }: ChannelLineProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  /** Counting again over a saved count — a count is corrected by a new count, never edited in place. */
  const [recounting, setRecounting] = useState(focused);

  const label =
    row.channel === 'cash'
      ? t('closing.channel.cash')
      : row.isUnattributed
        ? t('closing.channel.unattributed')
        : row.labelSnapshot;
  // A count from before a reopen proves nothing about the drawer now: it is offered for counting again.
  const settled = (row.counted !== null || row.isSkipped) && !row.stale && !recounting;
  const account = row.channel === 'account';
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
        {/* Status in a word as well as a colour, always. An account is checked against its app, never counted (docs/58 §1.2). */}
        {row.stale ? (
          <Chip tone="warning" label={t(account ? 'dailyReport.verify.account.stale' : 'dailyReport.verify.stale')} size="sm" dot />
        ) : row.isSkipped ? (
          <Chip tone="neutral" label={t('closing.channel.skipped')} size="sm" dot />
        ) : row.counted !== null ? (
          <Chip tone="success" label={t(account ? 'closing.channel.checked' : 'closing.channel.counted')} size="sm" dot />
        ) : row.countable ? (
          <Chip tone="warning" label={t(account ? 'closing.channel.unchecked' : 'closing.channel.outstanding')} size="sm" dot />
        ) : (
          <Chip tone="neutral" label={t('closing.channel.reportOnly')} size="sm" dot />
        )}
      </View>

      <View style={styles.rowMeta}>
        {/* The drawer: what should be in it — or, with no counted opening, only the day's recorded movement from 0. An account: its recorded movement. */}
        <Text variant="caption" tone="secondary">
          {account
            ? t('dailyReport.expected.account')
            : cashAnchored === null
              ? t('closing.expected')
              : cashAnchored
                ? t('closing.expected.drawer')
                : t('dailyReport.expected.movementFromZero')}
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
        <View style={styles.form}>
          <SettledLine row={row} />
          <View style={styles.linkRow}>
            <Button title={t(account ? 'closingCheck.recheck' : 'closingCheck.recount')} variant="tertiary" size="sm" disabled={disabled} onPress={() => setRecounting(true)} />
          </View>
        </View>
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
          {row.stale ? (
            <Text variant="caption" tone="secondary">
              {t(account ? 'closingCheck.stale.account' : 'closingCheck.stale')}
            </Text>
          ) : null}
          <View style={styles.countLine}>
            <MoneyField
              accessibilityLabel={row.channel === 'cash' ? t('closing.countedLabel') : t('closingCheck.accountPrompt')}
              placeholder={row.channel === 'cash' ? t('closing.countedLabel') : t('closingCheck.accountPrompt')}
              value={value}
              onChangeText={setValue}
              editable={!disabled && !saving}
              autoFocus={focused && !disabled}
              containerStyle={styles.flex}
            />
            {/* One explicit Save per row. Nothing is sent as you type. */}
            <Button
              title={t('closing.row.save')}
              disabled={disabled || saving || value.trim() === ''}
              loading={saving}
              onPress={() => {
                setRecounting(false);
                onSubmit({ ...body, counted: Number(value) });
              }}
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
  const account = row.channel === 'account';
  return (
    <View style={styles.settled}>
      <View style={styles.rowMeta}>
        {/* An account's figure is the movement its app showed, compared with the recorded movement — not a count, not a balance. */}
        <Text variant="caption" tone="secondary">
          {t(account ? 'dailyReport.account.counted' : 'closing.counted')}
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
          {t(account ? (difference < 0 ? 'closing.account.short' : 'closing.account.over') : difference < 0 ? 'closing.short' : 'closing.over')}
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
  // Not even fetched without `loan.view`: the server would refuse it (docs/51 §9.12).
  const reminders = useClosingReminders(canSee);

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
