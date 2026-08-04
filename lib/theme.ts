/**
 * TEMPORARY compatibility layer for the pre-design-system screens.
 *
 * The real tokens live in `lib/design/` — `colors.ts` for semantic colour,
 * `tokens.ts` for spacing/shape/type. This module keeps the old flat shape
 * (`colors.brand` as a string, `money()`, `num()`) alive so the twelve screens
 * built before Phase 1 keep rendering while they are rebuilt one at a time.
 *
 * New code must import from `lib/design/colors`, `lib/design/tokens` and
 * `lib/format`. This file is deleted with the last legacy screen.
 *
 * @deprecated
 */

import { colors as palette } from './design/colors';
import { formatMoney, formatNumber } from './format';

/** @deprecated Use `colors` from `lib/design/colors`. */
export const colors = {
  brand: palette.brand[600],
  brandDark: palette.brand[700],
  brandLight: palette.brand[50],
  bg: palette.surface.canvas,
  card: palette.surface.card,
  text: palette.text.primary,
  sub: palette.text.secondary,
  muted: palette.text.tertiary,
  border: palette.border.subtle,
  emerald: palette.intent.success.fg,
  red: palette.intent.danger.fg,
  amber: palette.intent.warning.fg,
  white: palette.neutral[0],
};

/** @deprecated Use `<StatusChip domain="tracking" />`, which is translated. */
export const trackingLabel: Record<string, string> = {
  imei: 'IMEI',
  serial: 'Serial',
  quantity: 'Quantity',
};

/**
 * @deprecated Use `formatMoney` from `lib/format`.
 *
 * Now carries the MRU currency code, so legacy screens show the right currency
 * even before they are rebuilt. One exception remains: `app/(tabs)/sell.tsx`
 * renders a hardcoded `$` beside its price input — that is fixed when Sell is
 * rebuilt in Phase 2.
 */
export function money(v?: number | null): string {
  return formatMoney(v);
}

/** @deprecated Use `formatNumber` / `formatQuantity` from `lib/format`. */
export function num(v?: number | null): string {
  return formatNumber(v);
}
