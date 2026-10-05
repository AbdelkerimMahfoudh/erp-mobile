import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Chip, InlineNotice, Text } from '../ui';
import { ApiError, api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { TeamUser } from '../../types/api';

/**
 * An account that waits to be activated (docs/21, 2026-10-05).
 *
 * Everything here is the server's own statement: which contact is still to be
 * proven, whether a seat is held or still waits for the platform, and the two
 * things the Owner can do about it — send the code again, or withdraw the
 * account. No code is ever shown, no price is ever named, and nothing on this
 * panel switches the account on: only the server does, once every condition
 * holds.
 */
export function PendingPanel({ user, onCancelled }: { user: TeamUser; onCancelled: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pending = user.pending;

  const resend = useMutation({
    mutationFn: (channel: 'email' | 'phone') => api.post(`/users/${user.id}/resend-verification`, { channel }),
    onSuccess: () => toast.success(t('team.pending.resent')),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'delivery_unavailable') {
        toast.warning(t('team.pending.delivery.unavailable'));
        return;
      }
      toast.error(toFriendlyError(error).body);
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/cancel-invitation`),
    onSuccess: () => {
      queryClient.setQueryData<TeamUser[]>(qk.users, (list) => (list ? list.filter((u) => u.id !== user.id) : list));
      void queryClient.invalidateQueries({ queryKey: qk.users });
      toast.success(t('team.pending.cancelled'));
      onCancelled();
    },
    onError: (error) => toast.error(toFriendlyError(error).body),
  });

  const confirmCancel = async () => {
    const ok = await dialog.confirm({
      title: t('team.pending.cancelConfirm.title'),
      message: t('team.pending.cancelConfirm.body', { name: user.name }),
      confirmLabel: t('team.pending.cancel'),
      tone: 'danger',
    });
    if (ok) cancel.mutate();
  };

  if (!pending) return null;

  const contactRow = (channel: 'email' | 'phone', value: string | null, state: 'verified' | 'awaiting' | 'not_selected') => {
    if (state === 'not_selected' || !value) return null;
    return (
      <View style={styles.contact} key={channel}>
        <View style={styles.contactText}>
          <Text variant="body">{value}</Text>
          <Chip tone={state === 'verified' ? 'success' : 'warning'} label={state === 'verified' ? t('team.pending.contact.verified') : t('team.pending.contact.awaiting')} />
        </View>
        {state === 'awaiting' ? (
          <Button title={t('team.pending.resend')} variant="secondary" size="sm" loading={resend.isPending} onPress={() => resend.mutate(channel)} />
        ) : null}
      </View>
    );
  };

  return (
    <InlineNotice tone="info" title={t('team.pending.title')}>
      <View style={styles.panel}>
        <Text variant="caption" tone="secondary">
          {t('team.pending.explain')}
        </Text>
        {contactRow('phone', user.phone, pending.phone)}
        {contactRow('email', user.email, pending.email)}
        {pending.seats.map((s) => (
          <Text key={s.branchId} variant="caption" tone="secondary">
            {s.state === 'awaiting_payment'
              ? t('team.pending.seat.awaiting', { branch: s.branchName })
              : s.state === 'held'
                ? t('team.pending.seat.held', { branch: s.branchName })
                : t('team.pending.seat.included', { branch: s.branchName })}
          </Text>
        ))}
        <Button title={t('team.pending.cancel')} variant="tertiary" size="sm" loading={cancel.isPending} onPress={() => void confirmCancel()} />
      </View>
    </InlineNotice>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.sm, marginTop: space.xs },
  contact: { gap: space.xs },
  contactText: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
