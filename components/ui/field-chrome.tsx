import React from 'react';
import { Platform, StyleSheet, View, type TextStyle } from 'react-native';
import type { Palette } from '../../lib/design/colors';

/**
 * The one focus treatment every text input in the app carries (2026-10-24).
 *
 * On a phone's browser an input showed two focus indicators at once: the browser's own rectangular outline around the
 * `<input>` itself, inside the rounded ring the app draws around the field's well — two nested boxes. The app's ring is
 * the accessible one (rounded, the theme's focus colour, drawn for touch and keyboard focus alike), so the browser's is
 * switched off **on these inputs only**, never globally: an input elsewhere that draws nothing of its own keeps the
 * browser's.
 *
 * The ring is an overlay rather than a thicker border, so gaining focus or an error moves nothing: the well keeps its
 * hairline, and the ring is drawn over it, outside the layout, letting every touch through to the input beneath.
 */

/** Which ring a field shows — `null` for none. Focus and an error together keep the error's colour, drawn thicker. */
export type FieldRing = 'focus' | 'error' | 'focus-error' | null;

export function fieldRing({ focused, error, editable }: { focused: boolean; error: boolean; editable: boolean }): FieldRing {
  if (!editable) return error ? 'error' : null;
  if (focused && error) return 'focus-error';
  if (focused) return 'focus';
  return error ? 'error' : null;
}

const RING_WIDTH: Record<Exclude<FieldRing, null>, number> = { focus: 2, error: 1.5, 'focus-error': 2.5 };

export function FocusRing({ ring, radius, colors }: { ring: FieldRing; radius: number; colors: Palette }) {
  if (!ring) return null;
  const color = ring === 'focus' ? colors.border.focus : colors.intent.danger.solid;
  return (
    <View
      testID="field-ring"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.ring, { borderRadius: radius, borderWidth: RING_WIDTH[ring], borderColor: color }]}
    />
  );
}

/**
 * The input's own browser outline, removed where the ring above replaces it — web only; native inputs draw none.
 * Spread onto the `TextInput`'s style.
 */
export const NO_NATIVE_OUTLINE: TextStyle | null =
  // React Native's types know only the drawn styles; react-native-web passes `none` straight to the element's CSS.
  Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as unknown as TextStyle) : null;

/**
 * Marks the input for the scoped web rules in `global.css` (`input[data-app-field]`): the browser's autofill tint held
 * off, so an autofilled field is not drawn as a second, tinted box inside the first. Web only; spread onto the input.
 */
export const APP_FIELD_MARKER: object = Platform.OS === 'web' ? { dataSet: { appField: 'true' } } : {};

/**
 * The input's text colour, handed to those rules as a CSS variable (`--app-field-ink`): a browser paints autofilled text
 * in its own colour, black on a dark field, and the rule paints it in this one instead. Web only; in the input's style.
 */
export function fieldInk(color: string): TextStyle | null {
  return Platform.OS === 'web' ? ({ '--app-field-ink': color } as unknown as TextStyle) : null;
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    // Over the well's own hairline, so the ring's outer edge is the well's outer edge.
    top: -StyleSheet.hairlineWidth,
    left: -StyleSheet.hairlineWidth,
    right: -StyleSheet.hairlineWidth,
    bottom: -StyleSheet.hairlineWidth,
    // Never a touch target: a tap on the ring is a tap on the input.
    pointerEvents: 'none',
  },
});
