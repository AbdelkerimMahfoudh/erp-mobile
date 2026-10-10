import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, MoneyValue, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { isolateLtr } from '../../lib/design/direction';
import { formatDate, formatMoney, formatTime } from '../../lib/format';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { exchangeOutcome, outcomeChip } from '../../lib/agent-counter';
import { directionRowKey } from '../../lib/agent-history';
import { useConnectivity } from '../../lib/connectivity';
import { isExchangePayload } from '../../lib/offline/agent-exchange';
import { refusalOf, resubmitAction } from '../../lib/offline/exchange-rules';
import { useQueue } from '../../lib/offline/queue';
import { mayCancel, mayRemove, type QueueItem } from '../../lib/offline/queue-rules';

/**
 * Where an exchange this phone confirmed stands (D155, D161) — on the counter
 * right after Confirm, on a held row of the exchanges list, and in the Sync
 * centre. Six states, each in words beside its colour:
 *
 *  - **Pending synchronization** while the server has not accepted it, and
 *    **Sending** on its way: never a time, never "recorded". Cancelled (asked
 *    twice) only while nothing may be recorded;
 *  - **Recorded**, with the server's own instant, business day, name and
 *    commission;
 *  - **Checking whether it was recorded** when an answer was lost: the phone
 *    asks the server under the same key — never sends it again blindly — and
 *    the person can ask again, or remove it (asked twice);
 *  - **Not recorded**, with the refusal in the counter's words and the action
 *    that fixes it — *Send again* (nothing about it was wrong), *Review and
 *    send* (the provider's terms changed), *Edit and send* (a field) — or
 *    remove it. Nothing rejected is sent again on its own;
 *  - **Not recorded here**: why, what to do, and the exchange's details to hand
 *    to a Manager — direction, amount, provider and the phone's time, never the
 *    full number — with the record already under its key when there is one;
 *    then removed from this phone (asked twice).
 */
export function QueuedExchange({ item, onPrepareAgain }: { item: QueueItem; onPrepareAgain?: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const retry = useQueue((s) => s.retry);
  const cancel = useQueue((s) => s.cancel);
  const remove = useQueue((s) => s.remove);
  const checkAgain = useQueue((s) => s.checkAgain);
  const checking = useQueue((s) => s.checking.includes(item.id));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const outcome = exchangeOutcome(item.state);
  const chip = outcomeChip(outcome);
  const stateChip = <Chip tone={chip.tone} label={t(chip.key as TranslationKey)} dot />;

  if (outcome === 'confirmed') {
    const r = item.result ?? {};
    return (
      <View style={styles.block} testID="exchange-recorded">
        {stateChip}
        {typeof r.recordedAt === 'string' && typeof r.businessDate === 'string' ? (
          <Text variant="body">
            {t('agent.outcome.recorded.body', {
              time: isolateLtr(formatTime(r.recordedAt)),
              date: formatDate(r.businessDate),
              name: String(r.recordedByName ?? ''),
            })}
          </Text>
        ) : null}
        {typeof r.commission === 'number' ? (
          <Text variant="caption" tone="secondary">
            {t('agent.outcome.recorded.commission', { amount: isolateLtr(money(r.commission)) })}
          </Text>
        ) : null}
      </View>
    );
  }

  if (outcome === 'cancelled') {
    return (
      <View style={styles.block}>
        <Chip tone="neutral" label={t(item.result?.removed ? 'agent.outcome.removed' : 'agent.outcome.cancelled')} dot />
      </View>
    );
  }

  // Cancelling is offered only while nothing may be recorded and nothing is on its way (Milestone J, D161).
  const cancelAction = mayCancel(item) ? (
    confirmCancel ? (
      <Button title={t('agent.action.cancelConfirm')} size="sm" variant="danger" onPress={() => cancel(item.id)} />
    ) : (
      <Button title={t('agent.action.cancel')} size="sm" variant="tertiary" onPress={() => setConfirmCancel(true)} />
    )
  ) : null;

  // Taken off this phone, asked twice: the server's list stays the record of what happened.
  const removeAction = mayRemove(item) ? (
    confirmRemove ? (
      <Button title={t('agent.action.removeConfirm')} size="sm" variant="danger" onPress={() => remove(item.id)} />
    ) : (
      <Button title={t('agent.action.remove')} size="sm" variant="tertiary" onPress={() => setConfirmRemove(true)} />
    )
  ) : null;

  if (outcome === 'pending' || outcome === 'synchronizing') {
    return (
      <View style={styles.block} testID="exchange-pending">
        {stateChip}
        <Text variant="caption" tone="secondary">
          {outcome === 'synchronizing' ? t('agent.outcome.sending') : t('agent.outcome.pending.body')}
        </Text>
        {outcome === 'pending' ? cancelAction : null}
      </View>
    );
  }

  if (outcome === 'uncertain') {
    const ask = async () => {
      setUnreachable(false);
      const answer = await checkAgain(item.id);
      setUnreachable(answer === 'unreachable');
    };
    return (
      <View style={styles.block} testID="exchange-uncertain">
        {stateChip}
        <Text variant="caption" tone="secondary">
          {t('agent.outcome.uncertain.body')}
        </Text>
        {checking ? (
          <Text variant="caption" tone="secondary">
            {t('agent.uncertain.checking')}
          </Text>
        ) : unreachable ? (
          <Text variant="caption" tone="warning">
            {t('agent.uncertain.unreachable')}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button title={t('agent.action.checkAgain')} size="sm" variant="secondary" loading={checking} disabled={!online || checking} onPress={() => void ask()} />
          {removeAction}
        </View>
      </View>
    );
  }

  // Refused by name: the counter's words for the code.
  const refusal = refusalOf(item.lastError);
  const words = refusal ? t(refusal.key as TranslationKey) : '';

  if (outcome === 'rejected_resubmit') {
    const action = resubmitAction(item);
    return (
      <View style={styles.block} testID="exchange-rejected-resubmit">
        {stateChip}
        <Text variant="body">{words}</Text>
        <View style={styles.actions}>
          {action === 'send_again' ? <Button title={t('agent.action.sendAgain')} size="sm" disabled={!online} onPress={() => retry(item.id)} /> : null}
          {action === 'review_and_send' && onPrepareAgain ? <Button title={t('agent.action.reviewAndSend')} size="sm" onPress={onPrepareAgain} /> : null}
          {action === 'edit_and_send' && onPrepareAgain ? <Button title={t('agent.action.editAndSend')} size="sm" onPress={onPrepareAgain} /> : null}
          {removeAction}
        </View>
      </View>
    );
  }

  // Not recorded here: why and what to do, then what to hand over — this exchange, and the record under its key.
  const other = item.serverRecord ?? null;
  return (
    <View style={styles.block} testID="exchange-rejected-reenter">
      {stateChip}
      <Text variant="body">{words}</Text>
      <View style={styles.details} testID="exchange-details">
        <Text variant="label" tone="secondary">
          {t('agent.rejected.details')}
        </Text>
        <Text variant="bodyStrong">{item.summary}</Text>
        {isExchangePayload(item.payload) ? (
          <Text variant="caption" tone="secondary">
            {t('agent.list.phoneTime', { time: isolateLtr(formatTime(item.payload.deviceRecordedAt)) })}
          </Text>
        ) : null}
      </View>
      {other && typeof other.direction === 'string' ? (
        <View style={styles.details} testID="exchange-other-record">
          <Text variant="label" tone="secondary">
            {t('agent.rejected.other')}
          </Text>
          <View style={styles.line}>
            <Text variant="bodyStrong" style={styles.grow}>
              {t(directionRowKey(other.direction as 'cash_in_credit_out' | 'cash_out_credit_in') as TranslationKey, { provider: String(other.providerLabel ?? '') })}
            </Text>
            {typeof other.amount === 'number' ? <MoneyValue value={other.amount} size="small" /> : null}
          </View>
          {typeof other.numberMasked === 'string' && other.numberMasked ? (
            <Text variant="caption" tone="secondary">
              {isolateLtr(other.numberMasked)}
            </Text>
          ) : null}
          {typeof other.recordedAt === 'string' && typeof other.businessDate === 'string' ? (
            <Text variant="caption" tone="secondary">
              {t('agent.outcome.recorded.body', {
                time: isolateLtr(formatTime(other.recordedAt)),
                date: formatDate(other.businessDate),
                name: String(other.recordedByName ?? ''),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.actions}>{removeAction}</View>
    </View>
  );
}

/** A commission or an amount as the server keeps it: whole when it is whole, to the cent when it is not. */
function money(value: number): string {
  return formatMoney(value, { decimals: Math.round(value * 100) % 100 === 0 ? 0 : 2 });
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  details: { gap: space.xs, alignSelf: 'stretch' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1, minWidth: 0 },
}));
