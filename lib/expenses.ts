import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import type { Expense, ExpensePage, ExpenseStatus } from '../types/api';

/**
 * Expenses (Milestone D).
 *
 * Two authorities, and the screens must keep them apart: anyone may **report**
 * what they spent, only an Owner may **confirm** it. A report moves no money
 * and reaches no figure — the till and the day's profit change at confirmation
 * and nowhere else.
 *
 * A submitter sees only their own expenses. That is enforced by the server;
 * the screens simply never promise otherwise.
 */

export function useExpenses(status?: ExpenseStatus, date?: string) {
  const branchId = useBranch((s) => s.branchId);
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (date) params.set('date', date);
  const qs = params.toString();

  return useQuery({
    queryKey: qk.expenses(branchId, `${status ?? ''}|${date ?? ''}`),
    queryFn: () => api.get<ExpensePage>(`/expenses${qs ? `?${qs}` : ''}`),
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: qk.expense(id ?? ''),
    queryFn: () => api.get<Expense>(`/expenses/${id}`),
    enabled: Boolean(id),
  });
}

export interface ReportExpenseBody {
  category: string;
  amount: number;
  expenseClass?: 'variable' | 'fixed';
  isSalary?: boolean;
  /** Required for a fixed expense, forbidden for a variable one. */
  dueDate?: string;
  method?: 'cash' | 'account';
  receivingAccountId?: string;
  reference?: string;
  note?: string;
  clientUuid: string;
}

export function useReportExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportExpenseBody) => api.post<Expense>('/expenses', body),
    // A report changes no figure, so only the expense lists are stale.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense'] });
    },
  });
}

export function useConfirmExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { expectedVersion: number; reasonOmitted?: boolean }) =>
      api.post<Expense>(`/expenses/${id}/confirm`, body),
    /**
     * Confirmation moves cash and the day's profit, so the closing figures and
     * the home dashboard the user is about to look at are both stale.
     */
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRejectExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { expectedVersion: number; reason?: string }) =>
      api.post<Expense>(`/expenses/${id}/reject`, body),
    onSuccess: () => invalidateAll(qc),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['expenses', 'expense', 'home', 'closing', 'dashboard']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

export type ExpenseConflict =
  | 'stale'
  | 'already_decided'
  | 'day_locked'
  | 'idempotency'
  | 'other';

/** Turn a 409 into the sentence that actually explains it. */
export function expenseConflictKind(e: unknown): ExpenseConflict | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const code = (e.body as { code?: string } | undefined)?.code ?? '';
  if (code === 'refresh_required' || code === 'stale_version') return 'stale';
  if (code === 'already_decided' || code === 'already_confirmed') return 'already_decided';
  if (code === 'day_already_closed') return 'day_locked';
  if (code === 'idempotency_conflict') return 'idempotency';
  return 'other';
}

/**
 * Whether confirming this expense should warn first.
 *
 * An expense with no note is money leaving the business with nothing said about
 * why. The Owner may still confirm it — small shops genuinely have petty cash —
 * but they are asked, and the answer is recorded as `reasonOmitted` rather than
 * dressed up with placeholder copy.
 */
export function needsReasonWarning(expense: Pick<Expense, 'note'>): boolean {
  return !(expense.note ?? '').trim();
}
