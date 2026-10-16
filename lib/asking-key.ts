import { useRef } from 'react';
import { uuidv4 } from './utils';

/**
 * One client key per asking, and one request at a time (review MO1-10).
 *
 * A payment report between two stores is a money record: a second tap while the first is on its way, or a tap again
 * after a timeout whose answer was lost, must reach the server as the SAME report, so it replays the first instead of
 * recording a second one the other store would confirm twice. So:
 *
 * - `keyFor(asking)` gives the same key for the same report (this amount, this reference) until the server has said
 *   yes; a different report gets its own key, since one key with another payload is refused as a replay. `settled()`
 *   forgets them all once a report is recorded: the next one is a new payment.
 * - `once(send)` drops a tap while an earlier one is still on its way. Held in a ref, so a second tap in the same
 *   instant — before the button re-renders as busy — is dropped too.
 */
export function useAskingKey() {
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  return {
    keyFor: (asking: string): string => {
      const known = keys.current.get(asking);
      if (known) return known;
      const fresh = uuidv4();
      keys.current.set(asking, fresh);
      return fresh;
    },
    settled: () => keys.current.clear(),
    once: (send: (done: () => void) => void) => {
      if (inFlight.current) return;
      inFlight.current = true;
      send(() => {
        inFlight.current = false;
      });
    },
  };
}
