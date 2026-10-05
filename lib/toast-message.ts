/**
 * The one rule a toast message obeys: it is never blank.
 *
 * The 2026-10-05 Notifications screenshot showed an error toast with no words
 * in it — a red box that told the employee nothing. Whatever produced the empty
 * string, the toast is the wrong place to pass it on: an error that cannot be
 * named is still an error, and a success with no words is not worth showing.
 *
 * Pure, so it can be tested without React Native.
 */
export type ToastToneKind = 'success' | 'error' | 'warning' | 'info';

export interface SafeToast {
  /** The words to show, or null when the toast should not be shown at all. */
  message: string | null;
  /** True when the caller passed nothing usable — worth a warning in development. */
  wasBlank: boolean;
}

export function safeToastMessage(tone: ToastToneKind, message: unknown, fallbackError: string): SafeToast {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text) return { message: text, wasBlank: false };
  // An error or a warning without words still happened: say so in the app's own words.
  if (tone === 'error' || tone === 'warning') return { message: fallbackError, wasBlank: true };
  // A confirmation with nothing to confirm is noise.
  return { message: null, wasBlank: true };
}
