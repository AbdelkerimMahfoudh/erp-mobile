import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import type { Expense, ExpensePage, ExpenseStatus } from '../types/api';
import { invalidateMoney } from './money-invalidation';
import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';
import { API_V1_URL, TOKEN_KEYS } from '../constants/config';
import { getItem } from './storage';

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
  /** The day it was spent, YYYY-MM-DD. The accounting day is still the day it is confirmed. */
  spentOn?: string;
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
  invalidateMoney(qc);
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

/** A photo chosen for a receipt: where it is, and what it is. */
export interface ReceiptPhoto {
  uri: string;
  mimeType?: string | null;
  /** On web the picker hands over the file itself. */
  file?: unknown;
}

/**
 * Attach a receipt photo to an expense (0074).
 *
 * Sent the way the file import sends a workbook: on a phone the platform's own
 * uploader reads the photo from its uri and builds the multipart body, so a uri
 * React Native cannot open never uploads nothing; on web the chosen File is
 * sent as-is. The server decides from the bytes whether it is an image.
 */
export function useUploadReceipt() {
  const branchId = useBranch((s) => s.branchId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ expenseId, photo }: { expenseId: string; photo: ReceiptPhoto }) => {
      const token = await getItem(TOKEN_KEYS.ACCESS_TOKEN);
      const url = `${API_V1_URL}/expenses/${expenseId}/receipt`;
      const headers = {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(branchId ? { 'x-branch-id': branchId } : {}),
      };
      const mimeType = photo.mimeType ?? 'image/jpeg';
      if (Platform.OS === 'web' || photo.file) {
        const form = new FormData();
        form.append('file', photo.file as Blob, 'receipt');
        const res = await fetch(url, { method: 'POST', headers, body: form });
        if (!res.ok) throw new ApiError('The photo could not be uploaded', res.status);
        return;
      }
      const result = await new File(photo.uri).upload(url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType,
        headers,
      });
      if (result.status < 200 || result.status >= 300) throw new ApiError('The photo could not be uploaded', result.status);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense'] });
      invalidateMoney(qc);
    },
  });
}
