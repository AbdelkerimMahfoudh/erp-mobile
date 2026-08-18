import type { ClassifiedError, ErrorKind } from './queue-rules.ts';

/**
 * What actually went wrong (Milestone J).
 *
 * Pure, and deliberately free of any import from `api-client` — the API client
 * uses this, so importing back would be a cycle. Errors are duck-typed on the
 * fields that matter rather than on class identity, which also makes every case
 * testable without constructing a real failed request.
 *
 * The distinction the whole milestone rests on: **a timeout is not a failure.**
 * The request may well have been processed and only the answer was lost, so it
 * is retried with the same client UUID rather than reported as not-sent. Every
 * other 4xx means the server read the request and decided; those stop.
 */

export const REQUEST_TIMEOUT_MS = 20_000;

/** Thrown by the API client when a request outlives `REQUEST_TIMEOUT_MS`. */
export class RequestTimeout extends Error {
  constructor(message = 'The server did not answer in time') {
    super(message);
    this.name = 'RequestTimeout';
  }
}

interface StatusCarrier {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
}

export function classifyError(error: unknown, online = true): ClassifiedError {
  const e = (error ?? {}) as StatusCarrier;
  const message = typeof e.message === 'string' && e.message ? e.message : 'Something went wrong';

  // A timeout first: it is the only case where the outcome is genuinely unknown,
  // and mistaking it for a failure is how a shop is told to create a second
  // record for money it has already reported.
  if (error instanceof RequestTimeout || e.name === 'AbortError' || e.name === 'TimeoutError') {
    return { kind: 'timeout_uncertain', message };
  }

  if (typeof e.status === 'number') {
    const status = e.status;
    if (status === 401) return { kind: 'session_expired', message, status };
    if (status === 403) {
      /*
        A lapsed subscription is its own thing, not a role problem (Milestone K).
        Both stop, so neither can loop — but telling somebody they lack
        permission when the shop simply has not renewed sends them to the wrong
        person. The code is matched, never the English.
      */
      if (e.code === 'ENTITLEMENT_WRITE_BLOCKED') {
        return { kind: 'entitlement_blocked', message, status };
      }
      return { kind: 'permission_denied', message, status };
    }
    if (status === 409) return { kind: 'conflict', message, status };
    // 404 and 410 mean the thing this refers to is gone. Retrying cannot bring
    // it back, and the shop needs to know which record vanished.
    if (status === 404 || status === 410) return { kind: 'conflict', message, status };
    if (status >= 500) return { kind: 'server_error', message, status };
    if (status >= 400) return { kind: 'validation', message, status };
  }

  /*
    `fetch` rejects with a TypeError only when the server could not be reached at
    all. Whether that is "no radio" or "the wifi is up but the API is dead" is
    something the app cannot tell from here — so the connectivity state, which is
    derived from real request outcomes, decides which of the two to say.
  */
  if (error instanceof TypeError) {
    return { kind: online ? 'api_unreachable' : 'no_network', message };
  }

  return { kind: 'server_error', message };
}

/**
 * Whether a failure means the item should stop and wait for a person.
 *
 * A convenience over `isTransient` for call sites that only care about the
 * outcome, kept here so the two never disagree.
 */
export function needsHuman(kind: ErrorKind): boolean {
  return (
    kind === 'validation' ||
    kind === 'permission_denied' ||
    kind === 'entitlement_blocked' ||
    kind === 'conflict' ||
    kind === 'session_expired'
  );
}
