/**
 * What to tell the person about layout direction (docs/21, 2026-10-05).
 *
 * Pure, so every branch is testable without a device. The facts come from
 * `lib/i18n` and `lib/design/layout-direction`:
 *
 *  - `wantsRtl`   — the chosen language is written right-to-left;
 *  - `actualRtl`  — the layout the running app is actually using;
 *  - `isExpoGo`   — the app is running inside Expo Go, whose native shell is not
 *                   ours and does not take a direction change from a project;
 *  - `relaunchedSinceRequest` — the app asked the native side to flip the
 *                   direction for THIS language on an earlier launch, and this
 *                   launch still sees the old direction.
 *
 * The notice must say what is true, and never disappear while the layout is
 * still wrong:
 *
 *  - `ok`                 — direction and language agree: nothing to say;
 *  - `restart`            — the flip was requested; the next genuine restart applies it;
 *  - `expo_go`            — Expo Go cannot apply it; the installed app will;
 *  - `unsupported_build`  — a restart already happened and nothing flipped: this
 *                           build does not support the direction (the native RTL
 *                           option is missing). Text is in the chosen language;
 *                           the layout is not, and the notice says so.
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
  if (f.relaunchedSinceRequest) return 'unsupported_build';
  return 'restart';
}

/** The notice keys for a verdict that is not `ok`. */
export const DIRECTION_NOTICE_KEYS = {
  restart: { title: 'settings.language.restartTitle', body: 'settings.language.restartBody' },
  expo_go: { title: 'settings.language.expoGo.title', body: 'settings.language.expoGo.body' },
  unsupported_build: { title: 'settings.language.unsupported.title', body: 'settings.language.unsupported.body' },
} as const;
