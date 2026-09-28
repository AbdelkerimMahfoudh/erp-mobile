import React, { useState } from 'react';
import { Platform, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { moneyColors, type Palette } from '../../lib/design/colors';
import { type } from '../../lib/design/tokens';
import { ABSENT } from '../../lib/format';
import { breakableNumber, joinMoney, moneyParts } from '../../lib/money-format';
import { FULL, fitMoney, nextRoom, shrinkFloor } from '../../lib/money-fit';
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
 * **Never cut** (docs/61 §8). A financial amount keeps every digit, its sign,
 * its decimals and the whole `MRU`; nothing ends in "…". When the width is
 * short — a narrow phone, large system text, a long figure — it shrinks a
 * little (never below the app's floor or body size), then puts `MRU` on the
 * next line, and only as a last resort breaks the number between digit groups
 * (`lib/money-fit.ts`). The widths come from the device: the figure's own box,
 * and the number and whole figure measured at full size by an invisible copy.
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
  /** Decimal places; whole units unless a set of figures must visibly add up with its cents. */
  decimals?: number;
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

interface Measured {
  /** The text and size the widths belong to: a new figure is measured afresh. */
  key: string;
  /** The room the figure may use. */
  room: number;
  /** The signed number at full size, on one line. */
  number: number;
  /** The whole figure (number, space, currency) at full size, on one line. */
  inline: number;
}

export function MoneyValue({
  value,
  size = 'default',
  tone = 'default',
  signed = false,
  fallback = ABSENT,
  showCurrency = true,
  decimals,
  accessibilityLabel,
  style,
  testID,
}: MoneyValueProps) {
  const colors = useColors();
  const styles = useStyles();
  const missing = value == null;
  const parts = missing ? null : moneyParts(value, { signed, showCurrency, decimals });
  const whole = parts ? joinMoney(parts) : fallback;
  const base = SIZE_STYLE[size];

  const key = `${size}|${whole}`;
  const [measured, setMeasured] = useState<Measured>({ key, room: 0, number: 0, inline: 0 });
  const m = measured.key === key ? measured : { key, room: 0, number: 0, inline: 0 };
  const fit = parts && m.number > 0 && m.inline > 0 && m.room > 0
    ? fitMoney(m.room, m.number, m.inline, shrinkFloor(base.fontSize as number, type.body.fontSize))
    : FULL;
  const update = (patch: Partial<Omit<Measured, 'key'>>) =>
    setMeasured((prev) => {
      const from = prev.key === key ? prev : { key, room: 0, number: 0, inline: 0 };
      const next = { ...from, ...patch };
      return next.room === prev.room && next.number === prev.number && next.inline === prev.inline && prev.key === key ? prev : next;
    });
  const width = (e: LayoutChangeEvent) => e.nativeEvent.layout.width;

  const text = !parts
    ? fallback
    : fit.currencyBelow
      ? `${fit.wrapNumber ? breakableNumber(parts.number) : parts.number}\n${parts.currency}`
      : fit.wrapNumber
        ? breakableNumber(parts.number)
        : whole;
  const scaled: TextStyle | null =
    fit.scale === 1 ? null : { fontSize: (base.fontSize as number) * fit.scale, lineHeight: (base.lineHeight as number) * fit.scale };

  return (
    <View
      style={[styles.row, style]}
      testID={testID ?? 'money-value'}
      onLayout={parts ? (e) => update({ room: nextRoom(m.room, width(e), fit, m.number, m.inline) }) : undefined}
    >
      <Text
        style={[base, scaled, { color: missing ? colors.text.tertiary : resolveColor(colors, tone, value) }]}
        // Read as one figure however it is laid out.
        accessibilityLabel={accessibilityLabel ?? (text === whole ? undefined : whole)}
      >
        {text}
      </Text>
      {parts ? (
        // The figure at full size on one line, never shown or read: its widths decide the fit above.
        <View
          style={styles.measure}
          pointerEvents="none"
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.measureLine}>
            <Text style={base} onLayout={(e) => update({ number: width(e) })}>
              {parts.number}
            </Text>
            <Text style={base} onLayout={(e) => update({ inline: width(e) })}>
              {whole}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  row: {
    // Latin digits stay LTR even on an RTL screen; see the note above.
    flexDirection: 'row',
    alignItems: 'baseline',
    // Never wider than the space it is given: a figure that does not fit is fitted, not pushed out of its card.
    maxWidth: '100%',
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
    opacity: 0,
    // On the web, also out of the page's text and its accessibility tree.
    ...(Platform.OS === 'web' ? ({ visibility: 'hidden' } as object) : null),
  },
  measureLine: { position: 'absolute', top: 0, left: 0, width: 100000, alignItems: 'flex-start' },
}));
