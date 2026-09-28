/**
 * Words that name a place or an action — a tab, the store, a shortcut — are never
 * cut (docs/61 §13). Money has its own fit (`money-fit.ts`); these are the words.
 *
 * Each kind stays whole in the way that suits it:
 *  - a tab's name has a fixed share of the bar and cannot wrap, so when it would not
 *    fit — large system text, a long translation — it is drawn just small enough to;
 *  - two actions side by side stand one above the other when either label would not
 *    fit its half of the row;
 *  - the store's name in a header wraps onto the next line.
 *
 * The widths come from the device (`TextMeasure`). Pure, so the rules are tested
 * without one.
 */

/** The navigator's own padding around a tab's icon and name, on each side. */
export const TAB_ITEM_PADDING = 5;

/** A shrunk name leaves this share of its room free, for rounding between measuring and drawing. */
export const FIT_MARGIN = 0.97;

/** The width a tab's name has: the bar shared equally by the tabs shown, less the tab's padding. */
export function tabLabelRoom(barWidth: number, tabs: number): number {
  if (!(barWidth > 0) || !(tabs > 0)) return 0;
  return barWidth / tabs - 2 * TAB_ITEM_PADDING;
}

/**
 * The scale a one-line name is drawn at: 1 when its width at full size fits the room
 * — the usual case, nothing changes — otherwise just small enough to fit. A width not
 * measured yet draws it as designed.
 */
export function labelScale(room: number, natural: number): number {
  if (!(room > 0) || !(natural > 0) || natural <= room) return 1;
  return Math.floor((room / natural) * FIT_MARGIN * 1000) / 1000;
}

/**
 * The width each of two side-by-side actions asks for, as a flex basis: the layout's
 * own `designed` breakpoint, or more when the widest label with its button around it
 * needs more — so a row that cannot hold both whole wraps one below the other.
 */
export function sideBySideBasis(designed: number, labelWidths: readonly number[], chrome: number): number {
  const widest = labelWidths.reduce((a, b) => Math.max(a, b), 0);
  return widest > 0 ? Math.max(designed, Math.ceil(widest + chrome)) : designed;
}
