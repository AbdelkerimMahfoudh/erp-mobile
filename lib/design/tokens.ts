/**
 * Design tokens — the single source of truth for spacing, shape, type and motion.
 *
 * Rule: components consume tokens; screens consume components. A screen should
 * never need a raw number. If a value is missing here, add it here.
 */

/** 4pt base grid. Every gap, pad and inset resolves to one of these. */
export const space = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  '5xl': 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 9999,
} as const;

/**
 * Type scale. Sizes are deliberately few — a shop counter needs legibility, not
 * variety. `display` is for the one focal number per screen (total, profit).
 */
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  mono: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /**
   * Money. Three weights for three jobs: the one focal figure on a screen, a
   * supporting figure in a row, and a metadata figure beside a label.
   *
   * All three are `tabular-nums`, which is the whole reason they exist as
   * separate variants. Proportional digits make a column of prices ragged, so
   * comparing two totals means reading them instead of glancing. Money is the
   * one thing in this app people compare vertically, every day.
   *
   * Latin digits are used in Arabic too — see `MoneyValue` for why.
   */
  moneyDisplay: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  money: { fontSize: 17, lineHeight: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  moneySmall: { fontSize: 15, lineHeight: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
} as const;

export type TypeVariant = keyof typeof type;

/**
 * Icon sizing. Icons pair with text, so these track the type scale rather than
 * forming their own: `sm` sits with `caption`/`label`, `md` with `body`, `lg`
 * with `heading`, `xl` for an empty state's illustration.
 */
export const icon = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;


/**
 * Minimum interactive size. The app is used one-handed, at a counter, in a
 * hurry, often with a case on the phone — nothing tappable goes below this.
 */
export const touch = {
  min: 48,
  comfortable: 56,
  large: 64,
} as const;

/**
 * Density. A counter needs to see more rows at once; a form needs room to tap.
 * `comfortable` is the default — `compact` is opt-in for long lists.
 *
 * Note what does NOT change: the minimum row height. Density adjusts breathing
 * room, never the tappable area, so a dense list is still usable one-handed
 * with a case on the phone.
 */
export const density = {
  comfortable: { rowMinHeight: touch.min, rowPaddingY: space.md, gap: space.md },
  compact: { rowMinHeight: touch.min, rowPaddingY: space.sm, gap: space.sm },
} as const;

export type Density = keyof typeof density;

/** Motion. Short and unfussy; this is business software, not a toy. */
export const duration = {
  instant: 100,
  fast: 160,
  base: 240,
  slow: 320,
} as const;

/**
 * Elevation. Used sparingly — flat surfaces with a hairline border read as more
 * professional than drop shadows. Reserved for genuinely floating things
 * (sheets, toasts, FABs).
 */
export const elevation = {
  none: {},
  /**
   * The faintest possible lift — a selected segment sitting proud of its track.
   * Not for cards: if something needs to look separate from the page, it wants
   * a border, not a shadow.
   */
  xs: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sm: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  lg: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
} as const;

/** Opacity applied to a pressable while held. */
export const pressedOpacity = 0.72;

/**
 * Opacity applied to anything disabled.
 *
 * Raised from 0.4, which was not survivable when it compounded. A control that
 * dimmed its container to 0.4 *and* drew its label in `text.disabled` produced
 * roughly 1.3:1 against the card — text that is not merely low-contrast but
 * effectively absent. A disabled control still has to be readable: the user
 * needs to know what they cannot do, and why.
 *
 * The rule that goes with this number: **dim the container or use the disabled
 * text colour, never both.**
 */
export const disabledOpacity = 0.55;
