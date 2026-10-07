/**
 * What to tell the person about layout direction (docs/21, 2026-10-05).
 *
 * Pure, so every branch is testable without a device. The facts come from
 * `lib/i18n` and `lib/design/layout-direction`:
 *
 *  - `wantsRtl`   — the chosen language is written right-to-left;
 *  - `actualRtl`  — the layout the running app is actually using;
 *  - `isExpoGo`   — the app is running inside Expo Go, whose native shell is
 *                   Expo's: it applies its own direction setting at every launch,
 *                   so a project's request does not survive into the next one;
 *  - `relaunchedSinceRequest` — the app asked the native side to flip the
 *                   direction for THIS language in an earlier process, and this
 *                   process still sees the old direction.
 *
 * The notice must say what is true, and never disappear while the layout is
 * still wrong:
 *
 *  - `ok`                 — direction and language agree: nothing to say;
 *  - `restart`            — our own build: the flip was requested; the next
 *                           genuine restart applies it (a reload of the
 *                           JavaScript is not one);
 *  - `expo_go`            — Expo Go: it cannot apply a layout direction, so the
 *                           notice says so at once and never asks for a restart;
 *                           a development or store build applies it;
 *  - `unsupported_build`  — our own build was restarted and nothing flipped: this
 *                           build cannot switch direction and a newer one is
 *                           needed. Text is in the chosen language; the layout
 *                           is not, and the notice says so.
 *
 * Why Expo Go is "cannot" at once (D150, superseding the try-once rule of D147):
 * on the owner's iPhone (Expo Go 1017880, SDK 57, 2026-10-07) the request was
 * persisted, Expo Go was swiped away and reopened — a new process, a new
 * `Constants.sessionId` — and `I18nManager.isRTL` was still false. Asking for a
 * restart in Expo Go therefore promised what Expo Go cannot do, and every
 * re-selection of the language asked again. If a future Expo Go does apply the
 * request, the next launch agrees with the language and the verdict is `ok`.
 */
export type DirectionVerdict = 'ok' | 'restart' | 'expo_go' | 'unsupported_build';

export interface DirectionFacts {
  /** False on web, where the document direction applies at once. */
  needsRestart: boolean;
  wantsRtl: boolean;
  actualRtl: boolean;
  isExpoGo: boolean;
  relaunchedSinceRequest: boolean;
}

export function directionVerdict(f: DirectionFacts): DirectionVerdict {
  if (!f.needsRestart) return 'ok';
  if (f.wantsRtl === f.actualRtl) return 'ok';
  if (f.isExpoGo) return 'expo_go';
  return f.relaunchedSinceRequest ? 'unsupported_build' : 'restart';
}

/** The notice keys for a verdict that is not `ok`. */
export const DIRECTION_NOTICE_KEYS = {
  restart: { title: 'settings.language.restartTitle', body: 'settings.language.restartBody' },
  expo_go: { title: 'settings.language.expoGo.title', body: 'settings.language.expoGo.body' },
  unsupported_build: { title: 'settings.language.unsupported.title', body: 'settings.language.unsupported.body' },
} as const;
