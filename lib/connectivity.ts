import { create } from 'zustand';

/**
 * Whether the app can currently reach the server.
 *
 * Deliberately derived from real requests rather than from a connectivity
 * library. A shop's problem is almost never "the phone has no radio" — it is
 * "the wifi is up but the internet is dead", or "the server is down". A radio
 * indicator would cheerfully report online in all three cases, which is worse
 * than no indicator at all, because staff would trust it.
 *
 * So: `fetch` rejecting with a `TypeError` is the signal (see `lib/errors.ts`,
 * which already classifies exactly that as offline), and any completed response
 * — including a 4xx — proves the server was reached.
 *
 * This is the read-only half of offline support. Queueing writes is a separate,
 * much harder problem and is deliberately not attempted here: showing an honest
 * indicator is safe, and pretending a confirmation succeeded is not.
 */

interface ConnectivityState {
  /** Optimistic until proven otherwise — a fresh app should not flash a banner. */
  online: boolean;
  /** When the last request failed to reach the server. */
  lastFailureAt: number | null;
  markReachable: () => void;
  markUnreachable: () => void;
}

export const useConnectivity = create<ConnectivityState>((set) => ({
  online: true,
  lastFailureAt: null,
  markReachable: () =>
    // Guarded so a burst of successful requests does not re-render every
    // subscriber once per response.
    set((s) => (s.online ? s : { online: true, lastFailureAt: null })),
  markUnreachable: () => set({ online: false, lastFailureAt: Date.now() }),
}));

/** Non-hook read, for code paths outside React. */
export function isOnline(): boolean {
  return useConnectivity.getState().online;
}
