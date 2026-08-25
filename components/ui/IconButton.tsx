import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { disabledOpacity, pressedOpacity, radius, touch } from '../../lib/design/tokens';
import { mirror } from '../../lib/design/direction';
import { haptics } from '../../lib/haptics';
import type { IconComponent } from './Button';
import { usePressed } from './use-pressed';
import { makeStyles, makeTokens } from '../../lib/design/theme';

/**
 * An icon-only control: close, torch, back, overflow.
 *
 * `accessibilityLabel` is required, not optional — an icon with no label is
 * unusable with a screen reader, and this is the one component where it is easy
 * to forget. The type system asks for it.
 */

export type IconButtonVariant = 'plain' | 'filled' | 'sunken' | 'inverse';

const useVariants = makeTokens((colors) => ({
  plain: { background: 'transparent', pressed: colors.surface.sunken, color: colors.text.secondary },
  filled: { background: colors.brand[600], pressed: colors.brand[700], color: colors.text.inverse },
  sunken: { background: colors.surface.sunken, pressed: colors.neutral[200], color: colors.text.primary },
  inverse: {
    background: colors.surface.inverseRaised,
    pressed: colors.surface.inverseRaisedPressed,
    color: colors.text.inverse,
  },
} as Record<IconButtonVariant, { background: string; pressed: string; color: string }>));

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: IconComponent;
  /** Spoken by screen readers, e.g. "Close", "Turn on torch". */
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: number;
  /** Mirror the glyph in RTL. For chevrons and arrows only. */
  directional?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon: Icon,
  accessibilityLabel,
  variant = 'plain',
  size = touch.min,
  directional = false,
  disabled = false,
  onPress,
  style,
  ...rest
}: IconButtonProps) {
  const VARIANTS = useVariants();
  const styles = useStyles();
  const v = VARIANTS[variant];
  const glyph = Math.round(size * 0.45);
  // PressableProps types `disabled` as nullable, so the default alone is not
  // enough to satisfy accessibilityState.
  const off = disabled ?? false;
  const { pressed, pressHandlers } = usePressed();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={(event) => {
        haptics.tap();
        onPress?.(event);
      }}
      {...pressHandlers}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: pressed && !off ? v.pressed : v.background,
          opacity: off ? disabledOpacity : pressed ? pressedOpacity : 1,
        },
        directional ? mirror() : null,
        style,
      ]}
      {...rest}
    >
      <Icon color={v.color} size={glyph} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
