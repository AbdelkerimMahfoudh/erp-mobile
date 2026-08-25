import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlaskConical } from 'lucide-react-native';
import { icon as iconSize, space, radius } from '../../lib/design/tokens';
import { isStagingBuild } from '../../constants/config';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * "This is not the real shop."
 *
 * A staging build looks exactly like a production one — same screens, same
 * data shapes, same confident numbers — and that is the danger. Somebody
 * testing a sale on staging and somebody making a sale in the shop see the
 * same interface, and the only thing standing between a test IMEI and a real
 * ledger is knowing which build is in your hand.
 *
 * So the strip is not subtle, and it does not go away. It is not a toast: the
 * condition lasts as long as the build does.
 *
 * In a production build {@link isStagingBuild} is false and this renders
 * nothing — no layout, no cost, nothing on the shopkeeper's screen. It can
 * therefore be mounted unconditionally at the app root, which is the point:
 * the label cannot be missing from a screen somebody forgot to add it to.
 *
 * Not translated, deliberately. It is addressed to whoever installed the test
 * build, not to the shop, and "staging" is the word they were given.
 */
export function StagingBanner() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!isStagingBuild()) return null;

  return (
    <View
      // Absorbs the top inset itself: it sits above the screens' own
      // `SafeAreaView`, so without this the text runs under the clock.
      style={[styles.bar, { paddingTop: insets.top + space.xs }]}
      accessible
      accessibilityRole="header"
    >
      <FlaskConical size={iconSize.sm} color={colors.intent.warning.onSolid} />
      <Text variant="label" style={styles.text} numberOfLines={1}>
        STAGING — test data only
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
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    backgroundColor: colors.intent.warning.solid,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  text: {
    color: colors.intent.warning.onSolid,
    letterSpacing: 0.5,
  },
}));
