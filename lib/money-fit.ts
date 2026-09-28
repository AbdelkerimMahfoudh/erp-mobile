/**
 * How a money figure fits the width it is given (docs/61 §8). A financial amount
 * is never cut: every digit, its sign, its decimals and the whole `MRU` stay on
 * screen, and nothing is replaced by "…".
 *
 * In order, the first that fits:
 * 1. **One line, full size.**
 * 2. **One line, a little smaller** — down to the app's established floor for a
 *    fitted figure (`StatTile`'s `minimumFontScale`, 0.7), and never below
 *    body size.
 * 3. **`MRU` on the next line** — the number alone on the first, full size or
 *    shrunk no further than that same floor.
 * 4. **The number broken between its digit groups** at the floor, `MRU` below
 *    — only for a figure too long for the width even then.
 *
 * Pure, so each step is tested without a phone. The widths are measured on the
 * device: the figure's own box, and the natural width of the number and of the
 * whole figure at full size.
 */

/** The smallest a fitted figure may be drawn, relative to its size — the app's established strategy (StatTile). */
export const ESTABLISHED_MIN_SCALE = 0.7;

export interface MoneyFit {
  scale: number;
  currencyBelow: boolean;
  wrapNumber: boolean;
}

export const FULL: MoneyFit = Object.freeze({ scale: 1, currencyBelow: false, wrapNumber: false });

export const isFull = (fit: MoneyFit): boolean => fit.scale === 1 && !fit.currencyBelow && !fit.wrapNumber;

/** How far a figure of this size may shrink: the established floor, never below body size, never above full size. */
export function shrinkFloor(fontSize: number, bodyFontSize: number): number {
  return Math.min(1, Math.max(ESTABLISHED_MIN_SCALE, bodyFontSize / fontSize));
}

/** A fit is never larger than the room: rounded down. */
const down = (x: number) => Math.floor(x * 100) / 100;

/** Sub-pixel differences between two measurements of the same text are not a lack of room. */
const TOLERANCE = 1;

/**
 * @param room   the width the figure may use
 * @param number the signed number's natural width at full size
 * @param inline the whole figure's natural width at full size (number, space, `MRU`); equal to `number` without currency
 * @param floor  the smallest scale allowed (`shrinkFloor`)
 */
export function fitMoney(room: number, number: number, inline: number, floor: number): MoneyFit {
  if (!(room > 0) || !(number > 0) || !(inline > 0)) return FULL;
  if (inline <= room + TOLERANCE) return FULL;
  const inlineScale = down(room / inline);
  if (inlineScale >= floor) return { scale: inlineScale, currencyBelow: false, wrapNumber: false };
  const hasCurrency = inline > number + TOLERANCE;
  if (!hasCurrency) return { scale: floor, currencyBelow: false, wrapNumber: true };
  const aloneScale = number <= room + TOLERANCE ? 1 : down(room / number);
  if (aloneScale >= floor) return { scale: aloneScale, currencyBelow: true, wrapNumber: false };
  return { scale: floor, currencyBelow: true, wrapNumber: true };
}

/** The width the fitted figure takes — what a box that hugs it will report; null when it wraps to the room. */
export function fittedWidth(fit: MoneyFit, number: number, inline: number): number | null {
  if (fit.wrapNumber) return null;
  return (fit.currencyBelow ? number : inline) * fit.scale;
}

/**
 * The room after the figure's box reports a width.
 *
 * A figure alone in a card is stretched to the card: its box is the room. A
 * figure at the end of a row hugs its own text, so once it has been fitted its
 * box only echoes the fitted figure and says nothing about the space around it —
 * taking that as the room would shrink it again on every layout. So a fitted
 * figure's room changes only when the box is clearly larger than the room (more
 * space arrived) or clearly narrower than the fitted figure (it was squeezed).
 */
export function nextRoom(room: number, box: number, fit: MoneyFit, number: number, inline: number): number {
  if (isFull(fit) || room <= 0) return box;
  if (box > room + TOLERANCE) return box;
  const shown = fittedWidth(fit, number, inline);
  if (shown !== null && box < shown - 2 * TOLERANCE) return box;
  return room;
}
