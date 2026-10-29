import React, { useCallback, useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorState, InlineNotice, PageIntro, Screen, SegmentedControl, Text } from '../components/ui';
import { api } from '../lib/api-client';
import { dialog } from '../lib/dialog';
import { LANGUAGE_LABELS, LANGUAGES, translateIn, useTranslation, type Language } from '../lib/i18n';
import { makeStyles } from '../lib/design/theme';
import { space } from '../lib/design/tokens';
import { toast } from '../lib/toast';
import type { ReferralInvitation } from '../types/api';

/** A browser without a share sheet (most desktops) offers Copy alone, rather than a button that does nothing. */
const canShare = Platform.OS !== 'web' || typeof globalThis.navigator?.share === 'function';

/**
 * Invite someone to Dukan ERP (0103, D221): a shop owner the person knows, to create their own business.
 *
 * Not "Add team member" — that is Team — and not the employee's invitation reference, the Owner's setup code or a
 * promoter's code. Every signed-in Owner, Manager and Employee may invite. Choose the language the message is written
 * in; see it as it will be sent; share it with the phone's own share sheet (or the browser's, or copy it). Dukan ERP
 * sends nothing: no WhatsApp message, no contact read, no recipient recorded.
 *
 * The address in the message is the person's own invitation for that language — one at a time, made on first use and
 * the same afterwards — and a business registered through it is recorded as coming from this business. It can be
 * stopped; sharing again then makes a new one. Nothing is counted or promised to the person who invites.
 */
export default function InviteScreen() {
  const { t, language } = useTranslation();
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [messageLanguage, setMessageLanguage] = useState<Language>(language);

  const invitation = useQuery({
    queryKey: ['referral-invitation', messageLanguage],
    queryFn: () => api.post<ReferralInvitation>('/referral-invitations', { language: messageLanguage }),
    staleTime: Infinity,
  });

  const message = invitation.data ? translateIn(messageLanguage, 'invite.message', { address: invitation.data.link }) : null;

  const share = useCallback(() => {
    if (!message) return;
    void Share.share({ message }).catch(() => undefined);
  }, [message]);

  const copy = useCallback(async () => {
    if (!message) return;
    try {
      if (await Clipboard.setStringAsync(message)) toast.success(t('invite.copied'));
      else toast.error(t('settings.personalId.copyFailed'));
    } catch {
      toast.error(t('settings.personalId.copyFailed'));
    }
  }, [message, t]);

  const stop = useMutation({
    mutationFn: (id: string) => api.post(`/referral-invitations/${id}/revoke`, {}),
    onSuccess: () => {
      toast.success(t('invite.stopped'));
      void queryClient.invalidateQueries({ queryKey: ['referral-invitation'] });
    },
  });

  const confirmStop = async () => {
    if (!invitation.data) return;
    const ok = await dialog.confirm({
      title: t('invite.stop.title'),
      message: t('invite.stop.body'),
      confirmLabel: t('invite.stop.confirm'),
      cancelLabel: t('action.cancel'),
      tone: 'danger',
    });
    if (ok) stop.mutate(invitation.data.id);
  };

  return (
    <Screen gap="xl">
      <Stack.Screen options={{ headerShown: true, title: t('nav.invite') }} />
      <PageIntro description={t('invite.subtitle')} />
      <InlineNotice tone="neutral">{t('invite.notTeam')}</InlineNotice>

      <View style={styles.block}>
        <Text variant="label">{t('invite.language')}</Text>
        <SegmentedControl
          options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }))}
          value={messageLanguage}
          onChange={setMessageLanguage}
        />
      </View>

      <Card padding="lg" style={styles.block}>
        <Text variant="label">{t('invite.preview')}</Text>
        {invitation.isLoading ? (
          <Text variant="body" tone="secondary">
            {t('invite.preparing')}
          </Text>
        ) : invitation.isError ? (
          <ErrorState error={invitation.error} onRetry={() => void invitation.refetch()} size="inline" />
        ) : message ? (
          // The message as its reader will see it: in its own language and direction, whatever the app's.
          <Text variant="body" selectable style={messageLanguage === 'ar' ? styles.rtl : styles.ltr} testID="invite-message">
            {message}
          </Text>
        ) : null}
      </Card>

      <View style={styles.block}>
        {canShare ? <Button title={t('invite.share')} onPress={share} disabled={!message} /> : null}
        <Button title={t('invite.copy')} variant={canShare ? 'secondary' : 'primary'} onPress={() => void copy()} disabled={!message} />
        {invitation.data ? (
          <Button title={t('invite.stop')} variant="tertiary" onPress={() => void confirmStop()} loading={stop.isPending} disabled={stop.isPending} />
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm },
  rtl: { writingDirection: 'rtl' },
  ltr: { writingDirection: 'ltr' },
}));
