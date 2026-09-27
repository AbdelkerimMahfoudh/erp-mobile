import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';
import { Card } from './Surface';
import { Text } from './Text';
import { usePressed } from './use-pressed';
import { duration, pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { layoutIsRTL } from '../../lib/design/layout-direction';
import { useReduceMotionSetting } from '../../lib/design/use-reduce-motion';

/**
 * A header that opens to show what sits beneath it.
 *
 * A tap turns the chevron from pointing forward to pointing down, and the
 * content slides out from under the header — and folds back the same way.
 * Short, and none at all when the person asked their phone for reduced motion
 * (read as it is now, not as it was when the app started). Folded, the content
 * stays mounted, because its height is what the reveal animates.
 *
 * Two looks: `accent`, a light-violet wash inside a card, whose underlined
 * title says it can be tapped; and `solid`, a card of its own whose purple
 * header is as prominent as a primary button.
 */
export interface ExpandableProps {
  title: string;
  /** Secondary words under the title — a count, a total. */
  meta?: string;
  tone: 'accent' | 'solid';
  /**
   * `afterTitle`: the chevron right after the words, mirrored with the row in
   * Arabic. `edge`: the title centred, the chevron at the physical right edge
   * in every language.
   */
  chevron: 'afterTitle' | 'edge';
  /** Beside the header, outside the toggle — a (?) that explains rather than opens. */
  trailing?: React.ReactNode;
  /** Controlled when given; otherwise it keeps its own state, starting from `initiallyOpen`. */
  open?: boolean;
  initiallyOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** What a screen reader announces. Defaults to the title and the meta. */
  accessibilityLabel?: string;
  children: React.ReactNode;
}

const SLIDE = { duration: duration.base, easing: Easing.out(Easing.cubic) };

export function Expandable({
  title,
  meta,
  tone,
  chevron,
  trailing,
  open,
  initiallyOpen = false,
  onOpenChange,
  accessibilityLabel,
  children,
}: ExpandableProps) {
  const styles = useStyles();
  const colors = useColors();
  const reduceMotion = useReduceMotionSetting();
  const { pressed, pressHandlers } = usePressed();
  const [own, setOwn] = useState(initiallyOpen);
  const isOpen = open ?? own;
  const progress = useSharedValue(isOpen ? 1 : 0);
  const measured = useSharedValue(0);
  const height = useRef<number | null>(null);

  useEffect(() => {
    const to = isOpen ? 1 : 0;
    progress.value = reduceMotion ? to : withTiming(to, SLIDE);
  }, [isOpen, reduceMotion, progress]);

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (height.current !== null && Math.abs(height.current - h) <= 1) return;
    // The first measure lands as it is; content that grows or shrinks while open (an event arriving) eases to its new height.
    measured.value = height.current !== null && isOpen && !reduceMotion ? withTiming(h, SLIDE) : h;
    height.current = h;
  };

  // Closed, the down-chevron is turned to point forward: right in left-to-right, left in Arabic.
  const closedAngle = layoutIsRTL() ? 90 : -90;
  const clipStyle = useAnimatedStyle(() => ({ height: measured.value * progress.value }));
  // The content hangs from the bottom of the reveal, so it comes out from beneath the header rather than unrolling.
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (progress.value - 1) * measured.value }] }));
  const turnStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${(1 - progress.value) * closedAngle}deg` }] }));

  const solid = tone === 'solid';
  const edge = chevron === 'edge';
  const ink = solid ? colors.intent.info.onSolid : colors.text.accent;
  const size = solid ? 26 : 20;
  // The wrapper turns, never the SVG: a transform on the icon moves the drawing out of its own box.
  const turn = (
    <Animated.View style={turnStyle}>
      <ChevronDown size={size} strokeWidth={solid ? 2.5 : 2} color={ink} />
    </Animated.View>
  );
  const words = (
    <View style={edge ? styles.centre : styles.words}>
      <Text variant={solid ? 'heading' : 'bodyStrong'} align={edge ? 'center' : 'start'} style={[{ color: ink }, solid ? null : styles.link]}>
        {title}
      </Text>
      {meta ? (
        <Text variant={solid ? 'label' : 'caption'} tone="secondary" align={edge ? 'center' : 'start'} style={solid ? { color: ink } : null}>
          {meta}
        </Text>
      ) : null}
    </View>
  );

  const content = (
    <>
      <View style={[styles.head, solid ? { backgroundColor: pressed ? colors.intent.info.solidPressed : colors.intent.info.solid } : styles.wash]}>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          // Both forms: React Native maps the aria prop on the phone, and react-native-web 0.21 reads only it.
          accessibilityState={{ expanded: isOpen }}
          aria-expanded={isOpen}
          accessibilityLabel={accessibilityLabel ?? (meta ? `${title}, ${meta}` : title)}
          {...pressHandlers}
          style={[
            styles.toggle,
            solid ? styles.solidToggle : styles.accentToggle,
            // Native mirrors a row in Arabic and the web follows the document's direction, so reversing it there keeps
            // the chevron at the physical right on both.
            edge ? { flexDirection: layoutIsRTL() ? 'row-reverse' : 'row' } : null,
            pressed && !solid ? { opacity: pressedOpacity } : null,
          ]}
        >
          {/* As wide as the chevron, so the centred title is centred on the header and never runs under it. */}
          {edge ? <View style={{ width: size }} /> : null}
          {words}
          {turn}
        </Pressable>
        {trailing}
      </View>
      {/* Folded, the content is still mounted, so it is hidden from readers explicitly. */}
      <Animated.View
        style={[styles.clip, clipStyle]}
        aria-hidden={!isOpen}
        accessibilityElementsHidden={!isOpen}
        importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
      >
        <Animated.View onLayout={onLayout} style={[styles.measure, solid ? styles.solidBody : styles.accentBody, slideStyle]}>
          {children}
        </Animated.View>
      </Animated.View>
    </>
  );

  // The solid header spans its own card, whose rounded corners clip it to the button's shape.
  return solid ? (
    <Card padding="none" style={styles.card}>
      {content}
    </Card>
  ) : (
    <View>{content}</View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { overflow: 'hidden', borderRadius: radius.md },
  head: { flexDirection: 'row', alignItems: 'center' },
  wash: { backgroundColor: colors.intent.info.bg, borderRadius: radius.sm },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touch.min },
  accentToggle: { paddingHorizontal: space.sm },
  solidToggle: { minHeight: touch.comfortable, paddingHorizontal: space.base, paddingVertical: space.sm, gap: space.sm },
  // Large text wraps the words instead of pushing the chevron off the row.
  words: { flexShrink: 1, minWidth: 0 },
  centre: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  link: { textDecorationLine: 'underline' },
  clip: { overflow: 'hidden' },
  measure: { position: 'absolute', left: 0, right: 0, top: 0 },
  accentBody: { paddingTop: space.sm },
  solidBody: { paddingHorizontal: space.base, paddingBottom: space.sm },
}));
