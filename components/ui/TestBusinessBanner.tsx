import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlaskConical } from 'lucide-react-native';
import { icon as iconSize, space } from '../../lib/design/tokens';
import { useConnectivity } from '../../lib/connectivity';
import { useTranslation } from '../../lib/i18n';
import { useAuth } from '../../hooks/useAuth';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The persistent "this is a test business" strip (D217).
 *
 * The platform marks some businesses as test businesses: they run on the real service, so nothing else on a screen
 * tells them from a shop. This strip does, on every signed-in screen, in words and colour — never colour alone. It is
 * the server's flag (`/auth/me` `isTestBusiness`), never a guess, and renders nothing for any other business.
 *
 * Mounted beside the offline strip; when that one shows, it already holds the status bar's inset.
 */
export function TestBusinessBanner() {
  const styles = useStyles();
  const colors = useColors();
  const { user } = useAuth();
  const online = useConnectivity((s) => s.online);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (!user?.isTestBusiness) return null;
  // A pilot (D224) is a real store trying the product under a test business: "not a real shop" would be untrue there.
  const label = t(user.isPilotBusiness ? 'pilotBusiness.banner' : 'testBusiness.banner');

  return (
    <View style={[styles.bar, { paddingTop: (online ? insets.top : 0) + space.xs }]} accessible accessibilityRole="text" accessibilityLabel={label}>
      <FlaskConical size={iconSize.sm} color={colors.intent.warning.onSolid} />
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
    backgroundColor: colors.intent.warning.solid,
  },
  text: {
    color: colors.intent.warning.onSolid,
    flexShrink: 1,
    textAlign: 'center',
  },
}));
