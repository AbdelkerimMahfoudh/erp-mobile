import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Loading skeletons.
 *
 * These replace spinners and — more importantly — replace rendering nothing.
 * A screen that shows its shape while loading feels faster than the same screen
 * that flashes blank, and it stops the layout jumping under a thumb that is
 * already moving toward a button.
 *
 * A skeleton should mirror the real content's geometry. If it doesn't, the
 * content will visibly reflow when it arrives, which is worse than a spinner.
 */

const PULSE_MIN = 0.45;
const PULSE_MAX = 1;
const PULSE_MS = 850;

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** `full` for avatars and circular thumbnails. */
  rounded?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 16, rounded = 'sm', style }: SkeletonProps) {
  const colors = useColors();
  const pulse = useSharedValue(PULSE_MAX);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(PULSE_MIN, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius[rounded], backgroundColor: colors.neutral[200] },
        animated,
        style,
      ]}
    />
  );
}

/** A paragraph of shimmering lines; the last is short, as real text is. */
export function SkeletonText({ lines = 2, style }: { lines?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: space.sm }, style]}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '55%' : '100%'} />
      ))}
    </View>
  );
}

/** Matches `ListRow`'s geometry: leading square, two lines, trailing value. */
export function SkeletonListRow() {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Skeleton width={40} height={40} rounded="md" />
      <View style={styles.rowBody}>
        <Skeleton height={14} width="62%" />
        <Skeleton height={11} width="38%" />
      </View>
      <Skeleton width={54} height={14} />
    </View>
  );
}

export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <View style={{ gap: space.sm }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListRow key={i} />
      ))}
    </View>
  );
}

/** Matches a stat tile: small label over a large number. */
export function SkeletonStat() {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Skeleton height={10} width="52%" />
      <Skeleton height={22} width="72%" />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  rowBody: {
    flex: 1,
    gap: space.sm,
  },
  stat: {
    flex: 1,
    gap: space.sm,
    padding: space.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
}));
