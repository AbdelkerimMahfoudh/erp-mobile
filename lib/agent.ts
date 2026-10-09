import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { invalidateMoney } from './money-invalidation';
import { AGENT_EXCHANGE_KIND, pendingExchanges, provisionalNet } from './offline/agent-exchange';
import { positionRows, type PositionRow } from './agent-positions';
import { useQueue } from './offline/queue';
import { qk } from './query-keys';
import { uuidv4 } from './utils';
import type { AgentDirection, AgentProvider, CommissionDestination, LegAccount, LegDirection, LegKind, PrincipalFeeMode } from './agent-rules';

export type { AgentProvider } from './agent-rules';

/**
 * The money services counter, read from the server (docs/73 §4, D154–D157).
 *
 * The shapes below are the serialized answers of `erp-backend/src/agent`
 * (captured over real HTTP on 2026-10-09). Every figure is the server's: the
 * phone shows a position, a commission, a time or a business day only as the
 * server sent it. The customer's number is masked everywhere but on one
 * exchange's detail, and only for whoever holds `agent.customer.reveal` — the
 * server decides that too, by sending it or not.
 */

// ── Positions ───────────────────────────────────────────────────────────────

export interface DayMovement {
  businessDate: string;
  inflows: number;
  outflows: number;
  net: number;
}

/** One provider float, or the commission a provider holds for the branch. Unknown is null, never 0. */
export interface FloatView {
  providerId: string;
  providerLabel: string;
  providerKind: 'bankily' | 'sedad' | 'other';
  accountKind: 'provider' | 'commission_held';
  known: boolean;
  position: number | null;
  unknownReason: 'no_anchor' | null;
  sinceAnchorNet: number | null;
  anchor: { amount: number; at: string; businessDate: string; byName: string | null; source: 'set' | 'confirmed' | 'counted_close' } | null;
  movement: DayMovement;
}

/** The drawer, exactly as Money's tracked figure reports it — the agent's cash is the drawer's cash (docs/73 §4.5). */
export interface CashView {
  known: boolean;
  position: number | null;
  unknownReason?: string | null;
  movement: DayMovement | null;
  anchor: { source: string; amount: number; at: string | null; businessDate: string; byName: string | null } | null;
}

export interface AgentPositions {
  businessDate: string;
  asOf: string;
  branchId: string;
  cash: CashView;
  floats: FloatView[];
  commissionHeld: FloatView[];
  /** Null while any listed float is unknown: no total over a gap. */
  total: number | null;
  unknownKeys: string[];
}

// ── Exchanges ───────────────────────────────────────────────────────────────

export interface AgentLegView {
  account: LegAccount;
  providerId: string | null;
  direction: LegDirection;
  amount: number;
  kind: LegKind;
}

export interface AgentMistake {
  id: string;
  kind: 'wrong_amount' | 'wrong_direction' | 'wrong_provider' | 'wrong_number' | 'other';
  status: 'open' | 'reversed' | 'dismissed';
  note: string | null;
  reportedByName: string | null;
  reportedAt: string;
}

export const MISTAKE_KINDS: readonly AgentMistake['kind'][] = ['wrong_amount', 'wrong_direction', 'wrong_provider', 'wrong_number', 'other'];

export interface AgentTransaction {
  id: string;
  branchId: string;
  providerId: string;
  providerLabel: string;
  direction: AgentDirection;
  amount: number;
  /** `•••• 1234` — every list and search. */
  customerNumberMasked: string;
  /** Only on the detail, and only for `agent.customer.reveal`. */
  customerNumber?: string;
  providerReference: string | null;
  commission: {
    amount: number;
    rateBp: number;
    destination: CommissionDestination | null;
    principalFeeMode: PrincipalFeeMode | null;
    configVersionId: string;
  };
  legs: AgentLegView[];
  businessDate: string;
  recordedAt: string;
  deviceRecordedAt: string | null;
  recordedBy: { id: string; name: string };
  status: 'completed' | 'reversed';
  reversal: { at: string | null; byName: string | null; reason: string | null } | null;
  mistakes: AgentMistake[];
}

export interface AgentTransactionPage {
  rows: AgentTransaction[];
  nextCursor: string | null;
}

/** The filters the server applies (`GET agent/transactions`); all of them in SQL, the list always masked. */
export interface AgentTransactionFilters {
  from?: string;
  to?: string;
  providerId?: string;
  direction?: AgentDirection;
  recordedById?: string;
  /** Exactly four digits: the masked search, never more of the number. */
  last4?: string;
  /** An exact provider reference. */
  reference?: string;
  status?: 'completed' | 'reversed';
}

/** The day's totals of the counter (`GET agent/reports?period=day`), for Home. */
export interface AgentDayTotals {
  period: string;
  from: string;
  to: string;
  totals: { count: number; volume: number; commission: number; reversals: { count: number; volume: number; commission: number } };
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** The company's providers with the configuration in force — any of the nine keys may read them. */
export function useAgentProviders(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.agentProviders(),
    queryFn: () => api.get<{ providers: AgentProvider[] }>('/agent/providers'),
    enabled: options.enabled ?? true,
  });
}

/** The drawer, every float and every held commission of the branch now. */
export function useAgentPositions(options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.agentPositions(branchId),
    queryFn: () => api.get<AgentPositions>('/agent/positions'),
    enabled: (options.enabled ?? true) && Boolean(branchId),
  });
}

/**
 * The drawer and the floats as the counter shows them: the server's positions,
 * plus — said as Provisional — the legs of the exchanges this phone has not
 * sent yet (docs/73 §5.3). An exchange waiting for a person moves nothing.
 */
export function useCounterPositions(options: { enabled?: boolean } = {}): {
  query: ReturnType<typeof useAgentPositions>;
  rows: PositionRow[] | null;
  provisionalCount: number;
  anchors: Record<string, FloatView['anchor']>;
} {
  const branchId = useBranch((s) => s.branchId);
  const query = useAgentPositions(options);
  const providers = useAgentProviders(options);
  const items = useQueue((s) => s.items);
  const net = provisionalNet(items, branchId, providers.data?.providers ?? []);
  const provisionalCount = pendingExchanges(items, branchId).filter((i) => i.state !== 'needs_attention').length;
  const data = query.data;
  const anchors: Record<string, FloatView['anchor']> = {};
  for (const f of data?.floats ?? []) anchors[`provider:${f.providerId}`] = f.anchor;
  for (const f of data?.commissionHeld ?? []) anchors[`commission_held:${f.providerId}`] = f.anchor;
  return { query, rows: data ? positionRows(data, net) : null, provisionalCount, anchors };
}

/** Today's count, volume and commission — the reports' day, for whoever reads the reports. */
export function useAgentDay(options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.agentReport(branchId, 'day', ''),
    queryFn: () => api.get<AgentDayTotals>('/agent/reports?period=day'),
    enabled: (options.enabled ?? true) && Boolean(branchId),
  });
}

/** The query string of a filter set, keys in a fixed order so equal filters share a cache entry. */
export function transactionQuery(filters: AgentTransactionFilters): string {
  const p = new URLSearchParams();
  for (const key of ['from', 'to', 'providerId', 'direction', 'recordedById', 'last4', 'reference', 'status'] as const) {
    const value = filters[key];
    if (value) p.set(key, value);
  }
  return p.toString();
}

export function useAgentTransactions(filters: AgentTransactionFilters, options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  const qs = transactionQuery(filters);
  return useInfiniteQuery({
    queryKey: qk.agentTransactions(branchId, qs),
    enabled: (options.enabled ?? true) && Boolean(branchId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(qs);
      if (pageParam) p.set('cursor', pageParam);
      const suffix = p.toString();
      return api.get<AgentTransactionPage>(`/agent/transactions${suffix ? `?${suffix}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAgentTransaction(id: string | undefined) {
  return useQuery({
    queryKey: qk.agentTransaction(id ?? ''),
    queryFn: () => api.get<AgentTransaction>(`/agent/transactions/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
  });
}

// ── Decisions: online only (D155) ───────────────────────────────────────────

/** Everything the counter's figures are read from: after an exchange posts or is reversed, all of it is read again. */
export function invalidateAgent(qc: Pick<QueryClient, 'invalidateQueries'>): void {
  for (const key of ['agent-positions', 'agent-transactions', 'agent-transaction', 'agent-report']) void qc.invalidateQueries({ queryKey: [key] });
  // The drawer is one: an exchange's cash moves Money's expected cash and the closing too.
  invalidateMoney(qc);
}

/**
 * A key per attempt, kept until the server answers — the money-anchor pattern:
 * a retry after a lost answer reuses it and gets the same record; a new attempt
 * after a refusal takes a fresh one.
 */
function useAttemptKey() {
  const key = useRef<string | null>(null);
  return {
    take: () => (key.current ??= uuidv4()),
    settle: () => {
      key.current = null;
    },
  };
}

/** The Owner's or a Manager's reversal, once, with a reason that stays (A7). Never queued. */
export function useReverseExchange(id: string) {
  const qc = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: (reason: string) => api.post<AgentTransaction>(`/agent/transactions/${encodeURIComponent(id)}/reverse`, { clientUuid: attempt.take(), reason }),
    onSuccess: () => {
      attempt.settle();
      invalidateAgent(qc);
    },
    onError: (e) => {
      // A refusal on the merits ends the attempt; an answer lost on the way keeps the key for the retry.
      if ((e as { status?: number }).status !== undefined) attempt.settle();
    },
  });
}

/** An Employee's report that an exchange is wrong. It moves nothing; online only. */
export function useReportMistake(id: string) {
  const qc = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: (input: { kind: AgentMistake['kind']; note?: string }) =>
      api.post<{ mistake: AgentMistake }>(`/agent/transactions/${encodeURIComponent(id)}/mistakes`, { clientUuid: attempt.take(), kind: input.kind, ...(input.note ? { note: input.note } : {}) }),
    onSuccess: () => {
      attempt.settle();
      void qc.invalidateQueries({ queryKey: qk.agentTransaction(id) });
    },
    onError: (e) => {
      if ((e as { status?: number }).status !== undefined) attempt.settle();
    },
  });
}

/**
 * Reads the counter's figures again whenever an exchange this phone held is
 * accepted by the server — mounted once, under the tab bar, so every screen
 * that shows a position or the list of exchanges moves with the queue.
 */
export function useExchangeSyncRefresh(): void {
  const qc = useQueryClient();
  const synced = useQueue((s) => s.items.filter((i) => i.kind === AGENT_EXCHANGE_KIND && i.state === 'synced').length);
  const seen = useRef(synced);
  useEffect(() => {
    if (synced !== seen.current) {
      seen.current = synced;
      invalidateAgent(qc);
    }
  }, [synced, qc]);
}
