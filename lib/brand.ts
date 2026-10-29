/**
 * The Dukan interlocking-ledger mark as data (the owner's brand pack, 2026-10-29): the vector geometry of its three
 * layers, the colours each tone takes from the design tokens, and the launch animation's timing. Pure, so a node test
 * can hold it to the contract without a renderer.
 */
import { lightColors, darkColors } from './design/colors.ts';

export const LEDGER = {
  /** The mark's ink box in the pack's 1024 grid, with clear space; the splash image is cut to the same box. */
  viewBox: '96 96 832 832',
  span: 832,
  left: 'M120 176c0-39 40-65 76-50l278 117c37 16 62 52 62 93v66l83 68c21 17 21 49 0 66l-83 68v193L196 654c-46-19-76-64-76-114V176z',
  right: 'M904 176c0-39-40-65-76-50L550 243c-37 16-62 52-62 93v66l-83 68c-21 17-21 49 0 66l83 68v193l340-143c46-19 76-64 76-114V176z',
  highlight: 'M467 451l45 37 45-37',
  leftCuts: [
    { x: 176, y: 314, w: 230 },
    { x: 176, y: 468, w: 188 },
  ],
  rightCuts: [
    { x: 660, y: 314, w: 188 },
    { x: 660, y: 468, w: 188 },
  ],
} as const;

export type MarkTone = 'light' | 'dark' | 'mono';

/** The mark's colours per surface, from the palettes' `mark` tokens: navy and indigo on light, light ink and a lighter indigo on dark. */
export function markColours(tone: MarkTone, mono = '#000000'): { left: string; right: string; highlight: string } {
  if (tone === 'mono') return { left: mono, right: mono, highlight: mono };
  return tone === 'dark' ? darkColors.mark : lightColors.mark;
}

/**
 * The launch animation (the pack's motion contract): the halves enter from opposite sides, overshoot by a few units,
 * settle, then the connection draws — 800–1100 ms in all, once. Units are the pack's 1024 grid.
 */
export const BRAND_INTRO = {
  /** The same width as the native splash image (app.json `imageWidth`), so the hand-over does not move the mark. */
  size: 200,
  enterUnits: 170,
  overshootUnits: 18,
  appearMs: 190,
  enterMs: 650,
  settleMs: 250,
  rightLagMs: 50,
  drawAtMs: 720,
  drawMs: 340,
  /** The animation's end: the last of the halves settles at 950 ms, the connection is drawn at 1060 ms. */
  totalMs: 1060,
  fadeMs: 180,
  reducedHoldMs: 250,
  /** Longer than the chevron's path (two 58-unit strokes), so it starts fully hidden. */
  highlightLength: 130,
} as const;
