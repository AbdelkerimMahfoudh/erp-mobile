import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { isKnownConsignmentStatus } from './custody-state';
import type { TranslationKey } from './i18n';
import { qk } from './query-keys';

/**
 * Inter-store consignment (Milestone H).
 *
 * Everything here crosses a company boundary, so the guiding rule for the
 * screens is that **they can only show what the server sent** — and the server
 * never sends the other side's cost, resale price, customer or margin. The
 * privacy is structural: a screen cannot leak what it never receives.
 *
 * The one thing the screens must get right on their own is language. A payment
 * REPORT is not a payment, and "confirmed" means the money arrived or the phone
 * came back — never merely that somebody agreed to the deal.
 */

// ── Discovery and connections ───────────────────────────────────────────────

export interface StorePreview {
  publicStoreId: string;
  name: string;
  city: string | null;
  logoRef: string | null;
  /** A literal placeholder. Never render it as an achieved badge. */
  verification: 'Verified badge coming soon';
}

export type ConnectionStatus = 'pending' | 'accepted' | 'rejected' | 'blocked';

export interface Connection {
  id: string;
  status: ConnectionStatus;
  /** Which way round it was asked, so the screen never makes you work it out. */
  direction: 'outgoing' | 'incoming';
  canDecide: boolean;
  blockedByMe: boolean;
  blockReason: string | null;
  note: string | null;
  store: StorePreview & { phone: string | null };
  createdAt: string;
  version: number;
}

export function useStoreSearch(query: string) {
  return useQuery({
    queryKey: qk.storeSearch(query),
    queryFn: () => api.get<{ rows: StorePreview[] }>(`/stores/search?q=${encodeURIComponent(query)}`),
    // Three characters is the server's minimum; asking earlier only produces
    // a 400 the shopkeeper has to read.
    enabled: query.trim().length >= 3,
  });
}

export function useConnections() {
  return useQuery({
    queryKey: qk.connections(),
    queryFn: () => api.get<{ rows: Connection[] }>('/connections'),
  });
}

export function useRequestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { publicStoreId: string; note?: string }) =>
      api.post<{ rows: Connection[] }>('/connections', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.connections() }),
  });
}

export function useDecideConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accept, expectedVersion }: { id: string; accept: boolean; expectedVersion?: number }) =>
      api.post<{ rows: Connection[] }>(`/connections/${id}/decide`, { accept, expectedVersion }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.connections() }),
  });
}

export function useBlockConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, blocked, reason }: { id: string; blocked: boolean; reason?: string }) =>
      api.post<{ rows: Connection[] }>(`/connections/${id}/block`, { blocked, reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.connections() }),
  });
}

export interface Counterparty {
  id: string;
  kind: 'connected_store' | 'manual_store' | 'manual_person' | 'employee';
  name: string;
  phone: string | null;
  city: string | null;
  note: string | null;
  connectedStoreId: string | null;
}

export function useCounterparties() {
  return useQuery({
    queryKey: qk.counterparties(),
    queryFn: () => api.get<{ rows: Counterparty[] }>('/counterparties'),
  });
}

export function useCreateCounterparty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: 'manual_store' | 'manual_person'; name: string; phone?: string; city?: string; note?: string }) =>
      api.post<{ rows: Counterparty[] }>('/counterparties', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.counterparties() }),
  });
}

// ── Consignments ────────────────────────────────────────────────────────────

export type ConsignmentGroup = 'pending' | 'accepted' | 'confirmed';
export type Side = 'source' | 'destination';

export interface ConsignmentSummary {
  id: string;
  status: string;
  /**
   * Which tab this belongs in. Taken from the server, never re-derived: the
   * grouping encodes a product decision — "confirmed" means the money arrived
   * or the phone came back — and a second copy of it here would drift.
   */
  group: ConsignmentGroup;
  statusText: string;
  side: Side;
  /** Always the OTHER party, whichever side you are on. */
  otherParty: string;
  phones: number;
  proposedAmount: number | null;
  counterAmount: number | null;
  agreedAmount: number | null;
  amountIsMutable: boolean;
  createdAt: string;
  version: number;
}

export interface ConsignmentLine {
  id: string;
  brand: string | null;
  model: string;
  variant: string | null;
  identifier: string;
  conditionNote: string | null;
  /** Faults the sender disclosed, so "I was not told" is answerable. */
  defectNote: string | null;
  status: 'proposed' | 'in_custody' | 'sold' | 'returned' | 'cancelled';
  disposition: string | null;
  returnCondition: string | null;
}

export interface LedgerEntry {
  id: string;
  kind:
    | 'receivable_raised'
    | 'payment_reported'
    | 'payment_confirmed'
    | 'payment_corrected'
    | 'forgiven'
    | 'settled';
  amount: number;
  method: 'cash' | 'account' | null;
  accountLabel: string | null;
  reference: string | null;
  reason: string | null;
  date: string;
  byMe: boolean;
}

export interface ConsignmentDetail extends ConsignmentSummary {
  note: string | null;
  disputeReason: string | null;
  lines: ConsignmentLine[];
  ledger: LedgerEntry[];
}

export function useConsignments(group?: ConsignmentGroup) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.consignments(branchId, group ?? 'all'),
    queryFn: () =>
      api.get<{ rows: ConsignmentSummary[] }>(`/consignments${group ? `?group=${group}` : ''}`),
  });
}

export function useConsignment(id: string | undefined) {
  return useQuery({
    queryKey: qk.consignment(id ?? ''),
    queryFn: () => api.get<ConsignmentDetail>(`/consignments/${id}`),
    enabled: Boolean(id),
  });
}

/** Every write shares one invalidation, so no screen shows a stale balance. */
function useConsignmentMutation<TBody>(path: (id: string) => string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TBody }) =>
      api.post<ConsignmentDetail>(path(id), body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.consignment(vars.id) });
      void qc.invalidateQueries({ queryKey: qk.consignments(branchId, 'all') });
      for (const g of ['pending', 'accepted', 'confirmed'] as const) {
        void qc.invalidateQueries({ queryKey: qk.consignments(branchId, g) });
      }
      // Stock genuinely moved, so anything counting it is stale.
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export const useDecideConsignment = () =>
  useConsignmentMutation<{
    action: 'accept' | 'counter' | 'dispute' | 'reject' | 'cancel';
    amount?: number;
    reason?: string;
    expectedVersion?: number;
  }>((id) => `/consignments/${id}/decide`);

export const useCustody = () =>
  useConsignmentMutation<{ action: 'send' | 'confirm'; identifiers?: string[] }>(
    (id) => `/consignments/${id}/custody`,
  );

export const useReportSold = () =>
  useConsignmentMutation<{ lineIds?: string[] }>((id) => `/consignments/${id}/sold`);

export const useConsignmentPayment = () =>
  useConsignmentMutation<{
    action: 'report' | 'confirm';
    amount?: number;
    method?: 'cash' | 'account';
    receivingAccountId?: string;
    reference?: string;
    entryId?: string;
    clientUuid?: string;
  }>((id) => `/consignments/${id}/payment`);

export const useForgiveConsignment = () =>
  useConsignmentMutation<{ amount: number; reason: string }>((id) => `/consignments/${id}/forgive`);

export const useConsignmentReturn = () =>
  useConsignmentMutation<{ action: 'initiate' | 'ship' | 'confirm'; condition?: 'good' | 'damaged'; note?: string }>(
    (id) => `/consignments/${id}/return`,
  );

export function useCreateConsignment() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (body: {
      counterpartyId: string;
      unitIds: string[];
      proposedAmount: number;
      conditionNote?: string;
      defectNote?: string;
      note?: string;
      clientUuid?: string;
    }) => api.post<ConsignmentDetail>('/consignments', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.consignments(branchId, 'all') });
      void qc.invalidateQueries({ queryKey: qk.consignments(branchId, 'pending') });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

// ── Derived, for the screens ────────────────────────────────────────────────

/**
 * What is still owed, from the ledger the server sent.
 *
 * Mirrors the server's `BALANCE_EFFECT` deliberately and is used only for
 * display — every refusal is still decided server-side. A reported payment
 * counts for **nothing** here, exactly as it does there: showing it as settled
 * would tell a shop it had been paid when the creditor has not agreed.
 */
export function outstandingOf(ledger: LedgerEntry[]): number {
  const effect: Record<LedgerEntry['kind'], number> = {
    receivable_raised: 1,
    payment_reported: 0,
    payment_confirmed: -1,
    payment_corrected: 1,
    forgiven: -1,
    settled: 0,
  };
  const total = ledger.reduce((sum, e) => sum + effect[e.kind] * e.amount, 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Reported but not yet confirmed — shown separately, never deducted. */
export function awaitingConfirmation(ledger: LedgerEntry[]): number {
  const reported = ledger.filter((e) => e.kind === 'payment_reported');
  const confirmed = ledger.filter((e) => e.kind === 'payment_confirmed').length;
  // Each confirmation answers one report, oldest first.
  return reported.slice(confirmed).reduce((s, e) => s + e.amount, 0);
}

/**
 * The status in the reader's language. The server's `statusText` is English
 * wording for its own messages; a screen shows this instead, and an unknown
 * status says so rather than leaking a raw code.
 */
export function consignmentStatusLabel(status: string, t: (key: TranslationKey) => string): string {
  return isKnownConsignmentStatus(status)
    ? t(`consignment.status.${status}` as TranslationKey)
    : t('consignment.status.unknown');
}

export function groupTone(group: ConsignmentGroup): 'warning' | 'info' | 'success' {
  return group === 'pending' ? 'warning' : group === 'accepted' ? 'info' : 'success';
}
