import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
import { canConfirmClose, channelLabel, verificationKey, verificationTone, warningKey, type Freshness } from '../../lib/closing-report-view';
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
  // Each opening starts on the question with nothing typed — reset while rendering the opening, so the last step never flashes.
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setStep('ask');
      setValues({});
      setChanging({});
    }
  }
  // A fresh key each time the popup opens; the same key for every retry while it is open.
  const clientUuid = useMemo(() => (open ? uuidv4() : ''), [open]);
  // The confirmation signs what it shows: the day is read again as it opens, and Close waits for it.
  useEffect(() => {
    if (open && step === 'confirm') onChanged();
    // `onChanged` is a new function on every render of the page; the re-read belongs to the step, not to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const words = { cash: t('closing.channel.cash'), unattributed: t('closing.channel.unattributed') };
  const cashUnanchored = report.expected.cash.opening.anchorDate === null;
  /** The countable channels, as the live view has them — the drawer first. */
  const rows = (day?.channels ?? []).filter((c) => c.countable && !c.isUnattributed);
  type Row = (typeof rows)[number];
  const rowKey = (c: Row) => `${c.channel}:${c.accountId ?? 'NONE'}`;
  /** What the server holds: a count made since the last reopen. */
  const hasCount = (c: Row) => c.counted !== null && !c.stale;
  const editing = (c: Row) => !hasCount(c) || !!changing[rowKey(c)];
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
    held === 0;
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
          // The report's version follows the counts: read it again before confirming.
          onChanged();
        },
        onError: (e) => toast.error(toFriendlyError(e).body || t('closing.count.failed')),
      },
    );
  };
  /** Back to the question: nothing typed is carried to a step that would not save it. */
  const backToQuestion = () => {
    setValues({});
    setChanging({});
    setStep('ask');
  };

  const confirm = async () => {
    if (held > 0) return;
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
      if (e instanceof ApiError && e.status === 409 && e.code === 'report_changed') {
        toast.error(t('closeReview.changed'));
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
        </View>
      ) : step === 'count' ? (
        // Scrolls under the keyboard and at large text, its actions after the last channel: nothing pinned takes the room.
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
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
                    {/* Changing a saved count can be called off: the saved figure stays as it was. */}
                    {hasCount(c) ? (
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
                <FloatCountRow key={f.providerId} float={f} date={report.date} viewDate={date} editable={canCount && held === 0 && online} onSaved={onChanged} />
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
                  <Chip tone={verificationTone(shown, difference)} label={t(verificationKey(shown, account ? 'account' : 'cash') as never)} size="sm" dot />
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
                  <Chip
                    tone={f.counted === null && !f.isSkipped ? 'warning' : f.difference !== null && f.difference !== 0 ? 'warning' : f.isSkipped ? 'neutral' : 'success'}
                    label={floatStateWords(f, t)}
                    size="sm"
                    dot
                  />
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
