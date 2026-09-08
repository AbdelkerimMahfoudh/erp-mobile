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

/**
 * The one accent. Indigo, matching the existing brand, splash and app icon.
 *
 * Re-anchored to the approved refresh: `600` is the primary `#5146D9` and `50`
 * is the selected-row wash `#EEECFC`. Both are slightly deeper and a touch more
 * violet than the steps they replace, which is what makes a pale selected row
 * read as *selected* rather than as a rendering artefact.
 *
 * Every step between them was re-cut to keep the ramp even, rather than pinning
 * the two approved values into an otherwise unchanged scale — a ramp with two
 * transplanted steps produces visible banding exactly where the accent is used
 * most. Measured, not eyeballed:
 *
 *   white on 600 ......... 6.51:1
 *   600 on white ......... 6.51:1
 *   600 on 50 ............ 5.59:1   (the checkmark on a selected row)
 *   600 on canvas ........ 6.13:1
 *   700 on white ......... 8.44:1   (pressed)
 */
const brand = {
  50: '#EEECFC',
  100: '#DEDBF8',
  200: '#C3BEF2',
  300: '#A29BEA',
  400: '#8B82EF',
  500: '#6358DE',
  600: '#5146D9',
  700: '#4238B8',
  800: '#362E95',
  900: '#2B2575',
} as const;

/** Neutrals — very slightly cool, which reads as "software" rather than "paper". */
const neutral = {
  0: '#FFFFFF',
  25: '#FBFCFD',
  /** The app background behind everything (approved refresh). */
  50: '#F7F8FB',
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
  /** The same fill while held down. Always a DARKER step, in both themes. */
  solidPressed: string;
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
    /** A raised control ON the inverse surface — a torch button over camera. */
    inverseRaised: string;
    inverseRaisedPressed: string;
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
    /** Quieter text on a solid brand fill — a count beside a chip's label. */
    onSolidMuted: string;
    accent: string;
    disabled: string;
  };
  brand: typeof brand;
  neutral: typeof neutral;
  intent: Record<'neutral' | 'info' | 'success' | 'warning' | 'danger', IntentColor>;
  /**
   * Flat names for the handful of roles that get referenced constantly.
   *
   * These are **aliases, not a second palette**. Every value below points at
   * something already defined above, so there is still exactly one place a
   * colour is decided. The reason they exist is that `intent.info.solid` is an
   * awkward way to say "the primary action colour", and an awkward name is how
   * a raw hex ends up in a screen instead.
   *
   * A component may use either vocabulary. What it may not do is invent a third.
   */
  semantic: {
    /** Primary action, selection, focus, navigation emphasis. */
    primary: string;
    /** The same, held down. Darker in both themes, never lighter. */
    primaryPressed: string;
    /** The pale wash behind a selected row or chip. */
    primarySoft: string;
    /** Text and icons that sit on `primary`. */
    onPrimary: string;
    /** The app background behind everything. */
    background: string;
    /** Cards, sheets, rows — the reading surface. */
    surface: string;
    /** A surface lifted above another surface. */
    surfaceRaised: string;
    /** Outlines that need to be seen. */
    border: string;
    /** Hairlines between list rows. Quieter than `border` on purpose. */
    divider: string;
    /** Primary reading text. */
    text: string;
    /** Supporting text. */
    textMuted: string;
    /** Completed or confirmed. Never "probably worked". */
    success: string;
    /** Pending, low stock, needs attention. */
    warning: string;
    /** Errors, destructive actions, invalid data. */
    danger: string;
    /** Informational. */
    info: string;
    /** Unavailable controls and their text. */
    disabled: string;
  };
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
    /**
     * Controls sitting ON that dark chrome. Translucent white so the camera
     * shows through, which is the point — and identical in both themes,
     * because the camera view is dark whatever the app is set to.
     */
    inverseRaised: 'rgba(255, 255, 255, 0.14)',
    inverseRaisedPressed: 'rgba(255, 255, 255, 0.24)',
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
    /**
     * Headings and the numbers that matter.
     *
     * Its own value rather than `neutral[900]`: the approved text colour is a
     * touch cooler and deeper than that step, and `neutral[900]` is also the
     * DARK card surface — moving it would have repainted dark mode as a side
     * effect. 16.27:1 on a card, 15.32:1 on the canvas.
     */
    primary: '#172033',
    /** Supporting copy, list subtitles. */
    secondary: neutral[600],
    /**
     * Labels, timestamps, metadata. Never for anything actionable.
     *
     * Its own value rather than `neutral[500]`: on the canvas that step came
     * to 2.9:1, and this text carries real explanation — the line under a
     * setting saying what it does — not decoration.
     */
    tertiary: '#828B9B',
    /**
     * Placeholder text only — deliberately quieter than real content, but not
     * so quiet it disappears. A shop counter is often in direct sunlight, and
     * the previous value (neutral[400]) sat at 1.8:1 against an input well,
     * which is invisible there.
     */
    placeholder: neutral[500],
    /** On a solid dark/brand fill. */
    inverse: neutral[0],
    onSolidMuted: brand[100],
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
      solidPressed: neutral[900],
      onSolid: neutral[0],
    },
    info: {
      bg: brand[50],
      border: brand[100],
      fg: brand[700],
      solid: brand[600],
      solidPressed: brand[700],
      onSolid: neutral[0],
    },
    success: {
      bg: '#E7F6F0',
      border: '#C4E9DA',
      fg: '#0B6B4F',
      solid: '#0F7B5F',
      solidPressed: '#0B6B4F',
      onSolid: neutral[0],
    },
    warning: {
      bg: '#FDF3E4',
      border: '#F7E1BE',
      fg: '#8A5209',
      solid: '#A85F0B',
      solidPressed: '#8A5209',
      onSolid: neutral[0],
    },
    danger: {
      bg: '#FCECEA',
      border: '#F6D2CD',
      fg: '#A32C23',
      solid: '#C0362C',
      solidPressed: '#A32C23',
      onSolid: neutral[0],
    },
  },

  /** Aliases onto the values above — see `Palette['semantic']`. */
  semantic: {
    primary: brand[600],
    primaryPressed: brand[700],
    primarySoft: brand[50],
    onPrimary: neutral[0],
    background: neutral[50],
    surface: neutral[0],
    /**
     * On white, "raised" cannot be a lighter fill — there is nothing lighter.
     * It stays white and is lifted by the elevation tokens instead, which is
     * why this is not simply `neutral[25]`.
     */
    surfaceRaised: neutral[0],
    border: neutral[300],
    /** A step quieter than `border`: 200 rows separated by 300 reads as a grid. */
    divider: neutral[200],
    text: '#172033',
    textMuted: neutral[600],
    success: '#1F7A5A',
    warning: '#9A5B00',
    danger: '#C0362C',
    info: brand[600],
    disabled: neutral[400],
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
    /**
     * The camera's chrome, which is dark whatever the app is set to — a live
     * camera view is not repainted by a theme. Kept identical to light.
     */
    inverse: neutral[950],
    inverseRaised: 'rgba(255, 255, 255, 0.14)',
    inverseRaisedPressed: 'rgba(255, 255, 255, 0.24)',
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
    /** Same reasoning as light: quiet, still legible. */
    placeholder: '#6E7889',
    /**
     * Deliberately NOT flipped.
     *
     * Every caller means "on a solid brand fill" — a primary button, a
     * selected chip, the camera chrome — and a brand button is brand-coloured
     * in both themes. Flipping this to a dark neutral would have put dark text
     * on an indigo button after dark: a real contrast failure, and one that
     * reads as a plausible "inverse" at a glance, which is why it is spelled
     * out here.
     */
    inverse: neutral[0],
    onSolidMuted: brand[100],
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
      solidPressed: neutral[300],
      onSolid: neutral[900],
    },
    info: {
      bg: '#191C3D',
      border: '#2C2F63',
      fg: brand[300],
      solid: brand[600],
      solidPressed: brand[700],
      onSolid: neutral[0],
    },
    success: {
      bg: '#0D2A21',
      border: '#1B4436',
      fg: '#6EE7B7',
      solid: '#0F7B5F',
      solidPressed: '#0B6B4F',
      onSolid: neutral[0],
    },
    warning: {
      bg: '#2C1D08',
      border: '#4A3312',
      fg: '#F0C07A',
      solid: '#A85F0B',
      solidPressed: '#8A5209',
      onSolid: neutral[0],
    },
    danger: {
      bg: '#2C1412',
      border: '#4C201C',
      fg: '#F2A49B',
      solid: '#C0362C',
      solidPressed: '#A32C23',
      onSolid: neutral[0],
    },
  },

  /**
   * Aliases again — and the easiest place to check that "dark mode is not an
   * inversion" is actually true.
   *
   * `primary` is a LIGHT indigo here, because the readable accent has to sit on
   * near-black; `primarySoft` is a deep indigo, not the light theme's `#EEECFC`
   * placed over a dark card. Success stays green, warning amber, danger red —
   * the meanings do not move, only the lightness relationship does.
   *
   *   primary on surface ... 6.91:1
   *   primary on soft ...... 6.60:1
   *   white on solid ....... 6.51:1
   */
  semantic: {
    primary: brand[300],
    primaryPressed: brand[400],
    primarySoft: '#191C3D',
    onPrimary: neutral[0],
    background: dark.canvas,
    surface: dark.card,
    /** Lighter than the card, because after dark, lift IS lightness. */
    surfaceRaised: dark.hover,
    border: dark.borderDefault,
    divider: dark.border,
    text: neutral[100],
    textMuted: neutral[400],
    success: '#6EE7B7',
    warning: '#F0B357',
    danger: '#F2A49B',
    info: brand[300],
    disabled: neutral[600],
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
