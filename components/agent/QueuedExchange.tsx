import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Chip, InlineNotice, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { isolateLtr } from '../../lib/design/direction';
import { formatDate, formatMoney, formatTime } from '../../lib/format';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { agentRefusal } from '../../lib/agent-rules';
import { exchangeOutcome } from '../../lib/agent-counter';
import { useConnectivity } from '../../lib/connectivity';
import { useQueue } from '../../lib/offline/queue';
import { mayCancel, mayRemove, type QueueItem } from '../../lib/offline/queue-rules';

/**
 * Where an exchange this phone confirmed stands (D155) — on the counter right
 * after Confirm, and on a queued row of the exchanges list:
 *
 *  - **Pending synchronization** while the server has not accepted it: never a
 *    time, never "recorded" — a provisional record is never shown as confirmed;
 *  - **Recorded**, with the server's own instant, business day and name, once
 *    it did;
 *  - **Needs your attention** when the server refused it by name: the refusal
 *    in the counter's own words (a newer rate, a closed store, a number it
 *    would not take …) and what can be done — prepare it again, try again, or
 *    cancel it. Nothing is re-sent on its own;
 *  - **Not confirmed yet** when an attempt may have been recorded (its answer
 *    was lost, or its key already holds a record): never "cancelled — nothing
 *    is sent"; it is checked again under the same key, or removed from this
 *    phone by a person who looked at the exchanges list.
 */
export function QueuedExchange({ item, onPrepareAgain }: { item: QueueItem; onPrepareAgain?: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const retry = useQueue((s) => s.retry);
  const cancel = useQueue((s) => s.cancel);
  const remove = useQueue((s) => s.remove);
  const router = useRouter();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const outcome = exchangeOutcome(item.state);

  if (outcome === 'recorded') {
    const r = item.result ?? {};
    return (
      <View style={styles.block} testID="exchange-recorded">
        <Chip tone="success" label={t('agent.outcome.recorded.title')} dot />
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
            {t('agent.outcome.recorded.commission', { amount: isolateLtr(formatMoney(r.commission, { decimals: Math.round(r.commission * 100) % 100 === 0 ? 0 : 2 })) })}
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

  // Cancelling is offered only while nothing is on its way: mid-flight the outcome is unknown (Milestone J).
  const cancelAction = mayCancel(item) ? (
    confirmCancel ? (
      <Button title={t('agent.action.cancelConfirm')} size="sm" variant="danger" onPress={() => cancel(item.id)} />
    ) : (
      <Button title={t('agent.action.cancel')} size="sm" variant="tertiary" onPress={() => setConfirmCancel(true)} />
    )
  ) : null;

  // Taken off this phone only by a person who looked at what the server recorded.
  const removeAction = mayRemove(item) ? (
    confirmRemove ? (
      <Button title={t('agent.action.removeConfirm')} size="sm" variant="danger" onPress={() => remove(item.id)} />
    ) : (
      <Button title={t('agent.action.remove')} size="sm" variant="tertiary" onPress={() => setConfirmRemove(true)} />
    )
  ) : null;
  const seeList = <Button title={t('agent.outcome.list')} size="sm" variant="secondary" onPress={() => router.push('/agent-transactions')} />;

  // An attempt may have been recorded and nothing says otherwise yet: checked again under the same key, never twice.
  if (item.mayBeRecorded && item.lastError?.code !== 'idempotency_conflict' && item.state !== 'sending') {
    return (
      <View style={styles.block} testID="exchange-uncertain">
        <Chip tone="warning" label={t('agent.uncertain.title')} dot />
        <Text variant="caption" tone="secondary">
          {t('agent.outcome.uncertain.body')}
        </Text>
        <View style={styles.actions}>
          <Button title={t('agent.action.checkAgain')} size="sm" variant="secondary" disabled={!online} onPress={() => retry(item.id)} />
          {seeList}
          {removeAction}
        </View>
      </View>
    );
  }

  if (outcome === 'pending') {
    return (
      <View style={styles.block} testID="exchange-pending">
        <Chip tone="info" label={t('agent.pending')} dot />
        <Text variant="caption" tone="secondary">
          {item.state === 'sending' ? t('agent.outcome.sending') : t('agent.outcome.pending.body')}
        </Text>
        {cancelAction}
      </View>
    );
  }

  // Refused by name: the counter's words for the code, and the one thing that can help.
  const refusal = agentRefusal(item.lastError?.code);
  const words = refusal ? t(refusal.key as TranslationKey) : item.lastError ? t(`sync.reason.${item.lastError.kind}` as TranslationKey) : '';
  const action = refusal?.action ?? (item.lastError?.kind === 'permission_denied' ? 'cancel' : 'retry');
  return (
    <View style={styles.block} testID="exchange-attention">
      <InlineNotice tone="warning" title={t('agent.outcome.attention.title')}>
        {words}
      </InlineNotice>
      <View style={styles.actions}>
        {action === 'prepare_again' && onPrepareAgain ? <Button title={t('agent.action.prepareAgain')} size="sm" onPress={onPrepareAgain} /> : null}
        {action === 'retry' ? <Button title={t('action.retry')} size="sm" variant="secondary" disabled={!online} onPress={() => retry(item.id)} /> : null}
        {action === 'check_list' ? seeList : null}
        {cancelAction}
        {removeAction}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
