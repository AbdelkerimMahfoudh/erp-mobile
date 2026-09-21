import { create } from 'zustand';

/** How long a "just done" banner stays true after the action that earned it. */
const FRESH_MS = 60_000;

interface RecentSuccessState {
  at: Record<string, number>;
  mark: (key: string) => void;
  clear: (key: string) => void;
}

/**
 * A success made on one screen, for the screen the person comes back to.
 *
 * Recording a payment ends back on the sale, and the sale should say
 * "Payment recorded" — once, at the top, in words — rather than a blocking
 * alert on the way. The store holds only WHEN something was done, never what:
 * the sale itself is re-read from the server, and the banner is dropped as
 * soon as the screen is left or the minute is up.
 */
export const useRecentSuccess = create<RecentSuccessState>((set) => ({
  at: {},
  mark: (key) => set((s) => ({ at: { ...s.at, [key]: Date.now() } })),
  clear: (key) =>
    set((s) => {
      if (!(key in s.at)) return s;
      const at = { ...s.at };
      delete at[key];
      return { at };
    }),
}));

/** Whether `key` was marked within the last minute. */
export function isFresh(at: number | undefined, now: number = Date.now()): boolean {
  return at !== undefined && now - at < FRESH_MS;
}
