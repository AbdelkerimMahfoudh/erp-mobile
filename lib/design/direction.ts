import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { layoutIsRTL } from './layout-direction';

/**
 * Layout direction helpers.
 *
 * Verified against this project's toolchain (NativeWind 4.2.6 / RN 0.81):
 *
 *  ✅ Logical SPACING utilities compile correctly and flip on their own —
 *     `ps-*`→`paddingStart`, `me-*`→`marginEnd`, `start-*`→`insetInlineStart`.
 *     Prefer them over `pl-*`/`mr-*`/`left-*`, which are physical and will not flip.
 *
 *  ✅ `flex-row` flips automatically once `I18nManager.isRTL` is true on
 *     native, and under the document's `dir="rtl"` on web.
 *
 *  Direction itself comes from `layoutIsRTL()` — never `I18nManager.isRTL`
 *  directly, which react-native-web never reports as true.
 *
 *  ❌ Logical TEXT ALIGNMENT does not survive compilation. NativeWind drops
 *     `text-align: start | end` with an `IncompatibleNativeValue` warning, so
 *     `text-start` silently produces no style at all. Text alignment therefore
 *     goes through `textAlign()` below (used by the `Text` primitive) and must
 *     never be expressed as a utility class.
 *
 *  ❌ Glyphs do not flip. Anything that points — chevrons, arrows, progress
 *     rails — must be mirrored explicitly with `mirror()`.
 */

export function isRTL(): boolean {
  return layoutIsRTL();
}

/**
 * Resolve a logical alignment to the physical one RN understands.
 * `start`/`end` mean "reading order", and flip with direction.
 */
export function textAlign(align: 'start' | 'end' | 'center' = 'start'): TextStyle['textAlign'] {
  if (align === 'center') return 'center';
  const rtl = layoutIsRTL();
  if (align === 'start') return rtl ? 'right' : 'left';
  return rtl ? 'left' : 'right';
}

/**
 * The paragraph direction of an editable field.
 *
 * On web an input with no direction resolves from its (empty) value and lays an
 * Arabic placeholder out left-to-right, scrambling the word order around a Latin
 * term like "IMEI". Identifiers stay LTR: they are not language.
 */
export function writingDirection(identifier = false): TextStyle['writingDirection'] {
  return !identifier && layoutIsRTL() ? 'rtl' : 'ltr';
}

/**
 * Mirror a directional glyph. Apply to chevrons, back arrows and anything else
 * whose meaning depends on which way it points — an icon saying "forward" must
 * point left in Arabic.
 *
 * Do NOT apply to icons that are merely asymmetric (a shopping cart, a camera);
 * those read as broken when flipped.
 */
export function mirror(): StyleProp<ViewStyle> {
  return layoutIsRTL() ? { transform: [{ scaleX: -1 }] } : undefined;
}

/**
 * Latin digits stay Latin.
 *
 * Mauritanian commerce writes prices in Western Arabic numerals even in Arabic
 * text, and an IMEI or serial is a machine identifier that must round-trip
 * exactly. This is a deliberate choice, recorded so nobody "fixes" it later.
 */
export const USE_LATIN_DIGITS = true;

/**
 * Force an isolated LTR run for a machine identifier.
 *
 * Without this, a 15-digit IMEI rendered inside an RTL paragraph can display
 * its segments in a confusing order when mixed with surrounding text. Wrapping
 * it in Unicode isolates pins it to LTR wherever it appears.
 */
export function isolateLtr(value: string): string {
  if (!layoutIsRTL()) return value;
  return `⁦${value}⁩`; // LRI … PDI
}
