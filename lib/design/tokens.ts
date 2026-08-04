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
} as const;

export type TypeVariant = keyof typeof type;

/**
 * Minimum interactive size. The app is used one-handed, at a counter, in a
 * hurry, often with a case on the phone — nothing tappable goes below this.
 */
export const touch = {
  min: 48,
  comfortable: 56,
  large: 64,
} as const;

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
/** Opacity applied to anything disabled. */
export const disabledOpacity = 0.4;
