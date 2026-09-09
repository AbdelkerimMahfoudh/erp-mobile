import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { motion, pressScale } from '../../lib/design/motion';
import { easing } from '../../lib/design/motion-easing';
import { haptics } from '../../lib/haptics';
import { Text } from './Text';
import { usePressed } from './use-pressed';
import { makeStyles, makeTokens } from '../../lib/design/theme';

/**
 * The button.
 *
 * Two things it enforces that call sites kept getting wrong:
 *  - Icons take their colour from the variant. `icon` is a component, not an
 *    element, so nothing hardcodes `color="#fff"` and then breaks on a light
 *    variant.
 *  - Nothing tappable is under 48pt. `sm` is visually 44 but carries hit slop
 *    to meet the target, because this is used one-handed at a counter.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Matches the lucide-react-native icon signature. */
export type IconComponent = React.ComponentType<{ color?: string; size?: number }>;

/**
 * Preferred form is the component (`icon={ShoppingCart}`) so the icon inherits
 * the variant's colour. A ready-made element is accepted for the screens still
 * on the pre-design-system call style; those are converted as each screen is
 * rebuilt, and this union goes away with the last of them.
 */
export type ButtonIcon = IconComponent | React.ReactElement;

interface VariantStyle {
  background: string;
  pressedBackground: string;
  foreground: string;
  border?: string;
}

/**
 * Disabled is its own palette, not the enabled one at reduced opacity.
 *
 * Fading a filled button drags its white label toward the background too, and
 * the control stops reading as a button at all — on a phone at arm's length it
 * looks like the button is simply missing. A disabled control must still say
 * "there is an action here, it is not ready yet".
 */
const useDisabled = makeTokens((colors) => ({
  background: colors.surface.sunken,
  pressedBackground: colors.surface.sunken,
  // Deliberately darker than `text.disabled`. The grey fill already signals
  // "unavailable"; the label's job is to stay readable under shop glare on a
  // cheap screen, so the user can still tell what the action will be.
  foreground: colors.text.secondary,
  border: colors.border.subtle,
} as VariantStyle));

const useDisabledTransparent = makeTokens((colors) => ({
  background: 'transparent',
  pressedBackground: 'transparent',
  foreground: colors.text.disabled,
} as VariantStyle));

const useVariants = makeTokens((colors) => ({
  primary: {
    background: colors.intent.info.solid,
    pressedBackground: colors.intent.info.solidPressed,
    foreground: colors.text.inverse,
  },
  secondary: {
    background: colors.surface.card,
    pressedBackground: colors.surface.sunken,
    foreground: colors.text.primary,
    border: colors.border.default,
  },
  tertiary: {
    background: 'transparent',
    pressedBackground: colors.surface.sunken,
    foreground: colors.text.accent,
  },
  danger: {
    background: colors.intent.danger.solid,
    // The darker end of the danger ramp, so pressing reads as depressing the
    // button rather than as a different button.
    pressedBackground: colors.intent.danger.fg,
    foreground: colors.intent.danger.onSolid,
  },
} as Record<ButtonVariant, VariantStyle>));

const SIZES: Record<ButtonSize, { height: number; paddingX: number; icon: number; variant: 'body' | 'bodyStrong' }> = {
  sm: { height: 44, paddingX: space.md, icon: 16, variant: 'bodyStrong' },
  md: { height: touch.min, paddingX: space.base, icon: 18, variant: 'bodyStrong' },
  lg: { height: touch.comfortable, paddingX: space.lg, icon: 20, variant: 'bodyStrong' },
};

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  /** `ghost` is the former name for `tertiary` and is still accepted. */
  variant?: ButtonVariant | 'ghost';
  size?: ButtonSize;
  /** Prefer the component itself (`ShoppingCart`), not `<ShoppingCart />`. */
  icon?: ButtonIcon;
  /** Put the icon after the label — flips correctly in RTL. */
  iconPosition?: 'start' | 'end';
  loading?: boolean;
  /** Stretch to the container. Primary actions in a footer are always full. */
  fullWidth?: boolean;
  /** Fire a light tap on press. On by default for primary and danger. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Accepted so NativeWind-styled call sites keep working. */
  className?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'start',
  loading = false,
  disabled = false,
  fullWidth = false,
  haptic,
  onPress,
  style,
  ...rest
}: ButtonProps) {
  const DISABLED = useDisabled();
  const DISABLED_TRANSPARENT = useDisabledTransparent();
  const VARIANTS = useVariants();
  const styles = useStyles();
  const resolved = variant === 'ghost' ? 'tertiary' : variant;
  const s = SIZES[size];
  const inactive = disabled || loading;

  // Loading keeps the enabled palette — the spinner already says "working", and
  // greying it out would suggest the action had become unavailable.
  const v = disabled
    ? resolved === 'tertiary'
      ? DISABLED_TRANSPARENT
      : DISABLED
    : VARIANTS[resolved];

  const wantsHaptic = haptic ?? (variant === 'primary' || variant === 'danger');

  // Recover the difference between a small button and a safe touch target.
  const slop = Math.max(0, (touch.min - s.height) / 2);

  const handlePress: PressableProps['onPress'] = (event) => {
    if (wantsHaptic) haptics.tap();
    onPress?.(event);
  };

  const labelStyle: StyleProp<TextStyle> = { color: v.foreground };
  const { pressed, pressHandlers } = usePressed();
  const isPressed = pressed && !inactive;

  /**
   * The press response.
   *
   * Two deliberate exclusions:
   *
   *  - **Destructive buttons do not scale.** A delete or a refund is supposed
   *    to feel like a decision, and a control that springs pleasantly under the
   *    thumb makes it feel like a tap. The friction is the feature.
   *  - **Reduce Motion removes it entirely.** The press is already reported by
   *    the colour change and the haptic, so nothing is lost by holding still.
   *
   * It is presentation only: `handlePress` has already run by the time this
   * finishes, and `inactive` — not the animation — is what stops a second press
   * landing while an action is in flight.
   */
  const reduceMotion = useReducedMotion();
  const scalable = variant !== 'danger' && !inactive;

  /**
   * The animation is decided on the JS thread; the worklet only READS it.
   *
   * This crashed the app on a device, and the shape of the mistake is worth
   * keeping written down.
   *
   * The first version called `withTiming` *inside* `useAnimatedStyle`. That
   * body is a worklet — it runs on the UI thread, in a separate runtime — and
   * it referenced `pressScale(…)` and a module-scope `Easing.bezier` object.
   * Neither is a worklet, so the UI runtime had to be handed plain JS functions
   * from another module. On this stack that does not throw a catchable error:
   * it takes the process down, which is why Expo Go simply vanished and no
   * redbox, no unhandled rejection and no HTTP request ever appeared.
   *
   * It was also the only place in the app doing it — every other animation here
   * (sheet, toast, dialog, skeleton) already drives a shared value from JS and
   * lets the worklet do nothing but read. This now matches that, because the
   * pattern that already works on this exact stack beats a second opinion.
   *
   * The target is computed in an effect rather than during render: writing a
   * shared value while rendering is a side effect in the render phase, and
   * `onPressOut` fires on cancellation too, so the scale always returns and no
   * button is left sitting at 0.98.
   */
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(isPressed && scalable ? pressScale(reduceMotion) : 1, {
      duration: motion.press,
      easing: easing.standard,
    });
  }, [isPressed, scalable, reduceMotion, scale]);

  const pressAnimation = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityLabel={title}
      disabled={inactive}
      onPress={inactive ? undefined : handlePress}
      hitSlop={slop}
      {...pressHandlers}
      style={[
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.paddingX,
          backgroundColor: isPressed ? v.pressedBackground : v.background,
          borderRadius: radius.md,
          // Only the press dims. Disabled is expressed by colour (above), never
          // by fading the control out of existence.
          opacity: isPressed ? pressedOpacity : 1,
        },
        v.border ? { borderWidth: StyleSheet.hairlineWidth, borderColor: v.border } : null,
        fullWidth ? styles.fullWidth : null,
        style,
        pressAnimation,
      ]}
      {...rest}
    >
      {/* Reserving the icon slot while loading keeps the label from shifting. */}
      {iconPosition === 'start' ? (
        <Leading loading={loading} Icon={Icon} color={v.foreground} size={s.icon} />
      ) : null}
      <Text variant={s.variant} align="center" style={labelStyle} numberOfLines={1}>
        {title}
      </Text>
      {iconPosition === 'end' ? (
        <Leading loading={loading} Icon={Icon} color={v.foreground} size={s.icon} />
      ) : null}
    </AnimatedPressable>
  );
}

function Leading({
  loading,
  Icon,
  color,
  size,
}: {
  loading: boolean;
  Icon?: ButtonIcon;
  color: string;
  size: number;
}) {
  if (loading) return <ActivityIndicator color={color} size="small" />;
  if (!Icon) return null;
  // An element carries its own colour; a component gets the variant's.
  if (React.isValidElement(Icon)) return <View accessible={false}>{Icon}</View>;
  const IconComp = Icon as IconComponent;
  return (
    <View accessible={false}>
      <IconComp color={color} size={size} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
}));
