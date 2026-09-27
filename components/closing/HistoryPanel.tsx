import React, { useState } from 'react';
import { Pressable, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';
import { Card, Text } from '../ui';
import { duration, pressedOpacity, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useReduceMotionSetting } from '../../lib/design/use-reduce-motion';

/**
 * The Closing history as one rectangle (docs/58 D72): a header with the title,
 * the count and a chevron at the end edge; a tap slides the entries out from
 * beneath the header and back again — short, and none at all when the person
 * asked their phone for reduced motion (read as it is now, not as it was when
 * the app started). The entries are always the server's,
 * every earlier one kept, counts after a reopen included.
 */
export interface HistoryPanelProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

const SLIDE = 16;

export function HistoryPanel({ title, count, children }: HistoryPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const reduceMotion = useReduceMotionSetting();
  const [open, setOpen] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useSharedValue(0);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    progress.value = reduceMotion ? (next ? 1 : 0) : withTiming(next ? 1 : 0, { duration: duration.base, easing: Easing.out(Easing.cubic) });
  };
  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setContentHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  };

  // The body's height follows the reveal; the entries themselves slide up the last few points into place.
  const bodyStyle = useAnimatedStyle(() => ({ height: contentHeight * progress.value, opacity: progress.value }));
  const innerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (progress.value - 1) * SLIDE }] }));
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 180}deg` }] }));

  return (
    <Card padding="none">
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        // Both forms: React Native maps the aria prop on the phone, and react-native-web 0.21 reads only it.
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        // The count is part of the name a screen reader announces, as it is part of what the eye reads.
        accessibilityLabel={`${title}, ${count}`}
        style={({ pressed }) => [styles.head, pressed ? { opacity: pressedOpacity } : null]}
      >
        <Text variant="bodyStrong" style={styles.title}>
          {title}
        </Text>
        <Text variant="caption" tone="secondary">
          {String(count)}
        </Text>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={20} color={colors.text.tertiary} />
        </Animated.View>
      </Pressable>
      {/* Folded, the entries are still mounted (their height is what the reveal animates), so they are hidden from readers explicitly. */}
      <Animated.View style={[styles.body, bodyStyle]} aria-hidden={!open} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
        <Animated.View onLayout={onLayout} style={[styles.inner, innerStyle]}>
          {children}
        </Animated.View>
      </Animated.View>
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min + space.sm,
    paddingHorizontal: space.base,
    paddingVertical: space.sm,
  },
  title: { flex: 1 },
  body: { overflow: 'hidden' },
  inner: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.base, paddingBottom: space.sm, borderTopWidth: 1, borderTopColor: colors.border.subtle },
}));
