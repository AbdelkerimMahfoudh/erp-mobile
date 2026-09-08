/**
 * The motion system. One place that decides how long anything takes and how it
 * eases, so a timing can be changed without opening twelve screens.
 *
 * ## What motion is for here
 *
 * This is software somebody uses two hundred times a day standing at a counter.
 * Animation earns its place by making a change *legible* — showing that a row
 * became selected, that a sheet came from the bottom and will go back there,
 * that a button received the press. It never exists to be admired, and it never
 * stands between the user and the next thing they have to do.
 *
 * Everything here is short enough to read as responsiveness rather than as
 * animation. If a duration ever needs to be longer to "look better", the answer
 * is that it should not look like anything.
 *
 * ## The rule animation must never break
 *
 * **Animation is presentation. It never gates behaviour.** A save, a mutation,
 * a validation, a scanner lock and a navigation decision all happen on their own
 * schedule; the animation reports what already happened. The scanner is the
 * sharpest case — the synchronous lock is taken and the camera callback disabled
 * *before* any reveal begins, so a fast second barcode cannot slip in during a
 * 200 ms fade. See `ScannerSheet`.
 */

/**
 * Durations, named by the job rather than by length — `motion.press` survives a
 * retune, `motion.ms120` does not.
 */
export const motion = {
  /** Button press. Short enough to feel like the button, not like a effect. */
  press: 120,
  /** A row becoming selected, a checkmark arriving. */
  selection: 150,
  /** Content or a result appearing in place. */
  reveal: 200,
  /** A bottom sheet entering or leaving. The longest thing in the app. */
  sheet: 260,
} as const;

export type MotionRole = keyof typeof motion;

/**
 * Easing curves, as control points rather than as built easing functions.
 *
 * This file deliberately imports **nothing**. The pure test suites run under
 * bare node, where `react-native-reanimated` cannot even be resolved, and the
 * timings are the part most worth testing — so the numbers live here and
 * `motion-easing.ts` turns them into curves for the renderer.
 *
 * `standard` for things moving within the screen, `enter` for something
 * arriving (decelerates as it lands), `exit` for something leaving (accelerates
 * away). No spring, no overshoot, no bounce: a sheet that wobbles when it lands
 * reads as a toy, and makes its own text unreadable for the duration of the
 * wobble.
 */
export const curve = {
  standard: [0.2, 0, 0, 1],
  enter: [0.0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
} as const;

export type CurveName = keyof typeof curve;

/**
 * What an animation should actually do, given the user's Reduce Motion setting.
 *
 * Reduce Motion is not "animate faster" — for some people movement causes
 * genuine nausea, and a quick lurch is still a lurch. So movement is dropped
 * entirely and replaced by a brief cross-fade, which conveys the same "something
 * changed here" without anything travelling across the screen.
 *
 * Kept as a plain function of two values so the decision can be tested without
 * a renderer, a device, or a mocked accessibility API.
 */
export interface MotionPlan {
  /** How long the transition runs. Never zero — an instant swap is a flicker. */
  duration: number;
  /** Whether translate/scale may be used at all. */
  movement: boolean;
}

/** A fade with no travel. Long enough to be seen, short enough not to be waited on. */
const REDUCED_FADE = 100;

export function motionPlan(role: MotionRole, reduceMotion: boolean): MotionPlan {
  if (reduceMotion) return { duration: REDUCED_FADE, movement: false };
  return { duration: motion[role], movement: true };
}

/**
 * The press scale. Barely there by design.
 *
 * 0.98 is about a pixel and a half on a full-width button — felt rather than
 * seen, which is what a press response should be. Anything deeper starts to
 * look like the button is being pushed into the page.
 */
export const PRESS_SCALE = 0.98;

/**
 * The scale to animate to for a press, honouring Reduce Motion.
 *
 * Under Reduce Motion the button does not move at all; the press is already
 * reported by the platform's own opacity/highlight behaviour and by the haptic,
 * so nothing is lost.
 */
export function pressScale(reduceMotion: boolean): number {
  return reduceMotion ? 1 : PRESS_SCALE;
}
