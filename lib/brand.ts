/**
 * The Dukan Offset Spiral mark as data (the owner's brand pack, Concept B, 2026-11-03): the vector geometry of its three
 * layers (two arcs around a "D"), the colours each tone takes from the design tokens, and the launch animation's
 * timing. Pure, so a node test can hold it to the contract without a renderer.
 */
import { lightColors, darkColors } from './design/colors.ts';

export const SPIRAL = {
  /** The mark's ink (40..472 in the pack's 512 grid) with clear space, centred on (256, 256); the splash image is cut to the same box. */
  viewBox: '24 24 464 464',
  span: 464,
  first: 'M 256,40 A 216,216 0 0,1 472,256 A 216,216 0 0,1 426.6,396.4 L 380,352 A 152,152 0 0,0 408,256 A 152,152 0 0,0 256,104 Z',
  second: 'M 256,472 A 216,216 0 0,1 40,256 A 216,216 0 0,1 85.4,115.6 L 132,160 A 152,152 0 0,0 104,256 A 152,152 0 0,0 256,408 Z',
  letter: 'M 190,160 L 260,160 C 310,160 350,195 350,256 C 350,317 310,352 260,352 L 190,352 Z M 230,195 L 230,317 L 258,317 C 288,317 310,295 310,256 C 310,217 288,195 258,195 Z',
} as const;

export type MarkTone = 'light' | 'dark' | 'mono';

/** The mark's colours per surface, from the palettes' `mark` tokens: navy and violet on light, violet, lavender and white on dark. */
export function markColours(tone: MarkTone, mono = '#000000'): { first: string; second: string; letter: string } {
  if (tone === 'mono') return { first: mono, second: mono, letter: mono };
  return tone === 'dark' ? darkColors.mark : lightColors.mark;
}

/**
 * The launch animation (the pack's three stages, about one second, once):
 * 1. the arcs converge: from a third of their size and a quarter turn back, past their place, then settle;
 * 2. the "D" scales up, past its size, and locks into the centre;
 * 3. the mark rests in its static state, then the overlay fades.
 */
export const BRAND_INTRO = {
  /** The same width as the native splash image (app.json `imageWidth`), so the hand-over does not move the mark. */
  size: 200,
  arcsFromScale: 0.3,
  arcsFromDegrees: -90,
  arcsOvershootScale: 1.1,
  arcsOvershootDegrees: 15,
  arcsMs: 700,
  letterAtMs: 450,
  letterOvershootScale: 1.2,
  letterFromDegrees: -180,
  letterMs: 600,
  /** The animation's end: the "D" locks at 450 + 600 ms, the arcs settled at 700. */
  totalMs: 1050,
  fadeMs: 180,
  reducedHoldMs: 250,
} as const;
