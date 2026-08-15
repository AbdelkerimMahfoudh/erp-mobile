/**
 * Semantic colour. Components reference *meaning* (`text.secondary`,
 * `intent.danger.fg`), never a raw hex or a palette step.
 *
 * Two rules this file exists to enforce:
 *  1. Colour carries meaning, never decoration. There is one accent; everything
 *     else is neutral until something needs to *say* success/warning/danger.
 *  2. Colour is never the only signal — every status also carries a word.
 *     See `status.ts`, which pairs each tone with a label.
 */

/** The one accent. Indigo, matching the existing brand, splash and app icon. */
const brand = {
  50: '#EEF1FE',
  100: '#E0E5FD',
  200: '#C6CEFB',
  300: '#A3AEF7',
  400: '#818CF8',
  500: '#6366F1',
  600: '#4F46E5',
  700: '#4338CA',
  800: '#3730A3',
  900: '#2E2A7D',
} as const;

/** Neutrals — very slightly cool, which reads as "software" rather than "paper". */
const neutral = {
  0: '#FFFFFF',
  25: '#FBFCFD',
  50: '#F7F8FA',
  100: '#F1F3F6',
  200: '#E7EAEF',
  300: '#D8DDE5',
  400: '#AFB7C4',
  500: '#8A93A2',
  600: '#5F6877',
  700: '#434C5A',
  800: '#2A3240',
  900: '#151B26',
  950: '#0B0F17',
} as const;

interface IntentColor {
  /** Tinted background for chips, banners, subtle fills. */
  bg: string;
  /** Hairline border that sits on `bg`. */
  border: string;
  /** Text/icon colour that sits on `bg`. Contrast-checked against it. */
  fg: string;
  /** Solid fill for buttons and strong emphasis. */
  solid: string;
  /** Text/icon colour that sits on `solid`. */
  onSolid: string;
}

export const colors = {
  /** Page and container backgrounds. */
  surface: {
    /** The app background behind everything. */
    canvas: neutral[50],
    /** Cards, sheets, headers — the raised reading surface. */
    card: neutral[0],
    /** Recessed areas: input wells, inactive segments, code blocks. */
    sunken: neutral[100],
    /** Hover/press wash over a card. */
    hover: neutral[100],
    /** Full-bleed dark surface — camera scanner chrome, image backdrops. */
    inverse: neutral[950],
    /** Scrim behind modals and sheets. */
    scrim: 'rgba(11, 15, 23, 0.55)',
  },

  border: {
    /** Default hairline. Most separation in the app is this. */
    subtle: neutral[200],
    /** Input outlines and card edges that need to be seen. */
    default: neutral[300],
    /** Selected outlines and emphasised edges. */
    strong: neutral[400],
    /**
     * Keyboard/assistive focus ring. The accent, not a neutral: a focus ring
     * has to be findable at a glance on a busy screen, and it is the one place
     * where colour genuinely is the signal — so it is also drawn thicker than a
     * hairline rather than relying on hue alone.
     */
    focus: brand[500],
    /** Border on the inverse surface. */
    inverse: 'rgba(255, 255, 255, 0.16)',
  },

  text: {
    /** Headings and the numbers that matter. */
    primary: neutral[900],
    /** Supporting copy, list subtitles. */
    secondary: neutral[600],
    /** Labels, timestamps, metadata. Never for anything actionable. */
    tertiary: neutral[500],
    /** Placeholder text only. Fails contrast for real content by design. */
    placeholder: neutral[400],
    /** On a solid dark/brand fill. */
    inverse: neutral[0],
    /** The accent, for links and active states. */
    accent: brand[600],
    /** Disabled text. */
    disabled: neutral[400],
  },

  /** The accent ramp, for the rare case a component needs a specific step. */
  brand,
  neutral,

  /**
   * Intents. `info` is the accent restated as an intent so a component can take
   * a single `tone` prop and never special-case the brand.
   */
  intent: {
    neutral: {
      bg: neutral[100],
      border: neutral[200],
      fg: neutral[700],
      solid: neutral[800],
      onSolid: neutral[0],
    },
    info: {
      bg: brand[50],
      border: brand[100],
      fg: brand[700],
      solid: brand[600],
      onSolid: neutral[0],
    },
    success: {
      bg: '#E7F6F0',
      border: '#C4E9DA',
      fg: '#0B6B4F',
      solid: '#0F7B5F',
      onSolid: neutral[0],
    },
    warning: {
      bg: '#FDF3E4',
      border: '#F7E1BE',
      fg: '#8A5209',
      solid: '#B4690E',
      onSolid: neutral[0],
    },
    danger: {
      bg: '#FCECEA',
      border: '#F6D2CD',
      fg: '#A32C23',
      solid: '#C0362C',
      onSolid: neutral[0],
    },
  } satisfies Record<string, IntentColor>,
} as const;

export type Intent = keyof typeof colors.intent;

/** Money is not an intent — profit/loss is a *reading* of a number. */
export const money = {
  positive: colors.intent.success.fg,
  negative: colors.intent.danger.fg,
  neutral: colors.text.primary,
} as const;
