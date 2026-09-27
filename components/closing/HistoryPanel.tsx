import React, { useState } from 'react';
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';
import { Card, Text } from '../ui';
import { duration, pressedOpacity, radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { layoutIsRTL } from '../../lib/design/layout-direction';
import { useReduceMotionSetting } from '../../lib/design/use-reduce-motion';

/**
 * The Closing history as one rectangle (docs/58 D72, D75): a purple header across
 * the card with the title and the number of events centred on it, and a large
 * chevron fixed at the right edge — in Arabic too, so it never changes sides
 * while the entries open. A tap slides the entries out from beneath the header
 * and back again — short, and none at all when the person asked their phone for
 * reduced motion (read as it is now, not as it was when the app started). The
 * entries are always the server's, every earlier one kept, counts after a
 * reopen included.
 */
export interface HistoryPanelProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

const SLIDE = 16;
const CHEVRON = 28;

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
  // The physical right edge in both directions. Native mirrors in right-to-left — it swaps left/right and maps
  // start/end to the reading direction — so there it is `start` in Arabic and `end` otherwise. The web mirrors
  // through the document's `dir` only, and react-native-web resolves start/end as if left-to-right, so there it
  // is the physical `right` in every language.
  const rightEdge = Platform.OS === 'web' ? { right: space.base } : layoutIsRTL() ? { start: space.base } : { end: space.base };
  // The info intent's solid: the brand purple in both themes, white on it (6.5 : 1).
  const purple = colors.intent.info.solid;
  const onPurple = colors.intent.info.onSolid;

  return (
    <Card padding="none" style={styles.card}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        // Both forms: React Native maps the aria prop on the phone, and react-native-web 0.21 reads only it.
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        // The count is part of the name a screen reader announces, as it is part of what the eye reads.
        accessibilityLabel={`${title}, ${count}`}
        style={({ pressed }) => [styles.head, { backgroundColor: purple }, pressed ? { opacity: pressedOpacity } : null]}
      >
        <View style={styles.centre}>
          <Text variant="heading" align="center" style={{ color: onPurple }}>
            {title}
          </Text>
          <View style={[styles.count, { backgroundColor: onPurple }]}>
            <Text variant="labelStrong" style={{ color: purple }}>
              {String(count)}
            </Text>
          </View>
        </View>
        <Animated.View style={[styles.chevron, rightEdge, chevronStyle]}>
          <ChevronDown size={CHEVRON} strokeWidth={2.5} color={onPurple} />
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

const useStyles = makeStyles(() => ({
  // The purple header spans the card; the card's rounded corners clip it.
  card: { overflow: 'hidden' },
  head: {
    justifyContent: 'center',
    minHeight: 60,
    paddingVertical: space.md,
    // The same room on both sides, so the centred title never runs under the chevron.
    paddingHorizontal: space.base + CHEVRON + space.sm,
  },
  centre: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  count: { minWidth: 28, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.full, alignItems: 'center' },
  chevron: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  body: { overflow: 'hidden' },
  inner: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.base, paddingBottom: space.sm },
}));
