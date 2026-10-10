import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, Chip, Divider, InlineNotice, MoneyField, MoneyValue, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { AMOUNT_LABEL, AMOUNT_ROW } from '../../lib/design/amount-row';
import { makeStyles } from '../../lib/design/theme';
import { isolateLtr } from '../../lib/design/direction';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { toFriendlyError } from '../../lib/errors';
import { ApiError } from '../../lib/api-client';
import { uuidv4 } from '../../lib/utils';
import { parseAmount } from '../../lib/price-input';
import {
  canConfirmClose,
  channelLabel,
  mergeMoved,
  movedAfterCount,
  movedFromData,
  movedSinceKeys,
  verificationKey,
  verificationTone,
  warningKey,
  withoutRecounted,
  type Freshness,
  type MovedAfterCount,
} from '../../lib/closing-report-view';
import { useBranch } from '../../lib/branch';
import { qk } from '../../lib/query-keys';
import { useCloseDay, type DailyReport } from '../../lib/closing-report';
import { useRecordCount, type OpenClosing } from '../../lib/closing';
import { useExchangesHeld } from '../../lib/agent';
import { floatsOutstanding } from '../../lib/agent-money';
import { useConnectivity } from '../../lib/connectivity';
import { FloatCountRow, floatStateWords } from './FloatCountRow';

/**
 * "Close the business day" (docs/58 D71; docs/51 D2, D5).
 *
 * One short popup in three steps. First the question — have you checked today's
 * cash and account movements? — with two ways on: *Enter the amounts*, a compact
 * count of the drawer and each account right here (each figure saved on its own,
 * nothing typed twice, no separate page), or *I've checked*, an attestation with
 * the person's name and the time and no amount. Then the confirmation: the day
 * in a few lines and, per channel, either its count or "Checked; amounts not
 * recorded" — never an invented figure, never "matched", never a difference of
 * 0. Physical checks stay optional.
 *
 * The close itself is the same contract: one idempotency key per opening of the
 * popup (a double tap or a retry replays the close already made), the report
 * version the person saw (figures that moved since are refused and re-read, and
 * the button waits while they are — the figures are read again as the
 * confirmation opens), and `attestChecked` for whatever has no amount. A typed
 * amount is never carried past quietly: Continue waits until it is saved or
 * cleared, and Back clears it; closing the popup discards it, as closing any
 * form does.
 *
 * On a branch with the money services counter (docs/73 §4.5) the amounts step
 * also asks for each provider float beside the drawer — what the provider's
 * app shows, or a skip with its reason — and the close waits until every float
 * is counted or skipped (the server's `float_count_required`); the person's
 * word covers the channels, never a float. And while this phone still holds an
 * exchange for the branch, the day is not closed at all: the exchange happened
 * at the counter and belongs to it (D155).
 *
 * Money that moved after counting began (D159) — a sale, an exchange, a
 * reversal or a rebalancing recorded after the drawer or a float was counted —
 * is never closed as a false difference: the close is refused, the report and
 * the live view are read again, *Money changed after counting began* names the
 * drawer and floats to count again and what was recorded since, and the person
 * is taken to the count step for those, each marked *Count again*. The close is
 * sent again only with the new report version, under the same key while the
 * popup stays open.
 */
export interface CloseDaySheetProps {
  open: boolean;
  onClose: () => void;
  report: DailyReport;
  /** The live view: the channels to count, with what was recorded and what was counted. */
  day: OpenClosing | null;
  freshness: Freshness;
  /** The report or the live view is being read again — the close waits for the figures it will sign. */
  refreshing: boolean;
  /** Whether this person may record counts; without it the popup offers only the attestation. */
  canCount: boolean;
  /** Refetch the report — after a count, whose figures the report's version follows. */
  onChanged: () => void;
}

type Step = 'ask' | 'count' | 'confirm';

export function CloseDaySheet({ open, onClose, report, day, freshness, refreshing, canCount, onChanged }: CloseDaySheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const date = report.isToday ? undefined : report.date;
  const close = useCloseDay(date);
  const { mutate: recordCount, isPending: saving } = useRecordCount(date);
  const online = useConnectivity((s) => s.online);
  // Exchanges this phone has not sent: the closing waits for them (D155).
  const held = useExchangesHeld();
  const floats = day?.floats ?? [];
  const floatsLeft = floatsOutstanding(floats);
  const [step, setStep] = useState<Step>('ask');
  const [values, setValues] = useState<Record<string, string>>({});
  const [changing, setChanging] = useState<Record<string, boolean>>({});
  // What a refused close said moved after its count (D159), what has been counted again since, and the version refused.
  const [moved, setMoved] = useState<MovedAfterCount | null>(null);
  const [recounted, setRecounted] = useState<{ channels: string[]; floats: string[] }>({ channels: [], floats: [] });
  const [refusedVersion, setRefusedVersion] = useState<string | null>(null);
  // Each opening starts on the question with nothing typed — reset while rendering the opening, so the last step never flashes.
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setStep('ask');
      setValues({});
      setChanging({});
      setMoved(null);
      setRecounted({ channels: [], floats: [] });
      setRefusedVersion(null);
    }
  }
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  // A fresh key each time the popup opens; the same key for every retry while it is open.
  const clientUuid = useMemo(() => (open ? uuidv4() : ''), [open]);
  // The confirmation signs what it shows: the day is read again as it opens, and Close waits for it.
  useEffect(() => {
    if (open && step === 'confirm') onChanged();
    // `onChanged` is a new function on every render of the page; the re-read belongs to the step, not to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const words = { cash: t('closing.channel.cash'), unattributed: t('closing.channel.unattributed') };
  // To count again: what the refusal named and is not counted again yet, and whatever the fresh figures still mark.
  const toRecount = mergeMoved(withoutRecounted(moved, recounted), movedFromData(report, day));
  const staleChannel = (key: string) => toRecount?.channels.some((c) => c.key === key) ?? false;
  const staleFloat = (providerId: string) => toRecount?.floats.some((f) => f.providerId === providerId) ?? false;
  const recountLeft = (toRecount?.channels.length ?? 0) + (toRecount?.floats.length ?? 0);
  const cashUnanchored = report.expected.cash.opening.anchorDate === null;
  /** The countable channels, as the live view has them — the drawer first. */
  const rows = (day?.channels ?? []).filter((c) => c.countable && !c.isUnattributed);
  type Row = (typeof rows)[number];
  const rowKey = (c: Row) => `${c.channel}:${c.accountId ?? 'NONE'}`;
  /** What the server holds: a count made since the last reopen. */
  const hasCount = (c: Row) => c.counted !== null && !c.stale;
  // A count money moved past is open to count again, without asking.
  const editing = (c: Row) => !hasCount(c) || !!changing[rowKey(c)] || staleChannel(rowKey(c));
  const typed = (c: Row) => (values[rowKey(c)] ?? '').trim();
  // A drawer holds nothing below zero; an account's net movement for the day can be (docs/51 §12.4).
  const amountOf = (c: Row, v: string) => parseAmount(v, { allowNegative: c.channel === 'account' });
  const withoutAmount = rows.filter((c) => !hasCount(c)).length;
  // Only with channels or floats to show: a live view that did not load offers the attestation alone, never an empty step.
  const countable = canCount && (rows.length > 0 || floats.length > 0);
  const unsaved = rows.some((c) => editing(c) && typed(c) !== '');
  const needsAttest = report.close?.requiresAcknowledgement ?? false;
  const enabled =
    canConfirmClose({
      canClose: report.close?.canClose ?? false,
      freshness,
      requiresAcknowledgement: needsAttest,
      attested: true,
      busy: close.isPending || refreshing,
    }) &&
    floatsLeft.length === 0 &&
    held === 0 &&
    // Never on a count money has moved past, and never again on the version the server refused.
    recountLeft === 0 &&
    report.reportVersion !== refusedVersion;
  const money = (v: number) => isolateLtr(formatMoney(v));
  const params = (p?: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, typeof v === 'number' && k !== 'count' && k !== 'days' ? money(v) : String(v)]));
  const warnings = report.warnings.filter((w) => w.severity !== 'info' && w.code !== 'channels_not_verified');

  const forget = (c: Row) => {
    setChanging((s) => ({ ...s, [rowKey(c)]: false }));
    setValues((s) => ({ ...s, [rowKey(c)]: '' }));
  };
  const save = (c: Row) => {
    const amount = amountOf(c, typed(c));
    if (!amount.ok) return;
    recordCount(
      { channel: c.channel, accountId: c.accountId ?? undefined, counted: amount.value },
      {
        onSuccess: () => {
          forget(c);
          setRecounted((r) => ({ ...r, channels: [...r.channels, rowKey(c)] }));
          // The report's version follows the counts: read it again before confirming.
          onChanged();
        },
        onError: (e) => {
          // Closed meanwhile (from another phone): nothing more to count here.
          if (e instanceof ApiError && e.status === 409 && e.code === 'already_closed') {
            toast.info(t('closeDay.alreadyClosed'));
            onChanged();
            onClose();
            return;
          }
          toast.error(toFriendlyError(e).body || t('closing.count.failed'));
        },
      },
    );
  };
  /** Back to the question: nothing typed is carried to a step that would not save it. */
  const backToQuestion = () => {
    setValues({});
    setChanging({});
    setStep('ask');
  };

  /** A float counted again: off the list of what money moved past, and the figures read again. */
  const floatSaved = (providerId: string) => {
    setRecounted((r) => ({ ...r, floats: [...r.floats, providerId] }));
    onChanged();
  };

  const confirm = async () => {
    if (held > 0 || recountLeft > 0) return;
    try {
      const done = await close.mutateAsync({
        date: report.date,
        clientUuid,
        reportVersion: report.reportVersion,
        ...(needsAttest ? { attestChecked: true } : {}),
      });
      toast.success(t('closeReview.done', { date: formatDate(done.date) }));
      onClose();
    } catch (e) {
      // Either way the day is read again (the close's own invalidation); the button waits for it.
      if (e instanceof ApiError && e.status === 409 && (e.code === 'report_changed' || e.code === 'money_moved_after_count')) {
        // The refusal carries the current report: shown at once, and only its version may be sent next (D159).
        const fresh = (e.body as { report?: DailyReport } | undefined)?.report;
        if (fresh && typeof fresh.reportVersion === 'string') qc.setQueryData(qk.dailyReport(branchId, date ?? 'today'), fresh);
        setRefusedVersion(report.reportVersion);
        onChanged();
        const found = movedAfterCount(e.body);
        if (!found) {
          toast.error(t('closeReview.changed'));
          return;
        }
        setMoved(found);
        setRecounted({ channels: [], floats: [] });
        toast.error(t('closing.moved.title'));
        // Straight to the count, for whoever counts: the drawer and floats to count again are open there.
        if (canCount && found.channels.length + found.floats.length > 0) setStep('count');
        return;
      }
      if (e instanceof ApiError && e.status === 409 && e.code === 'idempotency_conflict') {
        toast.info(t('closing.idempotencyConflict'));
        onChanged();
        onClose();
        return;
      }
      if (e instanceof ApiError && e.status === 409 && e.code === 'refresh_required') {
        toast.error(t('closing.refreshRequired'));
        onChanged();
        return;
      }
      if (e instanceof ApiError && e.status === 409 && e.code === 'already_closed') {
        toast.info(t('closeDay.alreadyClosed'));
        onClose();
        return;
      }
      // A float nobody counted or skipped: named, and the amounts step offered to whoever counts.
      if (e instanceof ApiError && e.status === 409 && e.code === 'float_count_required') {
        const names = ((e.body as { providers?: { label?: string }[] } | undefined)?.providers ?? []).map((p) => p.label ?? '').filter(Boolean);
        toast.error(t('closing.float.required', { names: names.join(' · ') }));
        if (canCount) setStep('count');
        return;
      }
      toast.error(toFriendlyError(e).body || t('closeReview.failed'));
    }
  };

  const title = t('dailyReport.closeDay');
  const recountNames = [
    ...(toRecount?.channels ?? []).map((c) => (c.key.startsWith('cash:') ? words.cash : c.label)),
    ...(toRecount?.floats ?? []).map((f) => t('agent.positions.float', { provider: f.label })),
  ];
  const since = toRecount ? movedSinceKeys(toRecount).map(({ key, count }) => t(key as never, { count })) : [];
  // Money changed after counting began: what to count again, what was recorded since, and who can count it.
  const movedNotice = toRecount ? (
    <InlineNotice tone="warning" title={t('closing.moved.title')} testID="closing-moved">
      {[
        recountNames.length > 0 ? t('closing.moved.recount', { names: recountNames.join(' · ') }) : null,
        since.length > 0 ? t('closing.moved.since', { list: since.join(', ') }) : null,
        recountLeft > 0 && !canCount ? t('closing.moved.noCount') : null,
      ]
        .filter(Boolean)
        .join(' ')}
    </InlineNotice>
  ) : null;
  const staleChip = <Chip tone="warning" label={t('closing.moved.stale')} size="sm" dot />;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={step === 'count' ? t('closeDay.enterAmounts') : title}
      titleLines={2}
      subtitle={formatDate(report.date)}
      footer={
        step === 'ask' ? (
          <View style={styles.footer}>
            {countable ? <Button title={t('closeDay.enterAmounts')} fullWidth disabled={held > 0} onPress={() => setStep('count')} /> : null}
            <Button title={t('closeDay.checked')} variant={countable ? 'secondary' : 'primary'} fullWidth disabled={held > 0} onPress={() => setStep('confirm')} />
            <Text variant="caption" tone="tertiary" align="center">
              {t('closeReview.selling')}
            </Text>
          </View>
        ) : step === 'count' ? (
          // The amount step pins nothing: with the keyboard up, the fields get the whole sheet (its actions scroll with them).
          undefined
        ) : (
          <View style={styles.footer}>
            {freshness === 'offline' ? (
              <Text variant="caption" tone="secondary" align="center">
                {t('closing.offline')}
              </Text>
            ) : freshness === 'stale' ? (
              <Text variant="caption" tone="secondary" align="center">
                {t('closeReview.stale')}
              </Text>
            ) : null}
            <Button title={title} fullWidth loading={close.isPending || refreshing} disabled={!enabled} onPress={() => void confirm()} />
            <Button title={t('closeDay.back')} variant="tertiary" size="sm" disabled={close.isPending} onPress={backToQuestion} />
          </View>
        )
      }
    >
      {step === 'ask' ? (
        <View style={styles.body}>
          <Text variant="heading">{t('closeDay.question')}</Text>
          {held > 0 ? <InlineNotice tone="warning">{t('closing.queue.body', { count: held })}</InlineNotice> : null}
          {movedNotice}
        </View>
      ) : step === 'count' ? (
        // Scrolls under the keyboard and at large text, its actions after the last channel: nothing pinned takes the room.
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {movedNotice}
          {rows.map((c) => {
            const key = rowKey(c);
            const account = c.channel === 'account';
            const label = channelLabel({ channel: c.channel, isUnattributed: c.isUnattributed, label: c.labelSnapshot }, words);
            const value = values[key] ?? '';
            const prompt = account ? t('closingCheck.accountPrompt') : t('closing.countedLabel');
            // Said once the figure cannot become valid by typing on: "-" or "." alone are an amount on its way.
            const parsed = amountOf(c, value);
            const invalid = !parsed.ok && parsed.reason === 'too_precise';
            return (
              <View key={key} style={styles.row}>
                <View style={styles.between}>
                  <Text variant="bodyStrong" style={styles.flex}>
                    {label}
                  </Text>
                  {staleChannel(key) ? staleChip : null}
                  <MoneyValue value={c.expected} size="small" />
                </View>
                <Text variant="caption" tone="tertiary">
                  {account ? t('dailyReport.expected.account') : cashUnanchored ? t('dailyReport.expected.movementFromZero') : t('closing.expected.drawer')}
                </Text>
                {hasCount(c) ? (
                  <Text variant="caption" tone="secondary">
                    {`${t(account ? 'dailyReport.account.counted' : 'closing.counted')} ${money(c.counted ?? 0)} · ${t('closing.difference')} ${isolateLtr(formatMoney(c.difference ?? 0, { signed: true }))}`}
                  </Text>
                ) : null}
                {!editing(c) ? (
                  <View style={styles.end}>
                    <Button title={t('closeDay.count.change')} accessibilityLabel={`${t('closeDay.count.change')}, ${label}`} variant="tertiary" size="sm" disabled={saving} onPress={() => setChanging((s) => ({ ...s, [key]: true }))} />
                  </View>
                ) : (
                  <>
                    <View style={styles.countLine}>
                      <MoneyField
                        // Each field says whose figure it takes: with two accounts, "Movement shown by the account app" alone is ambiguous.
                        accessibilityLabel={`${label}, ${prompt}`}
                        placeholder={prompt}
                        value={value}
                        onChangeText={(v) => setValues((s) => ({ ...s, [key]: v }))}
                        allowNegative={account}
                        error={invalid ? t('closeDay.count.invalid') : undefined}
                        editable={!saving}
                        containerStyle={styles.flex}
                      />
                      <Button title={t('closing.row.save')} accessibilityLabel={`${t('closing.row.save')}, ${label}`} size="sm" disabled={saving || !parsed.ok} loading={saving} onPress={() => save(c)} />
                    </View>
                    {/* Changing a saved count can be called off: the saved figure stays as it was — not one money moved past. */}
                    {hasCount(c) && !staleChannel(key) ? (
                      <View style={styles.end}>
                        <Button title={t('action.cancel')} accessibilityLabel={`${t('action.cancel')}, ${label}`} variant="tertiary" size="sm" disabled={saving} onPress={() => forget(c)} />
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
          {floats.length > 0 ? (
            <View style={styles.floats}>
              <Text variant="heading">{t('closing.floats.title')}</Text>
              <Text variant="caption" tone="tertiary">
                {t('closing.floats.explain')}
              </Text>
              {floats.map((f) => (
                <FloatCountRow
                  key={f.providerId}
                  float={f}
                  date={report.date}
                  viewDate={date}
                  editable={canCount && held === 0 && online}
                  stale={staleFloat(f.providerId)}
                  onSaved={() => floatSaved(f.providerId)}
                />
              ))}
            </View>
          ) : null}
          <View style={styles.footer}>
            {floatsLeft.length > 0 ? (
              <Text variant="caption" tone="secondary" align="center">
                {t('closing.floats.left', { count: floatsLeft.length })}
              </Text>
            ) : null}
            {unsaved ? (
              <Text variant="caption" tone="secondary" align="center">
                {t('closeDay.count.unsaved')}
              </Text>
            ) : withoutAmount > 0 ? (
              <Text variant="caption" tone="secondary" align="center">
                {t('closeDay.count.left', { count: String(withoutAmount) })}
              </Text>
            ) : null}
            <Button title={t('closeDay.count.continue')} fullWidth disabled={saving || unsaved} onPress={() => setStep('confirm')} />
            <Button title={t('closeDay.back')} variant="tertiary" size="sm" disabled={saving} onPress={backToQuestion} />
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {movedNotice}
          <View style={styles.lines}>
            {report.sales ? <Line label={t('closeReview.sales')} value={report.sales.value} /> : null}
            <Line label={t('closeReview.received')} value={report.money.totals.in} />
            <Line label={t('closeReview.paidOut')} value={report.money.totals.out} />
            <Divider />
            <Line label={t(cashUnanchored ? 'dailyReport.expected.movementFromZero' : 'closeReview.expected')} value={report.expected.cash.expected} strong />
            {report.result.status === 'ok' ? <Line label={t('closeReview.result')} value={report.result.resultAfterExpenses ?? 0} strong signed /> : null}
          </View>
          {warnings.map((w) => (
            <InlineNotice key={w.code} tone={w.severity === 'error' ? 'danger' : 'warning'}>
              {t(warningKey(w.code, w.params) as never, params(w.params))}
            </InlineNotice>
          ))}
          {/* Each channel as the close will record it: its count, or the attestation — words beside the colour, never "matched". */}
          <View style={styles.lines}>
            {(['cash:NONE', ...report.expected.accounts.filter((a) => a.accountId !== null).map((a) => a.key)] as const).map((key) => {
              const account = key !== 'cash:NONE';
              const v = key === 'cash:NONE' ? report.expected.cash.verification : (report.expected.accounts.find((a) => a.key === key)?.verification ?? 'not_counted');
              const label = key === 'cash:NONE' ? t('dailyReport.expected.cash') : (report.expected.accounts.find((a) => a.key === key)?.label ?? key);
              const difference = key === 'cash:NONE' ? report.expected.cash.difference : (report.expected.accounts.find((a) => a.key === key)?.difference ?? null);
              const shown = v === 'counted' ? v : 'attested';
              return (
                <View key={key} style={styles.between}>
                  <Text variant="body" style={styles.flex}>
                    {label}
                  </Text>
                  {staleChannel(key) ? (
                    staleChip
                  ) : (
                    <Chip tone={verificationTone(shown, difference)} label={t(verificationKey(shown, account ? 'account' : 'cash') as never)} size="sm" dot />
                  )}
                </View>
              );
            })}
            {needsAttest ? (
              <Text variant="caption" tone="secondary">
                {t('closeDay.attest.note')}
              </Text>
            ) : null}
          </View>
          {/* Each float as the close will hold it: counted (with its difference), skipped, or still waiting — never attested. */}
          {floats.length > 0 ? (
            <View style={styles.lines} testID="close-floats">
              {floats.map((f) => (
                <View key={f.providerId} style={styles.between}>
                  <Text variant="body" style={styles.flex}>
                    {t('agent.positions.float', { provider: f.label })}
                  </Text>
                  {staleFloat(f.providerId) ? (
                    staleChip
                  ) : (
                    <Chip
                      tone={f.counted === null && !f.isSkipped ? 'warning' : f.difference !== null && f.difference !== 0 ? 'warning' : f.isSkipped ? 'neutral' : 'success'}
                      label={floatStateWords(f, t)}
                      size="sm"
                      dot
                    />
                  )}
                </View>
              ))}
              {floatsLeft.length > 0 ? (
                <InlineNotice
                  tone="warning"
                  action={canCount ? <Button title={t('closing.floats.count')} variant="secondary" size="sm" disabled={held > 0} onPress={() => setStep('count')} /> : undefined}
                >
                  {t('closing.floats.waiting', { names: floatsLeft.map((f) => f.label).join(' · ') })}
                </InlineNotice>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

function Line({ label, value, strong, signed }: { label: string; value: number; strong?: boolean; signed?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'primary' : 'secondary'} style={styles.lineLabel}>
        {label}
      </Text>
      <MoneyValue value={value} size={strong ? 'default' : 'small'} signed={signed} tone={signed ? 'auto' : 'default'} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: space.md, paddingVertical: space.sm },
  lines: { gap: space.sm },
  row: { gap: space.xs },
  countLine: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  // The amount beside its words, or below them when it needs more than half the line (docs/61 §8).
  line: { ...AMOUNT_ROW, columnGap: space.sm },
  lineLabel: AMOUNT_LABEL,
  end: { flexDirection: 'row', justifyContent: 'flex-end' },
  flex: { flex: 1, minWidth: 0 },
  footer: { gap: space.sm },
  floats: { gap: space.md },
}));
