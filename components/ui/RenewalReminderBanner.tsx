import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, X } from 'lucide-react-native';
import { icon as iconSize, space } from '../../lib/design/tokens';
import { api } from '../../lib/api-client';
import { useConnectivity } from '../../lib/connectivity';
import { useTranslation } from '../../lib/i18n';
import { useAuth } from '../../hooks/useAuth';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/** The server's answer (`GET /me/renewal-reminder`): the days left it computed, and whether it was shown on a device. */
export interface RenewalReminder {
  id: string;
  days: 1 | 2 | 3;
  endsAt: string;
  timeZone: string;
  seen: boolean;
}

export const renewalReminderKey = ['renewal-reminder'] as const;

/** The sentence for a milestone: its own key per number, so each language words 3, 2 and 1 as it should. */
export const RENEWAL_KEYS = { 3: 'renewal.banner.3', 2: 'renewal.banner.2', 1: 'renewal.banner.1' } as const;

/**
 * The Owner's 3/2/1-day reminder before access ends (owner's brief, 2026-11-05), on every signed-in screen until it is
 * dismissed.
 *
 * - **The Owner only:** the server refuses anyone else, and nobody else asks.
 * - **The server's number:** the days left come from the server; nothing here counts them.
 * - **Once per milestone on every device:** dismissing it marks its notification read, and the server answers `seen`
 *   on every other phone of this Owner.
 * - **Offline: nothing.** A countdown that cannot be re-checked is not shown.
 * - **No link, no price, no way to pay:** the App Store boundary (`lib/navigation/no-browser.ts`) — the WhatsApp
 *   message and the Dukan ERP portal carry the renewal. The sentence says only when access ends.
 */
export function RenewalReminderBanner() {
  const styles = useStyles();
  const colors = useColors();
  const { user } = useAuth();
  const online = useConnectivity((s) => s.online);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const client = useQueryClient();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const owner = user?.account?.isOwner === true;

  const { data } = useQuery({
    queryKey: renewalReminderKey,
    queryFn: () => api.get<{ reminder: RenewalReminder | null }>('/me/renewal-reminder'),
    enabled: owner && online,
    staleTime: 30 * 60_000,
    retry: false,
  });
  const reminder = data?.reminder ?? null;
  if (!owner || !online || !reminder || reminder.seen || dismissed === reminder.id) return null;

  const label = t(RENEWAL_KEYS[reminder.days]);
  const dismiss = () => {
    setDismissed(reminder.id);
    // Read on the server: every other device of this Owner is told `seen`. A failure only means it may show again.
    void api
      .post(`/notifications/${reminder.id}/read`)
      .then(() => client.invalidateQueries({ queryKey: renewalReminderKey }))
      .catch(() => undefined);
  };
  // The status bar's inset belongs to the first strip shown.
  const top = !user?.isTestBusiness && !user?.actingOwner ? insets.top : 0;

  return (
    <View style={[styles.bar, { paddingTop: top + space.xs }]} testID="renewal-reminder">
      <CalendarClock size={iconSize.sm} color={colors.intent.warning.onSolid} />
      <Text variant="label" style={styles.text} numberOfLines={2} accessibilityRole="text">
        {label}
      </Text>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel={t('renewal.banner.dismiss')} hitSlop={12} testID="renewal-reminder-dismiss">
        <X size={iconSize.sm} color={colors.intent.warning.onSolid} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingBottom: space.xs,
    paddingHorizontal: space.md,
    backgroundColor: colors.intent.warning.solid,
  },
  text: {
    color: colors.intent.warning.onSolid,
    flexShrink: 1,
    textAlign: 'center',
  },
}));
