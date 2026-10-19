import React from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, InlineNotice, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import type { IssuedInvitation } from '../../types/api';

/** A browser without a share sheet (most desktops) offers Copy alone, rather than a button that does nothing. */
const canShare = Platform.OS !== 'web' || typeof globalThis.navigator?.share === 'function';

/**
 * An employee's invitation reference, the one time it can be seen (D214).
 *
 * The server keeps only a hash of it, so this is the Owner's only chance to read it out, copy it or share it with
 * their own phone's share sheet — Dukan ERP itself sends the person nothing. Leaving this screen loses it for good;
 * a new invitation replaces it.
 */
export function InvitationReference({ name, invitation }: { name: string; invitation: IssuedInvitation }) {
  const { t } = useTranslation();

  const copy = async () => {
    try {
      const ok = await Clipboard.setStringAsync(invitation.reference);
      if (ok) toast.success(t('team.invite.copied'));
      else toast.error(t('settings.personalId.copyFailed'));
    } catch {
      toast.error(t('settings.personalId.copyFailed'));
    }
  };

  const share = () => {
    void Share.share({ message: t('team.invite.shareMessage', { reference: invitation.reference, open: invitation.link }) }).catch(() => undefined);
  };

  return (
    <View style={styles.block} testID="invitation-reference">
      <Text variant="label">{t('team.invite.title', { name })}</Text>
      <Text variant="title" selectable style={styles.reference} accessibilityLabel={invitation.reference.split('').join(' ')}>
        {invitation.reference}
      </Text>
      <Text variant="caption" tone="secondary">
        {t('team.invite.explain', { name })}
      </Text>
      <Text variant="caption" tone="secondary">
        {t('team.invite.expires', { date: formatDateTime(invitation.expiresAt) })}
      </Text>
      <View style={styles.actions}>
        <Button title={t('team.invite.copy')} variant="secondary" size="sm" onPress={() => void copy()} />
        {canShare ? <Button title={t('team.invite.share')} variant="secondary" size="sm" onPress={share} /> : null}
      </View>
      <InlineNotice tone="warning">{t('team.invite.once')}</InlineNotice>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  reference: { letterSpacing: 2 },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
});
