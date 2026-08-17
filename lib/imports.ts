import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api-client';
import { useBranch } from './branch';
import { getItem } from './storage';
import { API_V1_URL, TOKEN_KEYS } from '../constants/config';
import { qk } from './query-keys';

/**
 * Bringing a shop's stock list in (Milestone G).
 *
 * Two phases the screens must never blur: a **preview** writes nothing to
 * inventory and can be abandoned freely, and a **commit** creates stock. If a
 * screen ever makes the first look like the second, somebody will abandon a
 * preview believing they have cancelled an import that already happened.
 */

export type ImportRowStatus = 'valid' | 'warning' | 'error';
export type ImportKind = 'imei' | 'serial' | 'quantity';

export interface ImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  message: string | null;
  identifier: string | null;
  parsed: Record<string, unknown> | null;
  createdId: string | null;
}

export interface ImportBatch {
  id: string;
  filename: string | null;
  status: 'parsing' | 'preview' | 'committed' | 'failed';
  kind: ImportKind | null;
  counts: {
    total: number;
    valid: number;
    warning: number;
    error: number;
    /** Valid AND warning both import — that is what a warning means. */
    willImport: number;
    imported: number;
  };
  committedAt: string | null;
  version: number;
  rows: ImportRow[];
  /** Present only when the columns could not be understood. */
  problems?: { field: string; message: string }[];
  source?: 'xlsx' | 'csv';
  delimiter?: string;
}

export interface ImportSummary {
  id: string;
  filename: string | null;
  status: ImportBatch['status'];
  kind: ImportKind | null;
  total: number;
  imported: number;
  createdAt: string;
  committedAt: string | null;
}

export function useImports() {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.imports(branchId),
    queryFn: () => api.get<{ rows: ImportSummary[] }>('/imports'),
  });
}

export function useImport(id: string | undefined) {
  return useQuery({
    queryKey: qk.import(id ?? ''),
    queryFn: () => api.get<ImportBatch>(`/imports/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Upload the file.
 *
 * Sent with `fetch` and `FormData` rather than through the shared JSON client:
 * a multipart body must NOT carry a `content-type` header we set ourselves, or
 * the boundary is lost and the server sees no file. The auth and branch headers
 * are added by hand for the same reason.
 */
export function usePreviewImport() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: async (file: { uri: string; name: string; mimeType?: string }) => {
      const token = await getItem(TOKEN_KEYS.ACCESS_TOKEN);
      const form = new FormData();
      form.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? 'application/octet-stream',
      } as unknown as Blob);

      const res = await fetch(`${API_V1_URL}/imports`, {
        method: 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(branchId ? { 'x-branch-id': branchId } : {}),
        },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError(
          (body as { message?: string })?.message ?? 'Could not read that file',
          res.status,
          (body as { code?: string })?.code,
          body,
        );
      }
      return body as ImportBatch;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.imports(branchId) });
    },
  });
}

export function useCommitImport(id: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (expectedVersion?: number) =>
      api.post<ImportBatch>(`/imports/${id}/commit`, { expectedVersion }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.import(id) });
      void qc.invalidateQueries({ queryKey: qk.imports(branchId) });
      // Stock genuinely changed, so anything counting it is now stale.
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['home', branchId] });
    },
  });
}

/** The tone a row's status should read as. */
export function rowTone(status: ImportRowStatus): 'success' | 'warning' | 'danger' {
  return status === 'error' ? 'danger' : status === 'warning' ? 'warning' : 'success';
}
