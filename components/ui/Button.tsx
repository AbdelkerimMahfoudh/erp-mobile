import React from 'react';
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
import { colors } from '../../lib/design/colors';
import { pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { haptics } from '../../lib/haptics';
import { Text } from './Text';
import { usePressed } from './use-pressed';

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
const DISABLED: VariantStyle = {
  background: colors.neutral[200],
  pressedBackground: colors.neutral[200],
  // Deliberately darker than `text.disabled`. The grey fill already signals
  // "unavailable"; the label's job is to stay readable under shop glare on a
  // cheap screen, so the user can still tell what the action will be.
  foreground: colors.neutral[600],
  border: colors.border.subtle,
};

const DISABLED_TRANSPARENT: VariantStyle = {
  background: 'transparent',
  pressedBackground: 'transparent',
  foreground: colors.neutral[500],
};

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: {
    background: colors.brand[600],
    pressedBackground: colors.brand[700],
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
};

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

  return (
    <Pressable
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
    </Pressable>
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

const styles = StyleSheet.create({
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
});
