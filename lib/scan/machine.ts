import type { ScanPayload } from './payload.ts';

/**
 * The scanner's explicit state machine (milestone O).
 *
 * ## Why this exists
 *
 * The camera fires `onBarcodeScanned` many times a second, and several events
 * can arrive before React has rendered once. The previous implementation
 * guarded with a ref that it released in a `finally`, so the camera resumed the
 * instant the lookup returned and kept scanning behind the result — the user
 * saw nothing until they closed the sheet by hand.
 *
 * Making the whole thing a reducer means the lock is not a separate flag that
 * can drift from what is on screen: **the state IS the lock.** A detection is
 * accepted only in `scanning`, and nothing returns to `scanning` except an
 * explicit decision by a person.
 *
 * Hold this state in a ref, not only in React state, and read the ref inside
 * the camera callback. `useState` updates are not visible to a callback that
 * fires again before the next render, which is exactly the race this prevents.
 *
 * ## The states
 *
 * `idle` → `scanning` → `validating` → `result` → `accepted`
 *                          ▲              │
 *                          └── scanAgain ─┘
 *
 * `cancelled` is reachable from anywhere. `validating` covers the asynchronous
 * lookup; the camera is already paused by then.
 */

export interface Detected {
  readonly primary: string;
  readonly secondary: string | null;
}

/** Why a result cannot be accepted as it stands. */
export type ResultProblem =
  | 'checksum'
  | 'length'
  | 'ambiguous'
  | 'not_an_imei'
  | 'same_as_primary';

export type ScannerState =
  | { readonly name: 'idle' }
  | { readonly name: 'scanning'; readonly pass: 1 | 2; readonly primary: string | null }
  | {
      readonly name: 'validating';
      readonly pass: 1 | 2;
      readonly primary: string | null;
      readonly raw: string;
    }
  | {
      readonly name: 'result';
      readonly pass: 1 | 2;
      /** Confirmed so far. On the second pass this survives a rejected scan. */
      readonly primary: string | null;
      readonly secondary: string | null;
      readonly payload: ScanPayload;
      readonly problem: ResultProblem | null;
    }
  /**
   * Several valid IMEIs were visible, and a person must say which.
   *
   * A phone label can carry IMEI 1, IMEI 2 and an eSIM identifier side by side,
   * and on a device the scanner alternated between them, occasionally waited
   * forever, and occasionally picked one nobody meant. No amount of timing
   * fixes that: **stability tells you a barcode is being held still, never that
   * it is the one somebody wanted.** When more than one valid candidate is on
   * the table the only correct answer is to ask.
   *
   * The camera is off here. Candidates are already collected, and leaving it
   * running would keep changing the list underneath the person reading it.
   */
  | {
      readonly name: 'choosing';
      readonly pass: 1 | 2;
      /** Confirmed on an earlier pass. Never discarded by a second scan. */
      readonly primary: string | null;
      readonly candidates: readonly string[];
    }
  | { readonly name: 'accepted'; readonly primary: string; readonly secondary: string | null }
  | { readonly name: 'cancelled' };

export type ScannerEvent =
  | { readonly type: 'open' }
  /** A camera callback. Ignored unless the machine is in `scanning`. */
  | { readonly type: 'detected'; readonly raw: string }
  /** The classification of the raw payload, once available. */
  | { readonly type: 'validated'; readonly payload: ScanPayload }
  | { readonly type: 'accept' }
  | { readonly type: 'addSecond' }
  | { readonly type: 'removeSecond' }
  | { readonly type: 'scanAgain' }
  | { readonly type: 'manual'; readonly primary: string; readonly secondary: string | null }
  /** Collection ended with more than one plausible IMEI. Ask. */
  | { readonly type: 'candidates'; readonly candidates: readonly string[] }
  /** What the person picked. `secondary` set only for "both — one phone". */
  | { readonly type: 'chose'; readonly primary: string; readonly secondary: string | null }
  | { readonly type: 'cancel' };

export const initialScannerState: ScannerState = { name: 'idle' };

/**
 * Whether a camera detection may be acted on **right now**.
 *
 * This is the whole lock. Read it from a ref inside the callback.
 */
export function acceptsDetection(state: ScannerState): boolean {
  return state.name === 'scanning';
}

/**
 * Whether the camera should be running.
 *
 * False from the moment a payload is being validated until somebody explicitly
 * asks to scan again — so nothing keeps scanning invisibly behind a result.
 */
export function cameraActive(state: ScannerState): boolean {
  return state.name === 'scanning';
}

/** The identifiers confirmed so far, whatever state the machine is in. */
export function detectedSoFar(state: ScannerState): Detected | null {
  if (state.name === 'accepted') return { primary: state.primary, secondary: state.secondary };
  if (state.name === 'result' && state.primary) {
    return { primary: state.primary, secondary: state.secondary };
  }
  return null;
}

function problemOf(payload: ScanPayload): ResultProblem | null {
  switch (payload.kind) {
    case 'imei':
      return null;
    case 'invalid':
      return payload.reason;
    case 'ambiguous':
      return 'ambiguous';
    default:
      return 'not_an_imei';
  }
}

export function scannerReducer(state: ScannerState, event: ScannerEvent): ScannerState {
  // Cancelling is always allowed and always final for this session.
  if (event.type === 'cancel') return { name: 'cancelled' };

  switch (event.type) {
    case 'open':
      return { name: 'scanning', pass: 1, primary: null };

    case 'detected':
      // THE LOCK. Every callback arriving after the first is dropped here,
      // synchronously, before any asynchronous work starts.
      if (state.name !== 'scanning') return state;
      return { name: 'validating', pass: state.pass, primary: state.primary, raw: event.raw };

    case 'candidates': {
      /*
       * Collection ended with more than one plausible IMEI, so nothing is
       * chosen automatically. Reached from `scanning` only — the camera has to
       * have been running to have collected anything.
       */
      if (state.name !== 'scanning') return state;
      if (event.candidates.length < 2) return state;
      return {
        name: 'choosing',
        pass: state.pass,
        primary: state.primary,
        candidates: event.candidates,
      };
    }

    case 'chose': {
      /*
       * A person answered. It becomes an ordinary result from here, so the
       * panel, the lookup and acceptance all behave exactly as they do after a
       * single unambiguous scan — one path, not two.
       */
      if (state.name !== 'choosing') return state;
      return {
        name: 'result',
        pass: state.pass,
        primary: event.primary,
        secondary: event.secondary,
        payload: { kind: 'imei', primary: event.primary, secondary: event.secondary },
        problem: null,
      };
    }

    case 'validated': {
      if (state.name !== 'validating') return state;
      const { payload } = event;
      const problem = problemOf(payload);

      if (state.pass === 2) {
        // A second-pass scan may never disturb the identifier already held.
        const primary = state.primary;
        if (payload.kind === 'imei' && payload.primary === primary) {
          return { name: 'result', pass: 2, primary, secondary: null, payload, problem: 'same_as_primary' };
        }
        return {
          name: 'result',
          pass: 2,
          primary,
          secondary: problem === null && payload.kind === 'imei' ? payload.primary : null,
          payload,
          problem,
        };
      }

      return {
        name: 'result',
        pass: 1,
        primary: payload.kind === 'imei' ? payload.primary : null,
        secondary: payload.kind === 'imei' ? payload.secondary : null,
        payload,
        problem,
      };
    }

    case 'scanAgain':
      // Explicitly clears a rejected result and releases the lock. Nothing else
      // does — a result never times out back into scanning on its own.
      //
      // Also the way out of the selection panel: "none of these" is a real
      // answer, and it must not cost an IMEI already confirmed on pass 1.
      if (state.name !== 'result' && state.name !== 'choosing') return state;
      return {
        name: 'scanning',
        pass: state.pass,
        primary: state.pass === 2 ? state.primary : null,
      };

    case 'addSecond':
      if (state.name !== 'result' || !state.primary || state.secondary) return state;
      return { name: 'scanning', pass: 2, primary: state.primary };

    case 'removeSecond':
      if (state.name !== 'result' || !state.primary) return state;
      return { ...state, secondary: null, problem: null };

    case 'accept':
      if (state.name !== 'result' || !state.primary || state.problem === 'checksum') return state;
      if (state.problem !== null && state.problem !== 'same_as_primary') return state;
      return { name: 'accepted', primary: state.primary, secondary: state.secondary };

    case 'manual':
      // Typing is never taken away, and it reaches the same accepted state as a
      // scan — including the optional second identifier.
      if (!event.primary || event.secondary === event.primary) return state;
      return { name: 'accepted', primary: event.primary, secondary: event.secondary };

    default:
      return state;
  }
}
