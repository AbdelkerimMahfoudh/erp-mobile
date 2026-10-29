import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { G, Mask, Path, Rect } from 'react-native-svg';
import { Text } from '../ui/Text';
import { useColors, useTheme } from '../../lib/design/theme';
import { useReduceMotionSetting } from '../../lib/design/use-reduce-motion';
import { BRAND_INTRO, LEDGER, markColours, type MarkTone } from '../../lib/brand';

/*
 * The Dukan interlocking-ledger mark (the owner's brand pack, 2026-10-29). Three layers, kept apart because the launch
 * animation moves them separately: `ledger-left`, `ledger-right` and `interlock-highlight`. Colours come from the design
 * tokens (`lib/brand.ts`), never from the pack's own hex values. The mark is never mirrored in Arabic: a logo is not a
 * direction.
 */

function Masks({ id }: { id: string }) {
  return (
    <>
      <Mask id={`${id}l`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
        <Rect width="1024" height="1024" fill="white" />
        {LEDGER.leftCuts.map((c) => (
          <Rect key={c.y} x={c.x} y={c.y} width={c.w} height={54} rx={27} transform={`rotate(23 ${c.x} ${c.y})`} fill="black" />
        ))}
      </Mask>
      <Mask id={`${id}r`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
        <Rect width="1024" height="1024" fill="white" />
        {LEDGER.rightCuts.map((c) => (
          <Rect key={c.y} x={c.x} y={c.y} width={c.w} height={54} rx={27} transform={`rotate(-23 ${c.x} ${c.y})`} fill="black" />
        ))}
      </Mask>
    </>
  );
}

type Layer = 'left' | 'right' | 'highlight' | 'all';

/** One SVG of the mark: all three layers, or one of them (the animation stacks three). */
function MarkSvg({ size, tone, layer = 'all', id }: { size: number; tone: MarkTone; layer?: Layer; id: string }) {
  const c = markColours(tone);
  return (
    <Svg width={size} height={size} viewBox={LEDGER.viewBox} accessible={false}>
      {layer === 'all' || layer === 'left' || layer === 'right' ? <Masks id={id} /> : null}
      {layer === 'all' || layer === 'left' ? (
        <G id="ledger-left" fill={c.left} mask={`url(#${id}l)`}>
          <Path d={LEDGER.left} />
        </G>
      ) : null}
      {layer === 'all' || layer === 'right' ? (
        <G id="ledger-right" fill={c.right} mask={`url(#${id}r)`}>
          <Path d={LEDGER.right} />
        </G>
      ) : null}
      {layer === 'all' ? (
        <G id="interlock-highlight" fill="none" stroke={c.highlight} strokeWidth={18} strokeLinecap="round">
          <Path d={LEDGER.highlight} />
        </G>
      ) : null}
    </Svg>
  );
}

let markSeq = 0;
function useMarkId(prefix: string): string {
  const [id] = useState(() => `${prefix}${++markSeq}`);
  return id;
}

/** The mark alone: below 32 points, the app's headers and anywhere the name is said beside it. */
export function DukanMark({ size = 24, tone, style }: { size?: number; tone?: MarkTone; style?: StyleProp<ViewStyle> }) {
  const { isDark } = useTheme();
  const id = useMarkId('dm');
  return (
    <View style={style} accessible={false} importantForAccessibility="no-hide-descendants">
      <MarkSvg size={size} tone={tone ?? (isDark ? 'dark' : 'light')} id={id} />
    </View>
  );
}

/** The Dukan ERP lockup — the mark and the name — where space permits. The name stays text, so it reads in any font size. */
export function DukanLockup({ size = 32, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View style={[styles.lockup, style]} accessible accessibilityRole="image" accessibilityLabel="Dukan ERP">
      <DukanMark size={size} />
      <View>
        <Text variant="bodyStrong" style={{ color: colors.text.primary }}>
          Dukan
        </Text>
        <Text variant="label" style={{ color: colors.text.accent, letterSpacing: 2 }}>
          ERP
        </Text>
      </View>
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Once per process: the intro is a launch, never a screen's decoration. */
let introPlayed = false;
export function resetBrandIntroForTests() {
  introPlayed = false;
}

/**
 * The launch's first moment after the native splash (which stays static): the same mark at the same place on the same
 * colour, then the halves enter from opposite sides, overshoot a little, settle, and the connection draws — about one
 * second, once. With Reduce Motion the mark is shown still and the overlay goes. Covers the app, then fades out and
 * unmounts; it never blocks a tap after it has gone.
 */
export function BrandIntro({ background, tone }: { background: string; tone: MarkTone }) {
  const reduce = useReduceMotionSetting();
  const [done, setDone] = useState(introPlayed);
  const id = useMarkId('bi');
  const size = BRAND_INTRO.size;
  const shift = (size * BRAND_INTRO.enterUnits) / LEDGER.span;
  const over = (size * BRAND_INTRO.overshootUnits) / LEDGER.span;
  const left = useSharedValue(reduce ? 0 : -shift);
  const right = useSharedValue(reduce ? 0 : shift);
  const halves = useSharedValue(reduce ? 1 : 0);
  const dash = useSharedValue(reduce ? 0 : BRAND_INTRO.highlightLength);
  const cover = useSharedValue(1);

  useEffect(() => {
    if (introPlayed) return;
    introPlayed = true;
    const finish = () => setDone(true);
    const fadeOut = (delay: number) => {
      cover.value = withDelay(delay, withTiming(0, { duration: BRAND_INTRO.fadeMs }, (ok) => ok && runOnJS(finish)()));
    };
    if (reduce) {
      fadeOut(BRAND_INTRO.reducedHoldMs);
      return;
    }
    const ease = Easing.out(Easing.cubic);
    const enter = BRAND_INTRO.enterMs;
    const settle = BRAND_INTRO.settleMs;
    halves.value = withTiming(1, { duration: BRAND_INTRO.appearMs });
    left.value = withSequence(withTiming(over, { duration: enter, easing: ease }), withTiming(0, { duration: settle, easing: ease }));
    right.value = withDelay(BRAND_INTRO.rightLagMs, withSequence(withTiming(-over, { duration: enter, easing: ease }), withTiming(0, { duration: settle, easing: ease })));
    dash.value = withDelay(BRAND_INTRO.drawAtMs, withTiming(0, { duration: BRAND_INTRO.drawMs, easing: ease }));
    fadeOut(BRAND_INTRO.totalMs);
    // The animation's own values are shared and stable for the component's life; it runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: halves.value, transform: [{ translateX: left.value }] }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: halves.value, transform: [{ translateX: right.value }] }));
  const dashProps = useAnimatedProps(() => ({ strokeDashoffset: dash.value }));
  const c = markColours(tone);

  if (done) return null;
  return (
    <Animated.View testID="brand-intro" pointerEvents="none" style={[StyleSheet.absoluteFill, styles.intro, { backgroundColor: background }, coverStyle]}>
      <View style={{ width: size, height: size }}>
        <Animated.View style={[StyleSheet.absoluteFill, leftStyle]}>
          <MarkSvg size={size} tone={tone} layer="left" id={`${id}a`} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, rightStyle]}>
          <MarkSvg size={size} tone={tone} layer="right" id={`${id}b`} />
        </Animated.View>
        <Svg width={size} height={size} viewBox={LEDGER.viewBox} style={StyleSheet.absoluteFill}>
          <G id="interlock-highlight" fill="none" stroke={c.highlight} strokeWidth={18} strokeLinecap="round">
            <AnimatedPath d={LEDGER.highlight} strokeDasharray={[BRAND_INTRO.highlightLength, BRAND_INTRO.highlightLength]} animatedProps={dashProps} />
          </G>
        </Svg>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  intro: { alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
});
