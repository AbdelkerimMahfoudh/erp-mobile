/**
 * The keyboard in a phone's browser (2026-10-24), measured as what it takes from the window: the part of the layout
 * viewport the visual viewport no longer shows below it. Imports nothing, so a plain `node` test can call it.
 */

/** Below this many CSS pixels, a smaller visual viewport is the browser's toolbars, not a keyboard. */
export const WEB_KEYBOARD_MIN = 120;

/** What the keyboard covers, from the window's height and the visual viewport. */
export function coveredByKeyboard(windowHeight: number, viewport: { height: number; offsetTop: number }): number {
  const covered = Math.round(windowHeight - viewport.height - viewport.offsetTop);
  return covered >= WEB_KEYBOARD_MIN ? covered : 0;
}
