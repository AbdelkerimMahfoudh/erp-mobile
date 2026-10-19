import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Chip, InlineNotice, Text } from '../ui';
import { api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import type { IssuedInvitation, TeamInvitation, TeamUser } from '../../types/api';
import { InvitationReference } from './InvitationReference';

const INVITATION_LABEL = {
  none: 'team.pending.invitation.none',
  open: 'team.pending.invitation.open',
  code_requested: 'team.pending.invitation.code_requested',
  expired: 'team.pending.invitation.expired',
} as const;

const INVITATION_TONE: Record<TeamInvitation['state'], 'info' | 'success' | 'warning'> = {
  none: 'warning',
  open: 'info',
  code_requested: 'success',
  expired: 'warning',
};

/**
 * An account that waits to be activated (docs/21, 2026-10-05; D214).
 *
 * Everything here is the server's own statement: whether the WhatsApp number is
 * confirmed yet, where the person's invitation stands and until when, whether a
 * seat is held or still waits for the platform — and the two things the Owner
 * can do: issue a new invitation (the old one stops working, and its reference is
 * shown once), or withdraw the account. The original reference is never shown
 * again: the server cannot read it back. Nothing here sends the person anything,
 * and nothing switches the account on: only the server does, once every condition
 * holds.
 */
export function PendingPanel({ user, onCancelled }: { user: TeamUser; onCancelled: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pending = user.pending;
  // A new invitation's reference, held only while this panel is on screen.
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);

  const reinvite = useMutation({
    mutationFn: () => api.post<{ invitation: IssuedInvitation }>(`/users/${user.id}/invitation`),
    onSuccess: (r) => {
      setIssued(r.invitation);
      void queryClient.invalidateQueries({ queryKey: qk.users });
    },
    onError: (error) => toast.error(toFriendlyError(error).body),
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

  const confirmReinvite = async () => {
    // A live invitation is replaced on purpose only; one that never existed or expired is simply issued.
    const live = pending?.invitation.state === 'open' || pending?.invitation.state === 'code_requested';
    if (live) {
      const ok = await dialog.confirm({
        title: t('team.pending.invitation.newConfirm.title'),
        message: t('team.pending.invitation.newConfirm.body', { name: user.name }),
        confirmLabel: t('team.pending.invitation.new'),
      });
      if (!ok) return;
    }
    reinvite.mutate();
  };

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
  const invitation = pending.invitation;

  return (
    <InlineNotice tone="info" title={t('team.pending.title')}>
      <View style={styles.panel}>
        <Text variant="caption" tone="secondary">
          {t('team.pending.explain')}
        </Text>
        {user.phone ? (
          <View style={styles.row}>
            <Text variant="body">{user.phone}</Text>
            <Chip
              tone={pending.phone === 'verified' ? 'success' : 'warning'}
              label={pending.phone === 'verified' ? t('team.pending.contact.verified') : t('team.pending.contact.awaiting')}
            />
          </View>
        ) : null}
        {user.email ? (
          <Text variant="caption" tone="tertiary">
            {`${user.email} · ${t('team.pending.email.optional')}`}
          </Text>
        ) : null}
        {issued ? (
          <InvitationReference name={user.name} invitation={issued} />
        ) : (
          <View style={styles.row}>
            <Chip tone={INVITATION_TONE[invitation.state]} label={t(INVITATION_LABEL[invitation.state])} />
            {invitation.expiresAt && invitation.state !== 'expired' ? (
              <Text variant="caption" tone="secondary">
                {t('team.pending.invitation.until', { date: formatDateTime(invitation.expiresAt) })}
              </Text>
            ) : null}
          </View>
        )}
        {pending.seats.map((s) => (
          <Text key={s.branchId} variant="caption" tone="secondary">
            {s.state === 'awaiting_payment'
              ? t('team.pending.seat.awaiting', { branch: s.branchName })
              : s.state === 'held'
                ? t('team.pending.seat.held', { branch: s.branchName })
                : t('team.pending.seat.included', { branch: s.branchName })}
          </Text>
        ))}
        {issued ? null : (
          <Button title={t('team.pending.invitation.new')} variant="secondary" size="sm" loading={reinvite.isPending} onPress={() => void confirmReinvite()} />
        )}
        <Button title={t('team.pending.cancel')} variant="tertiary" size="sm" loading={cancel.isPending} onPress={() => void confirmCancel()} />
      </View>
    </InlineNotice>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.sm, marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
