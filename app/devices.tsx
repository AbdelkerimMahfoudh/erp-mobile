import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react-native';
import { DeviceRow } from '../components/devices/DeviceRow';
import { EmptyState, ErrorState, PageIntro, RowGroup, Screen, SkeletonList, Text } from '../components/ui';
import { api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { dialog } from '../lib/dialog';
import { useAuth } from '../hooks/useAuth';
import type { UserDeviceView } from '../types/api';
import { lastSafeStep, readIntakeTrail, type TrailEntry } from '../lib/intake-trail';

/**
 * Security → Devices (F1 Stage 3).
 *
 * Shows where this account is signed in and lets the user cut a device off.
 * That is the whole scope: there is **no passcode control, no biometric switch
 * and no "send a code" button**, because none of those exist yet and a control
 * that does nothing is worse than no control.
 *
 * It is also careful about what it claims. A device trusted because someone
 * typed the right password is described exactly that way — never as "verified"
 * — since phone confirmation arrives in a later stage.
 */
export default function DevicesScreen() {
  const { t } = useTranslation();
  const header = <Stack.Screen options={{ headerShown: true, title: t('devices.title') }} />;
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  const devicesQuery = useQuery({
    queryKey: qk.devices,
    queryFn: () => api.get<UserDeviceView[]>('/devices'),
  });

  const revoke = useMutation({
    mutationFn: (deviceId: string) =>
      api.delete<{ wasCurrent: boolean }>(`/devices/${deviceId}`),
    onSuccess: async (result) => {
      if (result.wasCurrent) {
        // The session this app is using has just been revoked. Signing out
        // locally is the honest response — anything else leaves the app holding
        // a token the server will refuse on the next request.
        toast.success(t('devices.revokedCurrent'));
        await signOut();
        return;
      }
      toast.success(t('devices.revoked'));
      void queryClient.invalidateQueries({ queryKey: qk.devices });
    },
    onError: (error) => {
      // Offline included: the local credential is never touched here, so losing
      // the network cannot cost this installation its device identity.
      toast.error(toFriendlyError(error).body);
    },
  });

  const onRevoke = async (device: UserDeviceView) => {
    const ok = await dialog.confirm({
      title: t('devices.revoke.title'),
      message: device.isCurrent ? t('devices.revoke.bodyCurrent') : t('devices.revoke.body'),
      confirmLabel: t('devices.revoke.confirm'),
      cancelLabel: t('action.cancel'),
      tone: 'danger',
    });
    if (ok) revoke.mutate(device.id);
  };

  if (devicesQuery.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList count={3} />
      </Screen>
    );
  }

  if (devicesQuery.isError) {
    return (
      <Screen>
        {header}
        <ErrorState error={devicesQuery.error} onRetry={() => void devicesQuery.refetch()} />
      </Screen>
    );
  }

  const all = devicesQuery.data ?? [];
  const current = all.filter((d) => d.isCurrent && !d.revokedAt);
  const others = all.filter((d) => !d.isCurrent && !d.revokedAt);
  const removed = all.filter((d) => d.revokedAt);

  return (
    <Screen gap="xl">
      {header}
      <PageIntro description={t('devices.subtitle')} />

      {current.length > 0 ? (
        <View style={styles.list}>
          <Text variant="label">{t('devices.current')}</Text>
          {current.map((d) => (
            <DeviceRow key={d.id} device={d} onRevoke={() => void onRevoke(d)} />
          ))}
          <BuildIdentifier />
        </View>
      ) : null}

      <View style={styles.list}>
        <Text variant="label">{t('devices.section.other')}</Text>
        {others.length === 0 ? (
          <EmptyState icon={Smartphone} title={t('devices.empty')} body={t('devices.emptyBody')} />
        ) : (
          <RowGroup>
            {others.map((d) => (
              <DeviceRow key={d.id} device={d} onRevoke={() => void onRevoke(d)} />
            ))}
          </RowGroup>
        )}
      </View>

      {removed.length > 0 ? (
        <View style={styles.list}>
          <Text variant="label">{t('devices.section.removed')}</Text>
          <Text variant="caption" tone="tertiary">
            {t('devices.removedHint')}
          </Text>
          <RowGroup>
            {removed.map((d) => (
              <DeviceRow key={d.id} device={d} />
            ))}
          </RowGroup>
        </View>
      ) : null}

      {/* Said plainly, so nobody reads "signed in with a password" as "phone
          confirmed". */}
      <Text variant="caption" tone="tertiary">
        {t('devices.notVerifiedYet')}
      </Text>
      <IntakeTrail />
    </Screen>
  );
}

/**
 * The single-item intake's last steps on this phone (lib/intake-trail), in every build: what to read out when an
 * intake froze, since a freeze leaves no crash report. Step names and times only — nothing about the item.
 */
function IntakeTrail() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TrailEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void readIntakeTrail().then((read) => {
      if (live) setEntries(read);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!entries || entries.length === 0) return null;
  const time = (at: string) => at.replace('T', ' ').slice(5, 16) + 'Z';
  const safe = lastSafeStep(entries);
  return (
    <View style={styles.build} testID="intake-trail">
      <Text variant="caption" tone="tertiary">
        {t('devices.intake.title')}
      </Text>
      <Text variant="caption" tone="secondary" selectable>
        {entries.slice(-6).map((e) => `${time(e.at)} ${t(`devices.intake.step.${e.step}`)}`).join(' · ')}
      </Text>
      <Text variant="caption" tone="tertiary">
        {safe ? t('devices.intake.lastSafe', { when: time(safe.at) }) : t('devices.intake.noSafe')}
      </Text>
    </View>
  );
}

/**
 * The build this phone is running — development only.
 *
 * `extra.build` is stamped by `app.config.js` from the checkout Metro bundled
 * (the commit, its branch, whether files were changed, and when the
 * configuration was read); `executionEnvironment` says whether this is Expo Go,
 * the installed app or a bare build. It exists so a screenshot can prove which
 * source a phone is showing — the 6 Oct screenshots were of a bundle older than
 * the pushed commit, and nothing on screen could say so. A release build shows
 * nothing here: repository details are not for a shop's employees.
 */
function BuildIdentifier() {
  const { t } = useTranslation();
  if (!__DEV__) return null;
  const build = (Constants.expoConfig?.extra?.build ?? null) as { commit: string; branch: string; dirty: boolean; readAt: string } | null;
  const environment =
    Platform.OS === 'web'
      ? 'web'
      : Constants.executionEnvironment === ExecutionEnvironment.StoreClient
        ? 'Expo Go'
        : Constants.executionEnvironment === ExecutionEnvironment.Standalone
          ? 'standalone'
          : 'bare';
  const stamp = build ? `${build.commit}${build.dirty ? '+' : ''} · ${build.branch} · ${environment}` : `${t('devices.build.unknown')} · ${environment}`;
  return (
    <View style={styles.build} testID="build-identifier">
      <Text variant="caption" tone="tertiary">
        {t('devices.build.title')}
      </Text>
      <Text variant="caption" tone="secondary" selectable>
        {stamp}
      </Text>
      {build ? (
        <Text variant="caption" tone="tertiary">
          {t('devices.build.readAt', { when: build.readAt.replace('T', ' ').slice(0, 16) + 'Z' })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // A section's label, then its rows: related, so close — but never touching.
  list: { gap: space.sm },
  build: { marginTop: space.sm, gap: 2 },
});
