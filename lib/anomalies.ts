import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { useConnectivity } from './connectivity';
import { qk } from './query-keys';
import type { ServerWarning } from './warnings';

/**
 * What needs attention (A3).
 *
 * ## Read-only, and blank when disconnected
 *
 * Anomalies are worked out by the server from figures that move all day. A
 * cached one is a claim about yesterday's cash or last week's stock, and a
 * stale warning about money is worse than no warning at all — so offline this
 * shows nothing rather than something that used to be true. `docs/46` says so
 * in as many words, and `enabled: online` is where that decision lives.
 *
 * ## Six sentences, not a score
 *
 * Each row arrives as a key and its numbers. The app renders the sentence in
 * the reader's language and the numbers are the ones that produced it, so a
 * shopkeeper can check the claim rather than trust it.
 */

export interface Anomaly extends ServerWarning {
  /** Stable identity — `anomaly.<rule>:<subject>`. What a dismissal names. */
  key: string;
}

export interface AnomalyResponse {
  rows: Anomaly[];
  /** When the server worked these out. Shown, because figures move. */
  generatedAt: string;
  windowDays: number;
}

export function useAnomalies() {
  const branchId = useBranch((s) => s.branchId);
  const online = useConnectivity((s) => s.online);

  return useQuery({
    queryKey: qk.anomalies(branchId),
    queryFn: () => api.get<AnomalyResponse>('/anomalies'),
    enabled: online,
    /*
     * Two minutes. Slow enough that a shop's screen is not a polling client,
     * fast enough that "three left" does not sit there after the last one
     * sells. Anything sharper would be a dashboard pretending to be live.
     */
    refetchInterval: 120_000,
  });
}

/**
 * "I know about this one" — for seven days, for the whole company.
 *
 * Company-wide is the server's decision and the right one: an anomaly is about
 * the business, and making each person dismiss the same shortfall separately
 * turns a prompt into paperwork.
 */
export function useDismissAnomaly() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: (key: string) => api.post(`/anomalies/${encodeURIComponent(key)}/dismiss`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.anomalies(branchId) });
      // The three that notify have already reached somebody's bell.
      void qc.invalidateQueries({ queryKey: qk.notifications });
    },
  });
}
