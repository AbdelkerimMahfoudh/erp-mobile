import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check } from 'lucide-react-native';
import { Button, ErrorState, InlineNotice, PageIntro, Screen, SkeletonList, Text } from '../components/ui';
import { PermissionExplainer } from '../components/permissions/PermissionExplainer';
import { api } from '../lib/api-client';
import { radius, space, touch } from '../lib/design/tokens';
import { makeStyles, useColors } from '../lib/design/theme';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { askPushPermission, pushPermission, registerThisPhone } from '../lib/push';
import { phoneState, type PushPermission } from '../lib/push-policy';
import { useAuth } from '../hooks/useAuth';
import type { NotificationLevel, NotificationPreference } from '../types/api';

const LEVELS: readonly NotificationLevel[] = ['all', 'important', 'approvals'];

/**
 * Notifications → Push alerts (D225): All activity, Important, or Approvals only. The choice belongs to the account and
 * follows the person to every phone. It decides what is pushed, never what may be seen: the notification centre
 * keeps every event the person may open, and their own actions are never pushed back to them.
 */
export default function NotificationSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.notificationPreference, queryFn: () => api.get<NotificationPreference>('/notifications/preferences') });
  const save = useMutation({
    mutationFn: (level: NotificationLevel) => api.put<NotificationPreference>('/notifications/preferences', { level }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(qk.notificationPreference, fresh);
      toast.success(t('notifications.level.saved'));
    },
    onError: (e) => toast.error(toFriendlyError(e).body),
  });
  const header = <Stack.Screen options={{ headerShown: true, title: t('notifications.level.title') }} />;

  if (query.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }
  const current = save.isPending && save.variables ? save.variables : query.data.level;

  return (
    <Screen gap="lg">
      {header}
      <PageIntro description={t('notifications.level.intro')} />
      <View accessibilityRole="radiogroup" style={styles.group}>
        {LEVELS.map((level) => {
          const selected = level === current;
          return (
            <Pressable
              key={level}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityLabel={`${t(`notifications.level.${level}` as const)}. ${t(`notifications.level.${level}.body` as const)}`}
              onPress={() => save.mutate(level)}
              style={[styles.option, selected ? styles.selected : null]}
            >
              <View style={styles.grow}>
                <Text variant="bodyStrong">{t(`notifications.level.${level}` as const)}</Text>
                <Text variant="caption" tone="secondary">
                  {t(`notifications.level.${level}.body` as const)}
                </Text>
              </View>
              {selected ? <Check color={colors.semantic.primary} size={22} /> : <View style={styles.box} />}
            </Pressable>
          );
        })}
      </View>
      {query.data.isDefault ? (
        <Text variant="caption" tone="secondary">
          {t('notifications.level.default')}
        </Text>
      ) : null}
      <ThisPhone />
    </Screen>
  );
}

/**
 * This phone (D225): whether alerts reach it. Turning them on is the person's own choice, here, at any time — the app
 * never asks by itself after "Not now". After iOS refused, only iOS Settings can turn them back on: the steps, and the
 * way to the app's page there.
 */
function ThisPhone() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const styles = useStyles();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  useEffect(() => {
    void pushPermission().then(setPermission);
  }, []);
  if (permission === null) return null;
  const state = phoneState(permission);
  if (state === 'on') return <InlineNotice tone="success">{t('push.phone.on')}</InlineNotice>;
  if (state === 'unsupported') return <InlineNotice tone="info">{t('notifications.level.thisPhone')}</InlineNotice>;
  if (state === 'settings') {
    return <PermissionExplainer icon={BellRing} title={t('push.phone.offTitle')} benefits={[]} denied onAllow={() => undefined} allowLabel="" deniedSteps={t('push.phone.settingsSteps')} />;
  }
  return (
    <View style={styles.group}>
      <Text variant="body" tone="secondary">
        {t('push.phone.off')}
      </Text>
      <Button
        title={t('push.offer.allow')}
        icon={BellRing}
        onPress={() =>
          void askPushPermission().then(async (p) => {
            setPermission(p);
            if (p === 'granted' && user) await registerThisPhone(user.id, language).catch(() => undefined);
          })
        }
        fullWidth
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  group: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.comfortable,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
  },
  selected: { borderWidth: 2, borderColor: colors.semantic.primary, backgroundColor: colors.semantic.primarySoft },
  grow: { flex: 1, gap: 2 },
  box: { width: 22, height: 22 },
}));
