/**
 * Semantic colour. Components reference *meaning* (`text.secondary`,
 * `intent.danger.fg`), never a raw hex or a palette step.
 *
 * Three rules this file exists to enforce:
 *  1. Colour carries meaning, never decoration. There is one accent; everything
 *     else is neutral until something needs to *say* success/warning/danger.
 *  2. Colour is never the only signal — every status also carries a word.
 *     See `status.ts`, which pairs each tone with a label.
 *  3. **Both themes mean the same things.** Dark mode is not an inversion:
 *     success stays green, danger stays red, warning stays amber. Only the
 *     lightness relationship flips, so a shopkeeper reading a figure at night
 *     reads it the same way they did that morning.
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

/**
 * Dark-mode surface steps.
 *
 * Elevation in the dark is carried by lightness, not by shadow: a card must be
 * *lighter* than the canvas behind it, because a shadow on a near-black
 * background is invisible. These sit between `neutral[900]` and `neutral[800]`
 * so a card, a sunken well and a pressed row stay distinguishable without any
 * of them reading as grey-on-grey.
 */
const dark = {
  canvas: '#0B0F17',
  card: '#151B26',
  sunken: '#1C2431',
  hover: '#222B3A',
  border: '#232B38',
  borderStrong: '#414B5C',
  borderDefault: '#2E3746',
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

export interface Palette {
  surface: {
    canvas: string;
    card: string;
    sunken: string;
    hover: string;
    inverse: string;
    scrim: string;
  };
  border: {
    subtle: string;
    default: string;
    strong: string;
    focus: string;
    inverse: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    placeholder: string;
    inverse: string;
    accent: string;
    disabled: string;
  };
  brand: typeof brand;
  neutral: typeof neutral;
  intent: Record<'neutral' | 'info' | 'success' | 'warning' | 'danger', IntentColor>;
}

export const lightColors: Palette = {
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
  },
};

/**
 * The same vocabulary, after dark.
 *
 * Every key means exactly what it meant in the light palette — that is the
 * point of a semantic layer. What changes is which end of the lightness scale
 * each role sits at, and the intent tints, which become deep washes with light
 * text rather than pale washes with dark text.
 *
 * Text is never dimmed with opacity here. Stacking translucent layers is how
 * secondary text quietly falls below a readable contrast on one surface while
 * passing on another; every text role is a solid colour chosen against the
 * surface it sits on.
 */
export const darkColors: Palette = {
  surface: {
    canvas: dark.canvas,
    card: dark.card,
    sunken: dark.sunken,
    hover: dark.hover,
    /** Still the *opposite* of the current surface — so it is light here. */
    inverse: neutral[0],
    /** Deeper than the light scrim: it sits over an already-dark app. */
    scrim: 'rgba(0, 0, 0, 0.66)',
  },

  border: {
    subtle: dark.border,
    default: dark.borderDefault,
    strong: dark.borderStrong,
    /** A brighter step than light mode — brand[500] is muddy on near-black. */
    focus: brand[400],
    inverse: 'rgba(0, 0, 0, 0.20)',
  },

  text: {
    /** Not pure white: #FFF on near-black glares and smears on OLED. */
    primary: neutral[100],
    secondary: neutral[400],
    tertiary: neutral[500],
    placeholder: neutral[600],
    /** On a solid light fill. */
    inverse: neutral[900],
    /** Lifted so a link is legible on the dark canvas. */
    accent: brand[300],
    disabled: neutral[600],
  },

  brand,
  neutral,

  intent: {
    neutral: {
      bg: dark.sunken,
      border: dark.borderDefault,
      fg: neutral[300],
      solid: neutral[200],
      onSolid: neutral[900],
    },
    info: {
      bg: '#191C3D',
      border: '#2C2F63',
      fg: brand[300],
      solid: brand[600],
      onSolid: neutral[0],
    },
    success: {
      bg: '#0D2A21',
      border: '#1B4436',
      fg: '#6EE7B7',
      solid: '#0F7B5F',
      onSolid: neutral[0],
    },
    warning: {
      bg: '#2C1D08',
      border: '#4A3312',
      fg: '#F0C07A',
      solid: '#B4690E',
      onSolid: neutral[0],
    },
    danger: {
      bg: '#2C1412',
      border: '#4C201C',
      fg: '#F2A49B',
      solid: '#C0362C',
      onSolid: neutral[0],
    },
  },
};

export type ThemeName = 'light' | 'dark';

export const PALETTES: Record<ThemeName, Palette> = {
  light: lightColors,
  dark: darkColors,
};

/**
 * The light palette, as a plain static object.
 *
 * @deprecated Use `useColors()` or `makeStyles()` — a static import cannot
 * follow the theme, because a module-scope `StyleSheet.create` captures these
 * values once, at import, and never reads them again. This export remains only
 * so `lib/theme.ts` (itself deprecated) keeps compiling. A drift test refuses
 * any *new* screen that reaches for it.
 */
export const colors = lightColors;

export type Intent = keyof Palette['intent'];

/** Money is not an intent — profit/loss is a *reading* of a number. */
export function moneyColors(palette: Palette) {
  return {
    positive: palette.intent.success.fg,
    negative: palette.intent.danger.fg,
    neutral: palette.text.primary,
  } as const;
}

/** @deprecated Light-only. Use `moneyColors(useColors())`. */
export const money = moneyColors(lightColors);
