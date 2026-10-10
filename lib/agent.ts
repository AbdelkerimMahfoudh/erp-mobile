import { useCallback, useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { invalidateMoney } from './money-invalidation';
import { AGENT_EXCHANGE_KIND, exchangesToSend, provisionalNet } from './offline/agent-exchange';
import { positionRows, type PositionRow } from './agent-positions';
import { useQueue } from './offline/queue';
import { qk } from './query-keys';
import { uuidv4 } from './utils';
import { exchangesHeld, type ExternalCounterparty, type FloatAccountKind, type RebalancingBody } from './agent-money';
import type { ConfigBody, ProviderKind } from './agent-providers';
import type { ReportPeriod } from './agent-reports';
import type { AgentDirection, AgentProvider, CommissionDestination, LegAccount, LegDirection, LegKind, PrincipalFeeMode, ProviderConfig } from './agent-rules';

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

// ── Reports ─────────────────────────────────────────────────────────────────

/** What a period's reversals took back: listed apart, never inside the count, the volume or the commission. */
export interface ReportReversals {
  count: number;
  volume: number;
  commission: number;
}

/** A period's money moved between the drawer and the floats, or with the outside: never an exchange (A8). */
export interface ReportRebalancings {
  count: number;
  cashIn: number;
  cashOut: number;
  floatIn: number;
  floatOut: number;
}

/** Completed exchanges of the period, never reversed within it: their count, volume, both sides and commission. */
export interface ReportFigures {
  count: number;
  volume: number;
  cashReceived: number;
  cashPaid: number;
  creditSent: number;
  creditReceived: number;
  commission: number;
  reversals: ReportReversals;
}

export interface ReportTotals extends ReportFigures {
  rebalancings: ReportRebalancings;
}

/** A float count whose difference opened a question at a closing of the period. */
export interface ReportDiscrepancy {
  businessDate: string;
  providerId: string;
  label: string;
  /** Null when the app did not know the float: counted against nothing, no difference fabricated. */
  expected: number | null;
  counted: number | null;
  difference: number;
  explanation: string | null;
  /** The question's state (`pending_investigation`, `resolved`), or null when none was kept. */
  status: string | null;
}

/** `GET agent/reports` — one period of the counter, every figure the server's (D157). */
export interface AgentReport {
  period: ReportPeriod;
  from: string;
  to: string;
  totals: ReportTotals;
  byProvider: (ReportFigures & { providerId: string; label: string })[];
  byEmployee: { userId: string; name: string; count: number; volume: number; commission: number; reversals: { count: number } }[];
  /** The year only, month by month. */
  byMonth?: (ReportTotals & { month: string })[];
  positions: { floats: FloatView[]; discrepancies: ReportDiscrepancy[] };
}

// ── Rebalancings ───────────────────────────────────────────────────────────

export interface AgentRebalancing {
  id: string;
  reason: string;
  note: string | null;
  legs: AgentLegView[];
  externalCounterparty: ExternalCounterparty | null;
  externalAmount: number | null;
  businessDate: string;
  recordedAt: string;
  recordedBy: { id: string; name: string };
}

/** A provider float, or a held commission, as the Owner set it (`POST agent/positions`). */
export interface FloatSet {
  position: { id: string; providerId: string; accountKind: FloatAccountKind; amount: number; at: string; businessDate: string; trackedBefore: number | null; difference: number | null; note: string | null; byName: string | null };
  float: FloatView;
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
  const provisionalCount = exchangesToSend(items, branchId).length;
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

/**
 * One period of the counter: a day, a week, a month or a year around a
 * business date — the branch's current one while `date` is absent. Today's day
 * shares Home's entry, so the two never show different counts.
 */
export function useAgentReport(period: ReportPeriod, date: string | null, options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.agentReport(branchId, period, date ?? ''),
    queryFn: () => api.get<AgentReport>(`/agent/reports?period=${period}${date ? `&date=${date}` : ''}`),
    enabled: (options.enabled ?? true) && Boolean(branchId),
  });
}

/**
 * The exchanges still on this phone for the branch, and what they will move in
 * the drawer — beside Money's drawer figure, said as Provisional (docs/73
 * §5.3). An exchange waiting for a person moves nothing until it is sent again.
 */
export function useQueuedCash(providers: readonly AgentProvider[]): { count: number; cashNet: number } {
  const branchId = useBranch((s) => s.branchId);
  const items = useQueue((s) => s.items);
  const count = exchangesToSend(items, branchId).length;
  return { count, cashNet: provisionalNet(items, branchId, providers).cash ?? 0 };
}

/**
 * How many exchanges this phone still holds for the branch — waiting, on their
 * way, uncertain, or refused and not yet removed (D161). While there is one,
 * the phone does not start the closing or count a float (D155).
 */
export function useExchangesHeld(): number {
  const branchId = useBranch((s) => s.branchId);
  const items = useQueue((s) => s.items);
  return exchangesHeld(items, branchId);
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
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.agentTransaction(branchId, id ?? ''),
    queryFn: () => api.get<AgentTransaction>(`/agent/transactions/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
  });
}

// ── Decisions: online only (D155) ───────────────────────────────────────────

/** Everything the counter's figures are read from: after an exchange posts or is reversed, all of it is read again. */
export function invalidateAgent(qc: Pick<QueryClient, 'invalidateQueries'>): void {
  for (const key of ['agent-positions', 'agent-transactions', 'agent-transaction', 'agent-report', 'agent-rebalancings', 'agent-providers']) void qc.invalidateQueries({ queryKey: [key] });
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
      // Every branch's copy of this exchange: the key's prefix.
      void qc.invalidateQueries({ queryKey: ['agent-transaction'] });
    },
    onError: (e) => {
      if ((e as { status?: number }).status !== undefined) attempt.settle();
    },
  });
}

/**
 * A key per payload within one attempt — the company accounts sheet's pattern
 * (`useRecordMoneyAnchor`, 0082): a retry of the same figures keeps its key, so
 * "Save" again after a lost answer is the same record, never a second one; a
 * changed figure is a new record under a new key, never a refused conflict.
 * `reset()` starts a new attempt — as a sheet opens and closes — so the same
 * figures saved another time are a new record, never the replay of an old one.
 */
function usePayloadKey() {
  const attempt = useRef<{ clientUuid: string; payload: string } | null>(null);
  const keyFor = useCallback((payload: unknown) => {
    const sent = JSON.stringify(payload);
    if (attempt.current?.payload !== sent) attempt.current = { clientUuid: uuidv4(), payload: sent };
    return attempt.current.clientUuid;
  }, []);
  const clear = useCallback(() => {
    attempt.current = null;
  }, []);
  return { keyFor, clear };
}

export interface SetFloatInput {
  providerId: string;
  accountKind: FloatAccountKind;
  amount: number;
  note: string;
}

/**
 * The Owner saying what a float — or the commission a provider holds — holds
 * now at this branch, read off the provider's own app (docs/73 §4.4,
 * `agent.position.set`). From the server's instant on, the app tracks it plus
 * every leg recorded after. Online only, like every position (D155).
 */
export function useSetFloat() {
  const qc = useQueryClient();
  const { keyFor, clear } = usePayloadKey();
  const mutation = useMutation({
    mutationFn: ({ providerId, accountKind, amount, note }: SetFloatInput) => {
      const payload = { providerId, accountKind, amount, ...(note.trim() ? { note: note.trim() } : {}) };
      return api.post<FloatSet>('/agent/positions', { clientUuid: keyFor(payload), ...payload });
    },
    onSuccess: clear,
    // After a failure too: a lost answer may still have saved it, and the figures are read again either way.
    onSettled: () => invalidateAgent(qc),
  });
  const { reset: resetMutation } = mutation;
  const reset = useCallback(() => {
    clear();
    resetMutation();
  }, [clear, resetMutation]);
  return { ...mutation, reset };
}

/**
 * Money moved between the drawer and the floats, or with the outside (A8):
 * the Owner's or a Manager's, online only. The same lines resent after a lost
 * answer keep their key; `confirmNegative` — the Owner's word that a position
 * may go below zero — is part of what is sent, so confirming is a new request.
 */
export function useRecordRebalancing() {
  const qc = useQueryClient();
  const { keyFor, clear } = usePayloadKey();
  const mutation = useMutation({
    mutationFn: (body: RebalancingBody & { confirmNegative?: boolean }) =>
      api.post<{ rebalancing: AgentRebalancing }>('/agent/rebalancings', { clientUuid: keyFor(body), ...body }),
    onSuccess: clear,
    onSettled: () => invalidateAgent(qc),
  });
  const { reset: resetMutation } = mutation;
  const reset = useCallback(() => {
    clear();
    resetMutation();
  }, [clear, resetMutation]);
  return { ...mutation, reset };
}

/** The branch's rebalancings over business dates — the current day when none is given. */
export function useAgentRebalancings(range: { from?: string; to?: string } = {}, options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  const p = new URLSearchParams();
  if (range.from) p.set('from', range.from);
  if (range.to) p.set('to', range.to);
  const qs = p.toString();
  return useQuery({
    queryKey: qk.agentRebalancings(branchId, range.from ?? '', range.to ?? ''),
    queryFn: () => api.get<{ from: string; to: string; rows: AgentRebalancing[] }>(`/agent/rebalancings${qs ? `?${qs}` : ''}`),
    enabled: (options.enabled ?? true) && Boolean(branchId),
  });
}

// ── Providers (the Owner's) ─────────────────────────────────────────────────

/** A provider and everything read from it: the list, its versions, and the counter's offer of it. */
function invalidateProviders(qc: Pick<QueryClient, 'invalidateQueries'>, providerId?: string): void {
  void qc.invalidateQueries({ queryKey: qk.agentProviders() });
  if (providerId) void qc.invalidateQueries({ queryKey: qk.agentProviderConfigs(providerId) });
  // A provider switched on or off is listed, or not, among the floats.
  void qc.invalidateQueries({ queryKey: ['agent-positions'] });
}

/** Add a provider the counters exchange credit with. Company-wide; it posts nothing until its configuration is complete. */
export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: ProviderKind; label: string }) => api.post<AgentProvider>('/agent/providers', { kind: input.kind, label: input.label.trim() }),
    onSuccess: (created) => invalidateProviders(qc, created.id),
  });
}

/** Rename a provider, or switch it off or on: switched off, it takes no new exchange; its float and history stay. */
export function useUpdateProvider(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { label?: string; isActive?: boolean }) => api.patch<AgentProvider>(`/agent/providers/${encodeURIComponent(id)}`, input),
    onSuccess: () => invalidateProviders(qc, id),
  });
}

/**
 * A new configuration version, in force from the server's instant. Append-only:
 * the version an exchange used is never edited. An exchange this phone prepared
 * under the older version is refused as stale and shown for a person to see the
 * new rate (D155).
 */
export function useAddProviderConfig(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfigBody) => api.post<{ config: ProviderConfig; provider: AgentProvider }>(`/agent/providers/${encodeURIComponent(id)}/configs`, body),
    onSuccess: () => invalidateProviders(qc, id),
  });
}

/** Every version of a provider's configuration, newest first: the history behind every exchange's rate. */
export function useProviderConfigs(id: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.agentProviderConfigs(id ?? ''),
    queryFn: () => api.get<{ configs: ProviderConfig[] }>(`/agent/providers/${encodeURIComponent(id ?? '')}/configs`),
    enabled: (options.enabled ?? true) && Boolean(id),
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
