import React from 'react';
import { Pressable, View } from 'react-native';
import { Smartphone } from 'lucide-react-native';
import { Chip, Text } from '../ui';
import { usePressed } from '../ui/use-pressed';
import { makeStyles, useColors } from '../../lib/design/theme';
import { pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import type { UserDeviceView } from '../../types/api';

/**
 * One device. Status is carried by a word as well as a colour.
 *
 * Not a `ListRow`: there the accessory sits beside the title, so a long status compressed the device's name into single
 * letters on a narrow phone. Here each stands on its own line: the name has the whole width and wraps freely, because
 * the name is how the owner tells two devices apart; the status is a short label, and any longer explanation sits below.
 */
export function DeviceRow({ device, onRevoke }: { device: UserDeviceView; onRevoke?: () => void }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const colors = useColors();
  const { pressed, pressHandlers } = usePressed();

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);

  const lastSeen = when(device.lastSeenAt);
  const subtitle = [device.model ?? device.platform ?? null, lastSeen ? t('devices.lastSeen', { when: lastSeen }) : t('devices.lastSeenNever')]
    .filter(Boolean)
    .join(' · ');

  const name = device.label ?? t(`devices.trust.${device.trustMethod}` as never);
  const status = device.revokedAt
    ? ({ tone: 'danger', label: t('devices.status.revoked'), detail: null } as const)
    : device.reverifyRequired
      ? ({ tone: 'warning', label: t('devices.status.codeRequired'), detail: t('devices.status.codeRequiredDetail') } as const)
      : ({ tone: 'success', label: t('devices.status.active'), detail: null } as const);

  const body = (
    <View style={[styles.row, { backgroundColor: pressed ? colors.surface.hover : colors.surface.card }]}>
      <View style={styles.iconBadge}>
        <Smartphone color={colors.brand[600]} size={19} />
      </View>
      <View style={styles.text} testID="device-text">
        <Text variant="bodyStrong" testID="device-name">
          {name}
        </Text>
        <Text variant="caption" tone="tertiary">
          {subtitle}
        </Text>
        <Chip tone={status.tone} label={status.label} dot style={styles.status} />
        {status.detail ? (
          <Text variant="caption" tone="secondary" testID="device-status-detail">
            {status.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!onRevoke) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, status.label, status.detail].filter(Boolean).join(', ')}
      onPress={onRevoke}
      {...pressHandlers}
      style={pressed ? { opacity: pressedOpacity } : undefined}
    >
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    minHeight: touch.comfortable + space.sm,
    padding: space.md,
  },
  text: {
    flex: 1,
    flexDirection: 'column',
    gap: 1,
  },
  status: { marginTop: space.xs },
  iconBadge: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.intent.info.bg,
  },
}));
