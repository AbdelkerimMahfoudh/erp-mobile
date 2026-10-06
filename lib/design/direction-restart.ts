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
 *                   so a project's request may not survive into the next one;
 *  - `relaunchedSinceRequest` — the app asked the native side to flip the
 *                   direction for THIS language in an earlier process, and this
 *                   process still sees the old direction.
 *
 * The notice must say what is true, and never disappear while the layout is
 * still wrong:
 *
 *  - `ok`                 — direction and language agree: nothing to say;
 *  - `restart`            — the flip was requested; the next genuine restart
 *                           applies it (a reload of the JavaScript is not one);
 *  - `expo_go`            — Expo Go was restarted and did not apply it: on this
 *                           phone it cannot, and no further restart will — the
 *                           installed app applies it at its next launch;
 *  - `unsupported_build`  — our own build was restarted and nothing flipped: this
 *                           build cannot switch direction and a newer one is
 *                           needed. Text is in the chosen language; the layout
 *                           is not, and the notice says so.
 *
 * Why Expo Go is only ever "cannot" AFTER a restart: whether Expo Go keeps a
 * project's direction request depends on Expo Go's own build, which this code
 * cannot read. Promising failure before trying would be as dishonest as
 * promising success; the restart is asked for once, and the result is reported.
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
  if (!f.relaunchedSinceRequest) return 'restart';
  return f.isExpoGo ? 'expo_go' : 'unsupported_build';
}

/** The notice keys for a verdict that is not `ok`. */
export const DIRECTION_NOTICE_KEYS = {
  restart: { title: 'settings.language.restartTitle', body: 'settings.language.restartBody' },
  expo_go: { title: 'settings.language.expoGo.title', body: 'settings.language.expoGo.body' },
  unsupported_build: { title: 'settings.language.unsupported.title', body: 'settings.language.unsupported.body' },
} as const;
