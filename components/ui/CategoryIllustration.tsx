import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import {
  Cable,
  Camera,
  CardSim,
  Gamepad2,
  HardDrive,
  Headphones,
  Laptop,
  Microchip,
  Monitor,
  Package,
  PcCase,
  PlugZap,
  Printer,
  Router,
  Smartphone,
  BatteryCharging,
  Speaker,
  Tablet,
  Tv,
  Watch,
} from 'lucide-react-native';
import {
  illustrationFor,
  type CategoryIllustration as Illustration,
  type CategoryVisualInput,
} from '../../lib/category-illustration';
import type { IconComponent } from './Button';

/**
 * The drawings behind `lib/category-illustration.ts` (D225).
 *
 * Twenty of the twenty-four come from the icon set the rest of the app uses, so every picture shares one
 * stroke, one corner and one weight. The four the set does not have — a games console, earbuds, a screen
 * protector and a phone case — are drawn here on the same 24-point grid with the same 2-point round stroke,
 * so they sit beside the others as one family. Each is distinct: a console is never a desktop, a
 * controller is never a console, earbuds are never headphones, a case is never the phone it protects.
 */

type GlyphProps = { color?: string; size?: number };

function Glyph({ color = 'currentColor', size = 24, children }: GlyphProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

/** A low, wide games console: the body, its disc slot and its power light, on a small foot. */
export function ConsoleGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <Rect x={2} y={7} width={20} height={10} rx={2} />
      <Path d="M6 11h7" />
      <Circle cx={17.5} cy={12} r={1} />
      <Path d="M7 17v2M17 17v2" />
    </Glyph>
  );
}

/** Two earbuds, each a bud and its stem. */
export function EarbudsGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <Circle cx={7} cy={8} r={3} />
      <Path d="M8.5 10.6V19" />
      <Circle cx={17} cy={8} r={3} />
      <Path d="M15.5 10.6V19" />
    </Glyph>
  );
}

/** A screen with a sheet of glass lifted at one corner, and the glint across it. */
export function ScreenProtectorGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <Rect x={5} y={2} width={14} height={20} rx={2} />
      <Path d="M9 7l5-3M9 12l7-4" />
      <Path d="M5 17l5 5" />
    </Glyph>
  );
}

/** A phone case seen from the back: rounded shell and the camera cut-out. */
export function CaseGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <Rect x={5} y={2} width={14} height={20} rx={3.5} />
      <Rect x={8} y={5} width={5} height={5} rx={1.5} />
      <Path d="M12 18h.01" />
    </Glyph>
  );
}

/** Every illustration's drawing. Typed as a total record, so a new name cannot ship without one. */
export const ILLUSTRATION_ICONS: Readonly<Record<Illustration, IconComponent>> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  desktop: PcCase,
  monitor: Monitor,
  console: ConsoleGlyph,
  controller: Gamepad2,
  tv: Tv,
  earbuds: EarbudsGlyph,
  headphones: Headphones,
  smartwatch: Watch,
  speaker: Speaker,
  camera: Camera,
  router: Router,
  charger: PlugZap,
  cable: Cable,
  powerbank: BatteryCharging,
  storage: HardDrive,
  sim: CardSim,
  screen_protector: ScreenProtectorGlyph,
  case: CaseGlyph,
  printer: Printer,
  electronics: Microchip,
  accessory: Package,
};

export function CategoryIllustrationIcon({ name, color, size }: GlyphProps & { name: Illustration }) {
  const Icon = ILLUSTRATION_ICONS[name] ?? ILLUSTRATION_ICONS.electronics;
  return <Icon color={color} size={size} />;
}

/**
 * The drawing for a product row that takes an icon rather than a node — a picker's `leading`, a list row —
 * resolved from the product's category the one way every screen does (D225).
 */
export function illustrationIconFor(visual: CategoryVisualInput | null | undefined, trackingType?: string | null): IconComponent {
  return ILLUSTRATION_ICONS[illustrationFor(visual, trackingType)];
}
