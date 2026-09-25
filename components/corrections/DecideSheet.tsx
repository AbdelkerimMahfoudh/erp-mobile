import React, { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, InlineNotice, MoneyValue, Text, TextField } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toFriendlyError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { pendingKey } from '../../lib/closing-report-view';
import { useDecideCorrection, type PendingCorrection } from '../../lib/closing-report';

/**
 * The Owner decides a request somebody else made (docs/51 §15): what it would do,
 * who asked and why. Approving is the moment anything moves; rejecting changes
 * nothing. A request another one already beat to the same record can only be
 * rejected, and says so.
 */
export function DecideSheet({ pending, date, onClose }: { pending: PendingCorrection; date?: string; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const decide = useDecideCorrection(date);
  const [note, setNote] = useState('');

  const run = async (decision: 'approve' | 'reject') => {
    try {
      await decide.mutateAsync({ id: pending.id, version: pending.version, decision, note: decision === 'reject' ? note.trim() || undefined : undefined });
      toast.success(decision === 'approve' ? t('correctTx.done') : t('correctTx.pending.rejected'));
      onClose();
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('correctTx.failed'));
    }
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t(pendingKey(pending) as never)}
      subtitle={pending.label ?? undefined}
      footer={
        <View style={styles.footer}>
          <Button title={t('correctTx.pending.reject')} variant="secondary" fullWidth loading={decide.isPending && decide.variables?.decision === 'reject'} disabled={decide.isPending} onPress={() => void run('reject')} />
          <Button
            title={t('correctTx.pending.approve')}
            fullWidth
            loading={decide.isPending && decide.variables?.decision === 'approve'}
            disabled={decide.isPending || pending.superseded}
            onPress={() => void run('approve')}
          />
        </View>
      }
    >
      <View style={styles.sheet}>
        <MoneyValue value={pending.amount} size="large" />
        <Text variant="body">{pending.reason}</Text>
        <Text variant="caption" tone="secondary">
          {t('correctTx.pending.askedBy', { name: pending.requestedBy ?? '—', time: formatDateTime(new Date(pending.requestedAt)) })}
        </Text>
        {pending.superseded ? <InlineNotice tone="warning">{t('correctTx.pending.superseded')}</InlineNotice> : null}
        <TextField label={t('correctTx.pending.note')} value={note} onChangeText={setNote} placeholder={t('correctTx.pending.note.placeholder')} maxLength={255} />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  sheet: { gap: space.md, paddingVertical: space.sm },
  footer: { gap: space.sm },
}));
