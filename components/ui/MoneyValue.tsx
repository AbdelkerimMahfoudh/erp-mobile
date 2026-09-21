import React from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { moneyColors, type Palette } from '../../lib/design/colors';
import { type } from '../../lib/design/tokens';
import { ABSENT, formatMoney } from '../../lib/format';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * A money figure.
 *
 * This exists because the same number was being styled three ways on one
 * screen — bold and large in a card, small and grey two rows below. A price is
 * the thing staff read fastest and trust most, so how it looks cannot be a
 * per-call-site decision.
 *
 * Three sizes for three jobs:
 *  - `display` — the one focal figure on a screen (a sale total, a balance)
 *  - `default` — a figure inside a row or card
 *  - `small`   — a supporting figure next to a label
 *
 * All are tabular-nums, so a column of prices lines up and can be compared at a
 * glance instead of read one by one.
 *
 * **Latin digits in Arabic too.** Arabic-Indic numerals render inconsistently
 * across Hermes/ICU builds, and a price that renders differently on two phones
 * is worse than one that renders in a familiar-but-foreign script — Mauritanian
 * price tags use Latin digits anyway. The direction of the *row* still flips;
 * only the glyphs stay put.
 */

export type MoneySize = 'display' | 'large' | 'default' | 'small';

/**
 * How to read the number, not what kind of number it is.
 * `auto` colours by sign — for deltas and differences, never for a total.
 */
export type MoneyTone = 'default' | 'positive' | 'negative' | 'muted' | 'auto';

export interface MoneyValueProps {
  value?: number | null;
  size?: MoneySize;
  tone?: MoneyTone;
  /**
   * Show a `+` on positive values. For differences (a till surplus), where the
   * direction matters as much as the amount.
   */
  signed?: boolean;
  /**
   * What to render when `value` is null/undefined. Defaults to an em dash.
   *
   * A missing figure is usually **permission-gated cost**, not a zero, and the
   * two must never look alike: showing `0.00` where someone lacks `cost.view`
   * would be a lie about the shop's money.
   */
  fallback?: string;
  /** Off inside a column or card already labelled as money. */
  showCurrency?: boolean;
  /** Screen-reader label, when the surrounding text does not already say it. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The token objects are `as const`, so their `fontVariant` tuple is readonly
 * while `TextStyle` wants a mutable array. Copied rather than re-declared, so
 * the type scale stays the single source of truth.
 */
const tabular = (
  t: typeof type.moneyDisplay | typeof type.moneyLarge | typeof type.money | typeof type.moneySmall,
): TextStyle => ({
  fontSize: t.fontSize,
  lineHeight: t.lineHeight,
  fontWeight: t.fontWeight,
  fontVariant: [...t.fontVariant],
});

const SIZE_STYLE: Record<MoneySize, TextStyle> = {
  display: tabular(type.moneyDisplay),
  large: tabular(type.moneyLarge),
  default: tabular(type.money),
  small: tabular(type.moneySmall),
};

function resolveColor(colors: Palette, tone: MoneyTone, value?: number | null): string {
  // Profit and loss are a READING of a number, not an intent, so they are
  // derived from the live palette rather than captured at import.
  const moneyTone = moneyColors(colors);
  switch (tone) {
    case 'positive':
      return moneyTone.positive;
    case 'negative':
      return moneyTone.negative;
    case 'muted':
      return colors.text.secondary;
    case 'auto':
      if (value == null || value === 0) return moneyTone.neutral;
      return value > 0 ? moneyTone.positive : moneyTone.negative;
    default:
      return moneyTone.neutral;
  }
}

export function MoneyValue({
  value,
  size = 'default',
  tone = 'default',
  signed = false,
  fallback = ABSENT,
  showCurrency = true,
  accessibilityLabel,
  style,
  testID,
}: MoneyValueProps) {
  const colors = useColors();
  const styles = useStyles();
  const missing = value == null;
  const text = missing ? fallback : formatMoney(value, { signed, showCurrency });

  return (
    <View style={[styles.row, style]} testID={testID}>
      <Text
        style={[
          SIZE_STYLE[size],
          { color: missing ? colors.text.tertiary : resolveColor(colors, tone, value) },
        ]}
        accessibilityLabel={accessibilityLabel}
        numberOfLines={1}
        /**
         * Never shrink below legible. A long figure wins space from its
         * neighbours instead of quietly becoming unreadable at the counter.
         */
        adjustsFontSizeToFit={false}
      >
        {text}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    // Latin digits stay LTR even on an RTL screen; see the note above.
    flexDirection: 'row',
    alignItems: 'baseline',
  },
}));
