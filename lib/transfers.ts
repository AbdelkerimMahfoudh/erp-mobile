import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api-client';
import { useBranch } from './branch';
import { haptics } from './haptics';
import { t } from './i18n';
import { qk } from './query-keys';
import { toast } from './toast';
import type {
  CreateTransferBody,
  CreateTransferResult,
  TransferActionName,
  TransferCounts,
  TransferDecisionBody,
  TransferDetail,
  TransferPage,
  TransferStatus,
} from '../types/api';

/**
 * The mobile side of transfers.
 *
 * **The server owns the workflow.** Nothing here decides who may approve, which
 * transition is legal, or whether the active branch is the right one — the
 * detail response says so per action, and this file renders that answer. The
 * app's only jobs are asking the right question, sending the version it last
 * saw, and refreshing exactly what changed.
 */

// ─────────────────────────────── reads ───────────────────────────────

export interface TransferFilters {
  status?: TransferStatus[];
  search?: string;
}

function queryString(filters: TransferFilters): string {
  const p = new URLSearchParams();
  if (filters.status?.length) p.set('status', filters.status.join(','));
  if (filters.search?.trim()) p.set('search', filters.search.trim());
  return p.toString();
}

/**
 * The transfer list, paged by the server.
 *
 * Search and status live in the query key as well as the request: a cursor
 * issued under one query is meaningless under another, so changing either must
 * start a fresh run rather than continue the previous one.
 */
export function useTransfers(filters: TransferFilters) {
  const branchId = useBranch((s) => s.branchId);
  const qs = queryString(filters);

  return useInfiniteQuery({
    queryKey: qk.transfers(branchId, qs),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(qs);
      if (pageParam) p.set('cursor', pageParam);
      const suffix = p.toString();
      return api.get<TransferPage>(`/transfers${suffix ? `?${suffix}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTransfer(id: string | undefined) {
  return useQuery({
    queryKey: qk.transfer(id ?? ''),
    enabled: Boolean(id),
    // A transfer that does not exist, or a branch the user cannot see, is an
    // answer rather than a fault — retrying only asks the same question again.
    retry: false,
    queryFn: () => api.get<TransferDetail>(`/transfers/${id}`),
  });
}

/**
 * The three numbers on the navigation entry.
 *
 * One bounded server-side query. Counting a drained list would make the home
 * screen slower every month the shop stays in business.
 */
export function useTransferCounts(enabled: boolean) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.transferCounts(branchId),
    enabled: enabled && Boolean(branchId),
    queryFn: () => api.get<TransferCounts>('/transfers/counts'),
  });
}

// ─────────────────────────────── writes ───────────────────────────────

/** A 409 always means: someone else acted first. Never retry it silently. */
export function isStaleTransfer(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/**
 * Refresh exactly what a transfer transition can have changed.
 *
 * Deliberately not a blanket `invalidateQueries()`: a shop on a slow connection
 * should not reload home, analytics and every list because one transfer was
 * approved. Inventory IS included — reserving, shipping and receiving all move
 * real stock.
 */
function invalidateTransfers(
  queryClient: ReturnType<typeof useQueryClient>,
  branchId: string | null,
  id?: string,
) {
  const keys: readonly unknown[][] = [
    ['transfers', branchId],
    ['transfer-counts', branchId],
    // Notifications: every transition writes them, including for the actor's
    // colleagues, and the unread badge is on the same screen.
    [...qk.notifications],
    [...qk.inventory(branchId)].slice(0, 2),
    ...(id ? [[...qk.transfer(id)]] : []),
  ];
  for (const key of keys) {
    void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
  }
}

const ENDPOINT: Record<TransferActionName, (id: string) => string> = {
  approve: (id) => `/transfers/${id}/approve`,
  reject: (id) => `/transfers/${id}/reject`,
  ship: (id) => `/transfers/${id}/ship`,
  receive: (id) => `/transfers/${id}/receive/confirm`,
  cancel: (id) => `/transfers/${id}/cancel`,
};

export interface TransferActionArgs {
  id: string;
  action: TransferActionName;
  /** Exactly what the server last returned, so a stale decision is refused. */
  expectedVersion: number;
  reason?: string;
  /** Receiving confirms which units physically arrived. */
  identifiers?: string[];
}

/**
 * Perform a lifecycle action.
 *
 * Success is reported only after the server confirms. There is deliberately no
 * optimistic update: showing a transfer as approved before the server agrees is
 * exactly how two people both believe they won a race.
 */
export function useTransferAction() {
  const queryClient = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: ({ id, action, expectedVersion, reason, identifiers }: TransferActionArgs) => {
      const body: TransferDecisionBody & { identifiers?: string[] } = {
        expectedVersion,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
        ...(action === 'receive' ? { identifiers: identifiers ?? [] } : {}),
      };
      return api.post<unknown>(ENDPOINT[action](id), body);
    },
    onSuccess: (_data, variables) => {
      void haptics.success();
      toast.success(t(`transfers.action.done.${variables.action}` as never));
      invalidateTransfers(queryClient, branchId, variables.id);
    },
    onError: () => {
      void haptics.error();
    },
  });
}

/**
 * Create a transfer request.
 *
 * The caller owns the `clientUuid` and reuses it for every retry of the same
 * attempt — that is what makes a timeout safe. The server recognises a replay
 * and returns the ORIGINAL transfer rather than moving stock twice, so a
 * successful response here may well be the earlier attempt finally reported.
 */
export function useCreateTransfer() {
  const queryClient = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: (body: CreateTransferBody) => api.post<CreateTransferResult>('/transfers', body),
    onSuccess: () => {
      void haptics.success();
      invalidateTransfers(queryClient, branchId);
    },
    onError: () => {
      void haptics.error();
    },
  });
}

/**
 * The problems a create can come back with, per identifier.
 *
 * The server answers `{ message, problems: [{ identifier, reason }] }` for
 * ineligible stock. Showing the list is the difference between "some units
 * cannot be transferred" and knowing which phone to go and look at.
 */
export function transferProblems(error: unknown): { identifier: string; reason: string }[] {
  if (!(error instanceof ApiError)) return [];
  const body = error.body as { problems?: { identifier?: string; reason?: string }[] } | undefined;
  if (!Array.isArray(body?.problems)) return [];
  return body.problems
    .filter((p): p is { identifier: string; reason: string } => Boolean(p.identifier && p.reason))
    .map((p) => ({ identifier: p.identifier, reason: p.reason }));
}
