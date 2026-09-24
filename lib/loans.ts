import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import type { TranslationKey } from './i18n';
import { qk } from './query-keys';

/**
 * Money owed and money lent (Milestone I).
 *
 * A loan is not a consignment with the phone left out. There is no stock, no
 * custody and no disposition — only an amount two people have to agree on, and
 * a history of what has been paid against it.
 *
 * Two things the screens must never get wrong:
 *
 * - **Direction is a fact the server states**, never something inferred from a
 *   sign. The same row reads `they_owe_us` to one shop and `we_owe_them` to the
 *   other; both are correct, and neither is a negative number.
 * - **A reported payment is a claim.** It is shown, and it is never subtracted.
 *   Only the person owed the money can turn it into a payment.
 */

export type LoanDirection = 'they_owe_us' | 'we_owe_them';
export type LoanGroup = 'pending' | 'accepted' | 'confirmed';

export interface LoanSummary {
  id: string;
  status: string;
  /**
   * Which tab this belongs in, taken from the server rather than re-derived
   * here. The grouping encodes a product decision — Confirmed means the money
   * actually moved, not that somebody agreed it should — and a second copy of
   * that rule in the client would eventually disagree with the first.
   */
  group: LoanGroup;
  statusText: string;
  /** From THIS company's point of view, already flipped by the server. */
  direction: LoanDirection;
  /** Always the OTHER party, whichever side you are on. */
  otherParty: string;
  proposedAmount: number;
  counterAmount: number | null;
  /** Null until somebody accepted. Immutable once set. */
  principal: number | null;
  remaining: number;
  createdAt: string;
  version: number;
}

export interface LoanLedgerEntry {
  id: string;
  kind:
    | 'principal_accepted'
    | 'payment_reported'
    | 'payment_confirmed'
    | 'payment_corrected'
    | 'forgiven'
    | 'settled';
  amount: number;
  /** The entry this one answers, when it answers one. */
  refersToId: string | null;
  method: 'cash' | 'account' | null;
  accountLabel: string | null;
  reference: string | null;
  /** A note somebody attached. Never presented as verification of payment. */
  evidenceRef: string | null;
  reason: string | null;
  date: string;
  byMe: boolean;
}

/** Every figure the server calculated, so no screen invents a balance. */
export interface LoanBreakdown {
  principal: number;
  confirmedPaid: number;
  corrected: number;
  forgiven: number;
  awaitingConfirmation: number;
  remaining: number;
}

export interface LoanDetail extends LoanSummary {
  note: string | null;
  disputeReason: string | null;
  breakdown: LoanBreakdown;
  ledger: LoanLedgerEntry[];
}

export interface ClosingReminders {
  proposalsNeedingAnswer: number;
  paymentsAwaitingConfirmation: number;
  balancesOutstanding: number;
  totalOutstanding: number;
  /**
   * Always false. Read from the payload rather than assumed, so if the rule
   * ever changed the screen would not keep quietly asserting the old one.
   */
  affectsExpectedCash: boolean;
}

export function useLoans(group?: LoanGroup) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.loans(branchId, group ?? 'all'),
    queryFn: () => api.get<{ rows: LoanSummary[] }>(`/loans${group ? `?group=${group}` : ''}`),
  });
}

export function useLoan(id: string | undefined) {
  // Wait for the branch to be restored: the server resolves permissions from
  // `X-Branch-Id`, so asking before it exists is a 403 the screen shows as an
  // error. Same race a deep link into a transfer lost on a cold start.
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.loan(id ?? ''),
    queryFn: () => api.get<LoanDetail>(`/loans/${id}`),
    enabled: Boolean(id) && Boolean(branchId),
  });
}

/**
 * What is waiting, shown on the closing screen.
 *
 * Deliberately its own query rather than folded into the closing payload: it is
 * loan data displayed beside a closing, and it changes no figure the closing
 * computes. Keeping it separate makes that impossible to get wrong by accident.
 */
export function useClosingReminders(enabled = true) {
  return useQuery({
    queryKey: qk.loanReminders(),
    queryFn: () => api.get<ClosingReminders>('/loans/closing-reminders'),
    enabled,
  });
}

/** One invalidation for every write, so no screen shows a stale balance. */
function useLoanMutation<TBody>(path: (id: string) => string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TBody }) => api.post<LoanDetail>(path(id), body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.loan(vars.id) });
      void qc.invalidateQueries({ queryKey: qk.loans(branchId, 'all') });
      for (const g of ['pending', 'accepted', 'confirmed'] as const) {
        void qc.invalidateQueries({ queryKey: qk.loans(branchId, g) });
      }
      void qc.invalidateQueries({ queryKey: qk.loanReminders() });
    },
  });
}

export const useDecideLoan = () =>
  useLoanMutation<{
    action: 'accept' | 'counter' | 'dispute' | 'reject' | 'cancel';
    amount?: number;
    reason?: string;
    expectedVersion?: number;
  }>((id) => `/loans/${id}/decide`);

export const useLoanPayment = () =>
  useLoanMutation<{
    action: 'report' | 'confirm' | 'correct';
    amount?: number;
    method?: 'cash' | 'account';
    receivingAccountId?: string;
    reference?: string;
    evidenceRef?: string;
    reason?: string;
    entryId?: string;
    clientUuid?: string;
  }>((id) => `/loans/${id}/payment`);

export const useForgiveLoan = () =>
  useLoanMutation<{ amount: number; reason: string }>((id) => `/loans/${id}/forgive`);

export function useCreateLoan() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (body: {
      counterpartyId: string;
      direction: LoanDirection;
      amount: number;
      note?: string;
      clientUuid?: string;
    }) => api.post<LoanDetail>('/loans', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.loans(branchId, 'all') });
      void qc.invalidateQueries({ queryKey: qk.loans(branchId, 'pending') });
      void qc.invalidateQueries({ queryKey: qk.loanReminders() });
    },
  });
}

// ── Derived, for the screens ────────────────────────────────────────────────

/**
 * Whether THIS company is the one owed the money.
 *
 * Mirrors the server's rule so a button can be hidden rather than offered and
 * then refused — the refusal itself still comes from the server. Read off the
 * direction, never off who created the record: the debtor confirming their own
 * repayment is the mistake this exists to prevent.
 */
export function iAmOwed(loan: Pick<LoanSummary, 'direction'>): boolean {
  return loan.direction === 'they_owe_us';
}

const LOAN_STATUSES = [
  'proposed',
  'counter_proposed',
  'disputed',
  'accepted',
  'partially_paid',
  'payment_awaiting_confirmation',
  'settled',
  'forgiven_settled',
  'cancelled',
] as const;

/**
 * The status in the reader's language. The server's `statusText` is English
 * wording for its own messages; a screen shows this, and an unknown status says
 * so rather than leaking a raw code.
 */
export function loanStatusLabel(status: string, t: (key: TranslationKey) => string): string {
  return (LOAN_STATUSES as readonly string[]).includes(status)
    ? t(`loans.status.${status}` as TranslationKey)
    : t('loans.status.unknown');
}

export function groupTone(group: LoanGroup): 'warning' | 'info' | 'success' {
  return group === 'pending' ? 'warning' : group === 'accepted' ? 'info' : 'success';
}

/** Red for money we owe, green for money coming back to us. */
export function directionTone(direction: LoanDirection): 'success' | 'danger' {
  return direction === 'they_owe_us' ? 'success' : 'danger';
}
