import React from 'react';
import { StyleSheet, Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors } from '../../lib/design/colors';
import { type TypeVariant, type as typeScale } from '../../lib/design/tokens';
import { textAlign } from '../../lib/design/direction';

/**
 * The typography primitive. Every string in the app renders through this.
 *
 * It owns text direction because NativeWind cannot: `text-start` compiles to
 * nothing (see `lib/design/direction.ts`). Routing all text through one
 * component is what makes Arabic correct by default rather than by vigilance.
 */

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'placeholder'
  | 'disabled'
  | 'inverse'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

const TONE_COLORS: Record<TextTone, string> = {
  primary: colors.text.primary,
  secondary: colors.text.secondary,
  tertiary: colors.text.tertiary,
  placeholder: colors.text.placeholder,
  disabled: colors.text.disabled,
  inverse: colors.text.inverse,
  accent: colors.text.accent,
  success: colors.intent.success.fg,
  warning: colors.intent.warning.fg,
  danger: colors.intent.danger.fg,
};

export interface TextProps extends Omit<RNTextProps, 'style'> {
  variant?: TypeVariant;
  tone?: TextTone;
  /** Logical alignment — flips with reading direction. */
  align?: 'start' | 'end' | 'center';
  /** Escape hatch for one-off layout tweaks. Not for colour or size. */
  style?: RNTextProps['style'];
  children?: React.ReactNode;
}

export function Text({
  variant = 'body',
  tone = 'primary',
  align = 'start',
  style,
  children,
  ...rest
}: TextProps) {
  const scale = typeScale[variant];
  const composed: TextStyle = {
    fontSize: scale.fontSize,
    lineHeight: scale.lineHeight,
    fontWeight: scale.fontWeight as TextStyle['fontWeight'],
    color: TONE_COLORS[tone],
    textAlign: textAlign(align),
  };
  return (
    <RNText style={[composed, style]} {...rest}>
      {children}
    </RNText>
  );
}

/**
 * Machine identifiers — IMEI, serial, barcode, invoice number.
 *
 * Tabular figures and generous letter spacing so an employee can compare a
 * number on screen against one printed on a box without losing their place.
 * Always LTR: an identifier is not language.
 */
export function Identifier({ children, tone = 'secondary', style, ...rest }: TextProps) {
  return (
    <RNText
      style={[styles.identifier, { color: TONE_COLORS[tone] }, style]}
      // Identifiers are selectable so staff can copy one into a supplier chat.
      selectable
      {...rest}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  identifier: {
    fontSize: typeScale.mono.fontSize,
    lineHeight: typeScale.mono.lineHeight,
    fontWeight: typeScale.mono.fontWeight as TextStyle['fontWeight'],
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
    writingDirection: 'ltr',
    textAlign: 'left',
  },
});
