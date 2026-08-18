import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useConnectivity } from '../connectivity';
import { useQueue } from './queue.ts';

/**
 * When the queue wakes up (Milestone J).
 *
 * Three triggers, and no polling timer. A timer would keep a shop's phone
 * making requests all day on a dead connection, and would still miss the moment
 * that actually matters — the instant somebody walks back into wifi range.
 *
 * - **Session known.** Nothing can be read or replayed until we know which
 *   user, company and branch we are, because that triple is the queue's
 *   identity.
 * - **Reachability returns.** The connectivity store flips on a real successful
 *   request, not on a radio flag, so this fires when the server is genuinely
 *   answering again.
 * - **App foregrounded.** The common case in a shop: the phone was in a pocket
 *   while the wifi came back.
 *
 * Losing connectivity does none of this, and in particular **never** triggers
 * OTP or touches device trust — a dropped connection is not a security event.
 */
export function useSyncEngine(session: {
  companyId: string | null;
  branchId: string | null;
  userId: string | null;
}): void {
  const { companyId, branchId, userId } = session;
  const load = useQueue((s) => s.load);
  const process = useQueue((s) => s.process);

  // Open the right file whenever the identity changes. Switching branch or
  // user swaps the whole queue rather than merging two people's work.
  useEffect(() => {
    if (!companyId || !userId) return;
    load({ companyId, branchId, userId });
    void process();
  }, [companyId, branchId, userId, load, process]);

  // A pass when the server starts answering again.
  useEffect(() => {
    if (!companyId || !userId) return;
    return useConnectivity.subscribe((state, previous) => {
      if (state.online && !previous.online) void process();
    });
  }, [companyId, userId, process]);

  useEffect(() => {
    if (!companyId || !userId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void process();
    });
    return () => sub.remove();
  }, [companyId, userId, process]);
}
