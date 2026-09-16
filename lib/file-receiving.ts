import { useMutation } from '@tanstack/react-query';
import { ApiError } from './api-client';
import { getItem } from './storage';
import { API_V1_URL, TOKEN_KEYS } from '../constants/config';
import { useBranch } from './branch';
import type { ParseResult } from './file-receiving-rules';

export * from './file-receiving-rules';

// ── reading the file ────────────────────────────────────────────────────────

export function useParseReceivingFile() {
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: async (input: {
      uri: string;
      name: string;
      mimeType?: string;
      /** The picker hands web a real File; a phone hands us a uri. */
      file?: unknown;
      sheet?: string;
      mapping?: Record<string, number>;
    }) => {
      const token = await getItem(TOKEN_KEYS.ACCESS_TOKEN);
      const form = new FormData();
      // On a phone the multipart part is built from the file's uri; on web the
      // picker already handed us the file itself, and a uri part would upload
      // nothing.
      if (input.file) form.append('file', input.file as Blob, input.name);
      else {
        form.append('file', {
          uri: input.uri,
          name: input.name,
          type: input.mimeType ?? 'application/octet-stream',
        } as unknown as Blob);
      }
      if (input.sheet) form.append('sheet', input.sheet);
      if (input.mapping) form.append('mapping', JSON.stringify(input.mapping));

      const res = await fetch(`${API_V1_URL}/purchases/file/parse`, {
        method: 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(branchId ? { 'x-branch-id': branchId } : {}),
        },
        body: form,
      });
      const body = (await res.json().catch(() => null)) as (ParseResult & { message?: string; code?: string }) | null;
      if (!res.ok) {
        throw new ApiError(body?.message ?? 'Could not read that file', res.status, body?.code, body);
      }
      return body as ParseResult;
    },
  });
}

