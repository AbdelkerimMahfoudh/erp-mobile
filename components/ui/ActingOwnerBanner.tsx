import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldCheck } from 'lucide-react-native';
import { icon as iconSize, space } from '../../lib/design/tokens';
import { useConnectivity } from '../../lib/connectivity';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useAuth } from '../../hooks/useAuth';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * "Acting as Owner until …" (D225), on every signed-in screen of the person appointed, in words and colour. It is the
 * server's answer (`/auth/me` `actingOwner`), so it shows exactly while the authority is in force — the server ends it
 * on time whatever this phone does.
 */
export function ActingOwnerBanner() {
  const styles = useStyles();
  const colors = useColors();
  const { user } = useAuth();
  const online = useConnectivity((s) => s.online);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const acting = user?.actingOwner;
  if (!acting) return null;
  const label = acting.until ? t('actingOwner.banner.until', { date: formatDateTime(acting.until) }) : t('actingOwner.banner.open');
  // The status bar's inset belongs to the first strip shown: the offline one, then the test-business one, then this.
  const top = online && !user?.isTestBusiness ? insets.top : 0;

  return (
    <View style={[styles.bar, { paddingTop: top + space.xs }]} accessible accessibilityRole="text" accessibilityLabel={label}>
      <ShieldCheck size={iconSize.sm} color={colors.intent.info.onSolid} />
      <Text variant="label" style={styles.text} numberOfLines={2}>
        {label}
      </Text>
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
    backgroundColor: colors.intent.info.solid,
  },
  text: {
    color: colors.intent.info.onSolid,
    flexShrink: 1,
    textAlign: 'center',
  },
}));
