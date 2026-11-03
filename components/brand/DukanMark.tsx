import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';
import { Text } from '../ui/Text';
import { useColors } from '../../lib/design/theme';
import { useReduceMotionSetting } from '../../lib/design/use-reduce-motion';
import { BRAND_INTRO, SPIRAL } from '../../lib/brand';
import { useTranslation } from '../../lib/i18n';

/*
 * The Dukan Offset Spiral mark (the owner's brand pack, Concept B, 2026-11-03): two arcs around a "D". Three layers, kept
 * apart because the launch animation moves them separately: `spiral-first`, `spiral-second` and `spiral-letter`. Colours
 * come from the design tokens (`lib/design/colors.ts` `mark`). The mark is never mirrored in Arabic: a logo is not a
 * direction.
 */

type Layer = 'arcs' | 'letter' | 'all';

type MarkInk = { first: string; second: string; letter: string };

/** One SVG of the mark: all three layers, the two arcs, or the letter (the animation stacks two). */
function MarkSvg({ size, ink: c, layer = 'all' }: { size: number; ink: MarkInk; layer?: Layer }) {
  return (
    <Svg width={size} height={size} viewBox={SPIRAL.viewBox} accessible={false}>
      {layer !== 'letter' ? (
        <>
          <G id="spiral-first" fill={c.first}>
            <Path d={SPIRAL.first} />
          </G>
          <G id="spiral-second" fill={c.second}>
            <Path d={SPIRAL.second} />
          </G>
        </>
      ) : null}
      {layer !== 'arcs' ? (
        <G id="spiral-letter" fill={c.letter}>
          <Path d={SPIRAL.letter} fillRule="evenodd" />
        </G>
      ) : null}
    </Svg>
  );
}

/**
 * The mark alone: below 32 points, the app's headers and anywhere the name is said beside it. Its colours are the
 * palette's `mark` tokens; `mono` draws it in one ink (`currentColor`'s role) for a single-colour surface.
 */
export function DukanMark({ size = 24, mono, style }: { size?: number; mono?: string; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const ink = mono ? { first: mono, second: mono, letter: mono } : colors.mark;
  return (
    <View style={style} accessible={false} importantForAccessibility="no-hide-descendants">
      <MarkSvg size={size} ink={ink} />
    </View>
  );
}

/** The Dukan ERP lockup — the mark and the name — where space permits. The name stays text, so it reads in any font size. */
export function DukanLockup({ size = 32, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const { t, language } = useTranslation();
  return (
    <View style={[styles.lockup, style]} accessible accessibilityRole="image" accessibilityLabel={t('brand.name')}>
      <DukanMark size={size} />
      {/* D225: in Arabic the product is تطبيق دكان, one line, never "Dukan ERP" — and no letter-spacing on Arabic. */}
      {language === 'ar' ? (
        <Text variant="bodyStrong" style={{ color: colors.text.primary }}>
          {t('brand.name')}
        </Text>
      ) : (
        <View>
          <Text variant="bodyStrong" style={{ color: colors.text.primary }}>
            Dukan
          </Text>
          <Text variant="label" style={{ color: colors.text.accent, letterSpacing: 2 }}>
            ERP
          </Text>
        </View>
      )}
    </View>
  );
}

/** Once per process: the intro is a launch, never a screen's decoration. */
let introPlayed = false;
export function resetBrandIntroForTests() {
  introPlayed = false;
}

/**
 * The launch's first moment after the native splash (which stays static): the same mark at the same place on the same
 * colour. The arcs converge from a third of their size and a quarter turn back, pass their place and settle; the "D"
 * scales up past its size and locks into the centre — about one second, once. With Reduce Motion the mark is shown still
 * and the overlay goes. Covers the app, then fades out and unmounts; it never blocks a tap after it has gone.
 */
export function BrandIntro() {
  const colors = useColors();
  const background = colors.surface.canvas;
  const reduce = useReduceMotionSetting();
  const [done, setDone] = useState(introPlayed);
  const size = BRAND_INTRO.size;
  const arcsScale = useSharedValue(reduce ? 1 : BRAND_INTRO.arcsFromScale);
  const arcsTurn = useSharedValue(reduce ? 0 : BRAND_INTRO.arcsFromDegrees);
  const arcsShown = useSharedValue(reduce ? 1 : 0);
  const letterScale = useSharedValue(reduce ? 1 : 0);
  const letterTurn = useSharedValue(reduce ? 0 : BRAND_INTRO.letterFromDegrees);
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
    const half = (ms: number) => Math.round(ms / 2);
    // Stage 1: the arcs converge, past their place, then settle.
    arcsShown.value = withTiming(1, { duration: half(BRAND_INTRO.arcsMs) });
    arcsScale.value = withSequence(withTiming(BRAND_INTRO.arcsOvershootScale, { duration: half(BRAND_INTRO.arcsMs), easing: ease }), withTiming(1, { duration: half(BRAND_INTRO.arcsMs), easing: ease }));
    arcsTurn.value = withSequence(withTiming(BRAND_INTRO.arcsOvershootDegrees, { duration: half(BRAND_INTRO.arcsMs), easing: ease }), withTiming(0, { duration: half(BRAND_INTRO.arcsMs), easing: ease }));
    // Stage 2: the "D" scales up past its size and locks.
    const lock = Math.round(BRAND_INTRO.letterMs * 0.6);
    letterScale.value = withDelay(BRAND_INTRO.letterAtMs, withSequence(withTiming(BRAND_INTRO.letterOvershootScale, { duration: lock, easing: ease }), withTiming(1, { duration: BRAND_INTRO.letterMs - lock, easing: ease })));
    letterTurn.value = withDelay(BRAND_INTRO.letterAtMs, withTiming(0, { duration: BRAND_INTRO.letterMs, easing: ease }));
    // Stage 3: settled, then the overlay goes.
    fadeOut(BRAND_INTRO.totalMs);
    // The animation's own values are shared and stable for the component's life; it runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));
  const arcsStyle = useAnimatedStyle(() => ({ opacity: arcsShown.value, transform: [{ scale: arcsScale.value }, { rotate: `${arcsTurn.value}deg` }] }));
  const letterStyle = useAnimatedStyle(() => ({ transform: [{ scale: letterScale.value }, { rotate: `${letterTurn.value}deg` }] }));
  const c = colors.mark;

  if (done) return null;
  return (
    <Animated.View testID="brand-intro" pointerEvents="none" style={[StyleSheet.absoluteFill, styles.intro, { backgroundColor: background }, coverStyle]}>
      {/* Each layer turns about the mark's centre: the views are the mark's box, centred on the pack's (256, 256). */}
      <View style={{ width: size, height: size }}>
        <Animated.View style={[StyleSheet.absoluteFill, arcsStyle]}>
          <MarkSvg size={size} ink={c} layer="arcs" />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, letterStyle]}>
          <MarkSvg size={size} ink={c} layer="letter" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  intro: { alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
});
