/**
 * The Dukan ERP identity as data (the owner's approved logo pack, Dukan-ERP-Logo-Pack, 2026-11-04): which artwork, which
 * colours on which surface, and the launch animation's timing — the pack's README, as numbers. The paths themselves are
 * the pack's (`lib/brand-pack.ts`, generated). Pure, so a node test can hold it to the contract without a renderer.
 */
import { PACK, PACK_COLOURS } from './brand-pack.ts';

export { PACK, PACK_COLOURS };

export type MarkTone = 'light' | 'dark' | 'mono';

/**
 * The pack's artwork is for dark surfaces (white lettering, the accent swoosh). On light, the same artwork with its
 * lettering in launch navy (owner, 2026-11-04); the accent never changes. `mono` draws both in one ink.
 */
export function markColours(tone: MarkTone, mono = '#000000'): { lettering: string; accent: string } {
  if (tone === 'mono') return { lettering: mono, accent: mono };
  return tone === 'dark' ? { lettering: PACK_COLOURS.lettering, accent: PACK_COLOURS.accent } : { lettering: PACK_COLOURS.lightLettering, accent: PACK_COLOURS.accent };
}

/** The pack's tone for the surface's theme: decided here, in the brand layer, never by a screen (lib/design/theme.test.ts). */
export function toneFor(dark: boolean): Exclude<MarkTone, 'mono'> {
  return dark ? 'dark' : 'light';
}

/** The fill a pack layer takes in a tone: its white becomes the tone's lettering, its accent stays the accent. */
export function layerFill(fill: string, tone: { lettering: string; accent: string }): string {
  return fill.toUpperCase() === PACK_COLOURS.lettering ? tone.lettering : tone.accent;
}

const unitsOf = (viewBox: string) => viewBox.split(/\s+/).map(Number) as [number, number, number, number];
/** The wordmark canvas the three motion layers share (1540 × 238), and the D's own width on it (335). */
export const CANVAS = { width: unitsOf(PACK.motionD.viewBox)[2], height: unitsOf(PACK.motionD.viewBox)[3], symbolWidth: unitsOf(PACK.symbol.viewBox)[2] } as const;

/**
 * The launch (owner, 2026-11-06: the pack's 1.2 s moved too fast; the D-to-wordmark motion now takes 1.8 s):
 * 0–200 ms the D centred; 200–2000 ms the D eases left while UKAN slides right and is revealed left to right;
 * 1800–2200 ms ERP fades in beside the N; 2200–2600 ms a brief hold, then the fade into the app.
 * The pack scales nothing, so the D is drawn at its place in the final wordmark from the first frame, and the native
 * splash shows it at that same width (`size`, app.json `imageWidth`): the hand-over does not move it.
 */
const WORDMARK_WIDTH = 280;
export const BRAND_INTRO = {
  wordmarkWidth: WORDMARK_WIDTH,
  /** The D's width at the start, and the splash image's: its share of the wordmark. */
  size: Math.round((WORDMARK_WIDTH * 335) / 1540),
  holdMs: 200,
  moveEndMs: 2000,
  erpFromMs: 1800,
  erpEndMs: 2200,
  fadeAtMs: 2400,
  totalMs: 2600,
  fadeMs: 200,
  reducedHoldMs: 250,
} as const;
