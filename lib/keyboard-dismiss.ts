/**
 * Dismissing the keyboard by tapping away from the field.
 *
 * ## Why this is a module and not three inline arrow functions
 *
 * The previous attempt put `onPress={Keyboard.dismiss}` in three places in
 * `Screen` and a test counted them. All three were present, the test passed, and
 * on a real iPhone tapping outside the field did nothing at all.
 *
 * The count was right and the conclusion was wrong. `Screen` renders its body
 * two ways — a `ScrollView` when `scroll` is true, a plain `View` when it is
 * not — and **every scan-entry page uses `scroll={false}`**. Two of the three
 * dismissals were in the header and footer strips; the third was in the branch
 * those pages never render. The largest area of the screen, the part somebody
 * actually taps, had no dismissal in it.
 *
 * Extracting the behaviour makes it something a test can CALL rather than
 * something a test can find. `dismissing(...)` returns a handler; a test invokes
 * it and observes what happened. That is a different kind of assertion from
 * grepping for a string, and this defect is why the difference matters.
 *
 * ## What is deliberately NOT here
 *
 * No invisible full-screen overlay. The dismissal surfaces are ordinary
 * `Pressable`s wrapped around real content, so the deepest responder wins the
 * touch: a button gets pressed, the camera icon opens the camera, and the text
 * field keeps focus when it is tapped. An overlay would swallow all three.
 */

/** Injected so tests can watch it, and so this file imports nothing. */
export interface KeyboardApi {
  dismiss: () => void;
}

/**
 * A press handler for blank space: dismiss, and do nothing else.
 *
 * Used by `Screen` for the header strip, the body and the footer — the three
 * regions that exist outside any text field.
 */
export function dismissing(keyboard: KeyboardApi): () => void {
  return () => {
    // Braces, not a concise body: `() => keyboard.dismiss()` would return
    // whatever `dismiss` returns, and a press handler that hands a value back
    // to the renderer is a value nobody asked for and nothing reads.
    keyboard.dismiss();
  };
}

/**
 * Wrap an action so the keyboard closes before it runs.
 *
 * For controls that do something as well as deserving the keyboard out of the
 * way — the camera button above all. Opening a full-screen viewfinder over a
 * raised keyboard leaves the preview squeezed into what is left, and on Android
 * the window resize fights the modal as it animates in.
 *
 * The order is fixed and load-bearing: **dismiss first, then act.** An action
 * that navigates or opens a modal takes the screen away, and a dismissal queued
 * behind it can land after the thing it was meant to tidy has gone.
 *
 * Arguments pass straight through, so this wraps a handler without knowing
 * anything about it.
 */
export function withDismiss<A extends unknown[], R>(
  keyboard: KeyboardApi,
  action: (...args: A) => R,
): (...args: A) => R {
  return (...args: A) => {
    keyboard.dismiss();
    return action(...args);
  };
}
