import { I18nManager, Platform } from 'react-native';

/**
 * Which way the UI is laid out, on every platform the app ships to.
 *
 * ## Native and web get there differently
 *
 * - **Native**: `I18nManager.forceRTL` is applied by the OS at startup, so a
 *   language change takes effect on the next launch and `I18nManager.isRTL`
 *   reports the direction actually on screen.
 * - **Web**: react-native-web 0.21 ships `I18nManager` as a stub whose
 *   `forceRTL` does nothing and whose `isRTL` is never true. Direction there is
 *   the document's own `dir` attribute: CSS flex rows, logical margins
 *   (`marginStart` → `margin-inline-start`) and bidirectional text all follow
 *   it natively, and it applies immediately, without a reload.
 *
 * Everything that asks "is this right-to-left?" asks here, so a web build in
 * Arabic mirrors its layout instead of silently staying left-to-right.
 */

let webRtl = false;

/** Web only: set the document direction and language. No-op on native. */
export function applyWebDirection(rtl: boolean, lang: string): void {
  if (Platform.OS !== 'web') return;
  webRtl = rtl;
  if (typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }
}

/** Whether direction changes need an app restart to show (native only). */
export const DIRECTION_NEEDS_RESTART = Platform.OS !== 'web';

export function layoutIsRTL(): boolean {
  return Platform.OS === 'web' ? webRtl : I18nManager.isRTL;
}
