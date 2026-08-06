import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react-native';
import {
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SkeletonList,
  Text,
} from '../components/ui';
import { api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { toFriendlyError } from '../lib/errors';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import { toast } from '../lib/toast';
import { dialog } from '../lib/dialog';
import { useAuth } from '../hooks/useAuth';
import type { UserDeviceView } from '../types/api';

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
        <Text variant="title">{t('devices.title')}</Text>
        <SkeletonList count={3} />
      </Screen>
    );
  }

  if (devicesQuery.isError) {
    return (
      <Screen>
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
      <View>
        <Text variant="title">{t('devices.title')}</Text>
        <Text variant="caption" tone="secondary" style={styles.subtitle}>
          {t('devices.subtitle')}
        </Text>
      </View>

      {current.length > 0 ? (
        <View style={styles.list}>
          <Text variant="label">{t('devices.current')}</Text>
          {current.map((d) => (
            <DeviceRow key={d.id} device={d} onRevoke={() => void onRevoke(d)} />
          ))}
        </View>
      ) : null}

      <View style={styles.list}>
        <Text variant="label">{t('devices.section.other')}</Text>
        {others.length === 0 ? (
          <EmptyState icon={Smartphone} title={t('devices.empty')} body={t('devices.emptyBody')} />
        ) : (
          others.map((d) => (
            <DeviceRow key={d.id} device={d} onRevoke={() => void onRevoke(d)} />
          ))
        )}
      </View>

      {removed.length > 0 ? (
        <View style={styles.list}>
          <Text variant="label">{t('devices.section.removed')}</Text>
          <Text variant="caption" tone="tertiary">
            {t('devices.removedHint')}
          </Text>
          {removed.map((d) => (
            <DeviceRow key={d.id} device={d} />
          ))}
        </View>
      ) : null}

      {/* Said plainly, so nobody reads "signed in with a password" as "phone
          confirmed". */}
      <Text variant="caption" tone="tertiary">
        {t('devices.notVerifiedYet')}
      </Text>
    </Screen>
  );
}

/** One device. Status is carried by a word as well as a colour. */
function DeviceRow({ device, onRevoke }: { device: UserDeviceView; onRevoke?: () => void }) {
  const { t } = useTranslation();

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : null;

  const lastSeen = when(device.lastSeenAt);
  const subtitle = [
    device.model ?? device.platform ?? null,
    lastSeen ? t('devices.lastSeen', { when: lastSeen }) : t('devices.lastSeenNever'),
  ]
    .filter(Boolean)
    .join(' · ');

  const trust = t(`devices.trust.${device.trustMethod}` as never);

  return (
    <ListRow
      title={device.label ?? trust}
      subtitle={subtitle}
      leading={Smartphone}
      accessory={
        device.revokedAt ? (
          <Chip tone="danger" label={t('devices.status.revoked')} dot />
        ) : device.reverifyRequired ? (
          <Chip tone="warning" label={t('devices.status.reverify')} dot />
        ) : (
          <Chip tone="success" label={t('devices.status.active')} dot />
        )
      }
      onPress={onRevoke}
      chevron={false}
    />
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: space.xs },
  list: { gap: space.sm },
});
