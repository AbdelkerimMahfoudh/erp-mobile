import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';

/**
 * Goals (Milestone F).
 *
 * Progress arrives computed from the server and is never derived again here —
 * a second definition of "am I on target" in the client would drift from the
 * one the shop's analytics use, and the screen would be confidently wrong.
 */

export type GoalMetric = 'gross_profit' | 'revenue' | 'sales_count' | 'units_sold';
export type GoalScope = 'company' | 'branch' | 'user';

/**
 * The state, in a word. Colour never carries meaning alone, and a percentage
 * on its own does not tell somebody whether 62% is good on the 20th.
 */
export type GoalState = 'not_started' | 'on_track' | 'behind' | 'met' | 'missed';

export interface GoalProgress {
  target: number;
  achieved: number;
  /** Uncapped: 118% is a real and useful thing to know. */
  percent: number;
  remaining: number;
  state: GoalState;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  expectedByNow: number | null;
  neededPerRemainingDay: number | null;
}

export interface Goal {
  id: string;
  scope: GoalScope;
  branchId: string | null;
  targetUser: { id: string; name: string } | null;
  metric: GoalMetric;
  /** Whether to format the figures as money, decided by the server. */
  isMoney: boolean;
  periodStart: string;
  periodEnd: string;
  periodLabel: 'daily' | 'weekly' | 'monthly' | 'custom';
  status: 'active' | 'archived';
  archivedReason: string | null;
  note: string | null;
  version: number;
  progress: GoalProgress;
}

export function useGoals(includeArchived = false) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.goals(branchId, includeArchived),
    queryFn: () => api.get<{ rows: Goal[] }>(`/goals${includeArchived ? '?includeArchived=true' : ''}`),
  });
}

export interface CreateGoalBody {
  scope: GoalScope;
  branchId?: string;
  targetUserId?: string;
  metric: GoalMetric;
  periodStart: string;
  periodEnd: string;
  periodLabel?: 'daily' | 'weekly' | 'monthly' | 'custom';
  targetAmount: number;
  note?: string;
}

export function useCreateGoal() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (body: CreateGoalBody) => api.post<Goal>('/goals', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.goals(branchId, false) });
      void qc.invalidateQueries({ queryKey: qk.goals(branchId, true) });
    },
  });
}

export function useArchiveGoal() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<Goal>(`/goals/${id}/archive`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.goals(branchId, false) });
      void qc.invalidateQueries({ queryKey: qk.goals(branchId, true) });
    },
  });
}

/**
 * The tone a state should read as.
 *
 * `missed` is neutral rather than danger on purpose: a period that has closed
 * short is a fact to learn from, and colouring every past month red turns the
 * screen into a wall of failure nobody opens.
 */
export function toneOf(state: GoalState): 'success' | 'warning' | 'neutral' | 'info' {
  switch (state) {
    case 'met':
      return 'success';
    case 'behind':
      return 'warning';
    case 'on_track':
      return 'info';
    case 'not_started':
    case 'missed':
      return 'neutral';
  }
}

/** The month that is running, as the two dates the API wants. */
export function thisMonth(today = new Date()): { periodStart: string; periodEnd: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    periodStart: `${y}-${pad(m + 1)}-01`,
    periodEnd: `${y}-${pad(m + 1)}-${pad(last)}`,
  };
}
