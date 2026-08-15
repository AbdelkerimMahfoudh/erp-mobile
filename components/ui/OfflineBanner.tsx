import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { icon as iconSize, space } from '../../lib/design/tokens';
import { useConnectivity } from '../../lib/connectivity';
import { useTranslation } from '../../lib/i18n';
import { Text } from './Text';

/**
 * The persistent "you are not connected" strip.
 *
 * Deliberately not a toast. A toast says it once and leaves, which is exactly
 * wrong here: the condition lasts, and the consequence — nothing you confirm
 * will be recorded — lasts with it. It stays until the server answers again.
 *
 * Danger-toned rather than warning-toned. Losing the connection at a counter
 * means a sale cannot be completed and a closing cannot be filed; that is not a
 * caution, it is a stop.
 *
 * Renders nothing when online, so it can be mounted unconditionally at the app
 * root and no screen has to remember to include it.
 */
export function OfflineBanner() {
  const online = useConnectivity((s) => s.online);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (online) return null;

  return (
    <View
      /**
       * Absorbs the top inset itself. It sits above the screens' own
       * `SafeAreaView`, so without this the strip would run under the status
       * bar and the text would be half-hidden by the clock.
       */
      style={[styles.bar, { paddingTop: insets.top + space.sm }]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <WifiOff size={iconSize.sm} color={colors.intent.danger.onSolid} />
      <Text variant="label" style={styles.text} numberOfLines={2}>
        {t('state.offline.banner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.base,
    backgroundColor: colors.intent.danger.solid,
  },
  // `flexShrink` so long Arabic wraps to a second line instead of pushing the
  // icon off the edge of a narrow phone.
  text: { color: colors.intent.danger.onSolid, flexShrink: 1 },
});
