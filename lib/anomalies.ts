import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { ATTENTION_PREVIEW, hasMoreAlerts } from './attention-rules';
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
 * ## Sentences, not a score — and newest first
 *
 * Each row arrives as a key and its numbers. The app renders the sentence in
 * the reader's language and the numbers are the ones that produced it, so a
 * shopkeeper can check the claim rather than trust it. The server orders the
 * rows — newest by each rule's own instant, then the serious, then by key —
 * and the app never re-sorts, so the overview's three and the full list agree.
 */

export interface Anomaly extends ServerWarning {
  /** Stable identity — `anomaly.<rule>:<subject>`. What a dismissal names. */
  key: string;
  /** When this became true, from the rule's own records. Null when it has no natural instant. */
  at: string | null;
}

export interface AnomalyPage {
  rows: Anomaly[];
  /** How many there are altogether, whatever page this is. */
  total: number;
  page: number;
  pageSize: number;
  /** When the server worked these out. Shown, because figures move. */
  generatedAt: string;
  windowDays: number;
}

/** The full list reads twenty at a time. */
export const ALERTS_PAGE_SIZE = 20;

const pageOf = (limit: number, page: number) =>
  api.get<AnomalyPage>(`/anomalies?limit=${limit}&page=${page}`);

/** The overview's preview: the three newest, and how many there are. */
export function useAnomalies() {
  const branchId = useBranch((s) => s.branchId);
  const online = useConnectivity((s) => s.online);

  return useQuery({
    queryKey: qk.anomalies(branchId, { limit: ATTENTION_PREVIEW, page: 1 }),
    queryFn: () => pageOf(ATTENTION_PREVIEW, 1),
    enabled: online,
    /*
     * Two minutes. Slow enough that a shop's screen is not a polling client,
     * fast enough that "three left" does not sit there after the last one
     * sells. Anything sharper would be a dashboard pretending to be live.
     */
    refetchInterval: 120_000,
    // The old three stay on screen while the next three load; no flicker.
    placeholderData: keepPreviousData,
  });
}

/** Every alert, a page at a time, in the same order the overview uses. */
export function useAnomalyList() {
  const branchId = useBranch((s) => s.branchId);
  const online = useConnectivity((s) => s.online);

  return useInfiniteQuery({
    queryKey: qk.anomalies(branchId, { limit: ALERTS_PAGE_SIZE, page: 'all' }),
    queryFn: ({ pageParam }) => pageOf(ALERTS_PAGE_SIZE, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (hasMoreAlerts(last) ? last.page + 1 : undefined),
    enabled: online,
  });
}

/**
 * "I understand" — for seven days, for the whole company.
 *
 * Company-wide is the server's decision and the right one: an anomaly is about
 * the business, and making each person dismiss the same shortfall separately
 * turns a prompt into paperwork. The server answers a repeat with the
 * dismissal that already stands, so a double tap is one decision.
 *
 * Every anomaly query is invalidated afterwards — the overview's three and the
 * full list's pages — so the next row moves up everywhere at once.
 */
export function useDismissAnomaly() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: (key: string) =>
      api.post<{ key: string; suppressedUntil: string; replayed: boolean }>(
        `/anomalies/${encodeURIComponent(key)}/dismiss`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.anomalies(branchId) });
      // The three that notify have already reached somebody's bell.
      void qc.invalidateQueries({ queryKey: qk.notifications });
    },
  });
}

/** The undo behind the toast: a standing dismissal is ended, and the row comes back. */
export function useUndismissAnomaly() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: (key: string) =>
      api.post<{ key: string; restored: boolean }>(`/anomalies/${encodeURIComponent(key)}/undismiss`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.anomalies(branchId) });
    },
  });
}
