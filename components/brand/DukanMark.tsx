import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';
import { Text } from '../ui/Text';
import { useColors, useTheme } from '../../lib/design/theme';
import { useReduceMotionSetting } from '../../lib/design/use-reduce-motion';
import { BRAND_INTRO, CANVAS, PACK, PACK_COLOURS, layerFill, markColours, toneFor } from '../../lib/brand';
import type { PackArt, PackLayer } from '../../lib/brand-pack';
import { useTranslation } from '../../lib/i18n';

/*
 * The Dukan ERP mark and launch (the owner's approved logo pack, Dukan-ERP-Logo-Pack, 2026-11-04). Every path is the
 * pack's (`lib/brand-pack.ts`); on a dark surface its own colours, on a light one its lettering in launch navy — the
 * accent never changes. Never mirrored in Arabic: a logo is not a direction.
 */

type Tone = { lettering: string; accent: string };

/** One of the pack's artworks, at a width; its height follows the artwork's own proportions. */
function PackSvg({ art, width, tone, testID }: { art: PackArt; width: number; tone: Tone; testID?: string }) {
  const [, , w, h] = art.viewBox.split(/\s+/).map(Number);
  return (
    <Svg testID={testID} width={width} height={(width * h) / w} viewBox={art.viewBox} accessible={false}>
      {art.layers.map((l: PackLayer, i: number) => (
        <G key={i} transform={l.dx || l.dy ? `translate(${l.dx} ${l.dy})` : undefined}>
          <Path d={l.d} fill={layerFill(l.fill, tone)} fillRule={l.evenOdd ? 'evenodd' : 'nonzero'} />
        </G>
      ))}
    </Svg>
  );
}

/** The D alone: the app's headers and anywhere the name is said beside it. `mono` draws it in one ink. */
export function DukanMark({ size = 24, mono, style }: { size?: number; mono?: string; style?: StyleProp<ViewStyle> }) {
  const { isDark } = useTheme();
  const tone = mono ? markColours('mono', mono) : markColours(toneFor(isDark));
  return (
    <View style={style} accessible={false} importantForAccessibility="no-hide-descendants">
      <PackSvg testID="dukan-mark" art={PACK.symbol} width={size} tone={tone} />
    </View>
  );
}

/** The lockup where space permits: the D and the name, kept as text so it reads at any font size. */
export function DukanLockup({ size = 32, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <View style={[styles.lockup, style]} accessible accessibilityRole="image" accessibilityLabel={t('brand.name')}>
      <DukanMark size={size} />
      <Text variant="bodyStrong" style={{ color: colors.text.primary }}>
        {t('brand.name')}
      </Text>
    </View>
  );
}

/** Once per process: the intro is a launch, never a screen's decoration. */
let introPlayed = false;
/** The playing intro's skip, while it plays. */
let skipIntro: (() => void) | null = null;

/**
 * Any touch on the app skips the intro forward (owner, 2026-11-06) — and still reaches what it touched: the overlay never
 * takes a tap, so a ready app never waits and the first tap is never lost. Called by the root's touch capture.
 */
export function skipBrandIntro() {
  skipIntro?.();
}
export function resetBrandIntroForTests() {
  introPlayed = false;
}

/**
 * The launch's first moment after the native splash (2 seconds, the motion 1.4 — lib/brand.ts): the D centred where the splash left it;
 * then it eases left as UKAN slides right and is revealed from the left; ERP fades in beside the N; a brief hold; the
 * fade into the app. The three layers share the wordmark's canvas, as the pack's Motion/ folder does. With Reduce
 * Motion the full wordmark is shown still and the overlay goes.
 */
export function BrandIntro() {
  const colors = useColors();
  const dark = useTheme().isDark;
  const { t } = useTranslation();
  // The pack's launch navy behind its own artwork; on light, the light canvas, as the light splash.
  const background = dark ? PACK_COLOURS.launchNavy : colors.surface.canvas;
  const tone = markColours(dark ? 'dark' : 'light');
  const reduce = useReduceMotionSetting();
  const [done, setDone] = useState(introPlayed);
  const width = BRAND_INTRO.wordmarkWidth;
  const unit = width / CANVAS.width;
  // The D's centre on the canvas, and how far it starts to the right so it sits centred.
  const start = (width / 2 - (CANVAS.symbolWidth * unit) / 2);
  const shift = useSharedValue(reduce ? 0 : start);
  const reveal = useSharedValue(reduce ? 1 : 0);
  const erp = useSharedValue(reduce ? 1 : 0);
  const cover = useSharedValue(1);

  useEffect(() => {
    if (introPlayed) return;
    introPlayed = true;
    const finish = () => setDone(true);
    const fadeOut = (at: number) => {
      cover.value = withDelay(at, withTiming(0, { duration: BRAND_INTRO.fadeMs }, (ok) => ok && runOnJS(finish)()));
    };
    if (reduce) {
      fadeOut(BRAND_INTRO.reducedHoldMs);
      return;
    }
    const move = BRAND_INTRO.moveEndMs - BRAND_INTRO.holdMs;
    const ease = Easing.inOut(Easing.cubic);
    shift.value = withDelay(BRAND_INTRO.holdMs, withTiming(0, { duration: move, easing: ease }));
    reveal.value = withDelay(BRAND_INTRO.holdMs, withTiming(1, { duration: move, easing: ease }));
    erp.value = withDelay(BRAND_INTRO.erpFromMs, withTiming(1, { duration: BRAND_INTRO.erpEndMs - BRAND_INTRO.erpFromMs }));
    fadeOut(BRAND_INTRO.fadeAtMs);
    // The animation's values are shared and stable for the component's life; it runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A tap skips forward (owner, 2026-11-06): the wordmark completes at once and the overlay fades — a ready app never
  // waits for the full intro.
  const skip = () => {
    for (const v of [shift, reveal, erp, cover]) cancelAnimation(v);
    shift.set(0);
    reveal.set(1);
    erp.set(1);
    cover.set(withTiming(0, { duration: BRAND_INTRO.skipFadeMs }, (ok) => ok && runOnJS(setDone)(true)));
  };

  useEffect(() => {
    if (done) return;
    skipIntro = skip;
    return () => {
      skipIntro = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));
  const dStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));
  // UKAN slides in from under the D and is uncovered from the left: its window widens as it moves.
  const ukanStyle = useAnimatedStyle(() => ({ width: width * reveal.value, transform: [{ translateX: shift.value }] }));
  const erpStyle = useAnimatedStyle(() => ({ opacity: erp.value }));

  if (done) return null;
  const height = width * (CANVAS.height / CANVAS.width);
  return (
    <Animated.View testID="brand-intro" pointerEvents="none" accessibilityLabel={t('brand.skipIntro')} style={[StyleSheet.absoluteFill, styles.intro, { backgroundColor: background }, coverStyle]}>
      <View testID="brand-intro-frame" style={{ width, height }}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.clip, ukanStyle]}>
          <PackSvg testID="brand-intro-ukan" art={PACK.motionUkan} width={width} tone={tone} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, erpStyle]}>
          <PackSvg testID="brand-intro-erp" art={PACK.motionErp} width={width} tone={tone} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, dStyle]}>
          <PackSvg testID="brand-intro-d" art={PACK.motionD} width={width} tone={tone} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Clipped at the screen's edge: the D's canvas starts shifted right (the D centred), and its transparent remainder must
  // not widen the page while the overlay is up. Nothing visible changes.
  intro: { alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflow: 'hidden' },
  clip: { overflow: 'hidden' },
});
