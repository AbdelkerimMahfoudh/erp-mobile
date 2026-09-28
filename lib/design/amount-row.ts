import { space } from './tokens';

/**
 * A label beside an amount (docs/61 §8).
 *
 * Side by side while the amount needs at most half of the row. When it would
 * need more — a narrow phone, large system text, a long figure — the amount
 * moves below the label, on its own line, with the whole width of the row, and
 * the label keeps the width to be read. The label is never squeezed under half
 * the row, so it is never cut to a sliver or wrapped a letter at a time, and the
 * amount is never pushed against it.
 *
 * Plain flex — `flexWrap` with the label's basis at half the row — so the rule
 * holds on the phone and on the web alike, without measuring.
 */
export const AMOUNT_ROW = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  columnGap: space.md,
  rowGap: space.xs,
} as const;

/** The label's share: at least half the row, and whatever the amount leaves. */
export const AMOUNT_LABEL = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '50%',
  minWidth: 0,
} as const;
