import { Platform } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { ApiError } from './api-client';
import { getItem } from './storage';
import { API_V1_URL, TOKEN_KEYS } from '../constants/config';
import { useBranch } from './branch';
import type { ParseResult } from './file-receiving-rules';

export * from './file-receiving-rules';

// ── reading the file ────────────────────────────────────────────────────────

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
  /** The picker hands web a real File; a phone hands us a uri. */
  file?: unknown;
}

/**
 * What the picker gave us, checked before it is sent.
 *
 * On a phone the multipart part is built by React Native from the file's uri,
 * and a uri it cannot read fails inside the networking layer as a bare
 * "Network request failed" — indistinguishable from the shop's Wi-Fi dropping.
 * Asking the file system first turns that into something we can say plainly,
 * and tells us whether to send the bytes ourselves instead.
 */
function inspect(uri: string): { exists: boolean; size: number } | null {
  if (Platform.OS === 'web') return null;
  try {
    // A picker may hand back a percent-encoded uri; the file system wants the
    // real path.
    const file = new File(decodeURI(uri));
    return { exists: file.exists, size: file.size ?? 0 };
  } catch {
    return null;
  }
}

function multipart(input: PickedFile, bytes: Uint8Array | null, sheet?: string, mapping?: Record<string, number>) {
  const form = new FormData();
  const type = input.mimeType ?? 'application/octet-stream';
  if (input.file) {
    // Web: the picker already handed us the file itself.
    form.append('file', input.file as Blob, input.name);
  } else if (bytes) {
    // The bytes we read ourselves, so a uri React Native cannot open — an iOS
    // security-scoped url, a temporary file already released — cannot silently
    // upload nothing.
    form.append('file', new Blob([bytes as unknown as BlobPart], { type }), input.name);
  } else {
    form.append('file', { uri: input.uri, name: input.name, type } as unknown as Blob);
  }
  if (sheet) form.append('sheet', sheet);
  if (mapping) form.append('mapping', JSON.stringify(mapping));
  return form;
}

export function useParseReceivingFile() {
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: async (input: PickedFile & { sheet?: string; mapping?: Record<string, number> }) => {
      const token = await getItem(TOKEN_KEYS.ACCESS_TOKEN);

      const found = input.file ? null : inspect(input.uri);
      if (found && !found.exists) {
        throw new ApiError('The chosen file is no longer there', 400, 'file_missing', null);
      }
      if (found && found.size === 0) {
        throw new ApiError('The chosen file is empty', 400, 'file_missing', null);
      }

      const send = async (bytes: Uint8Array | null) => {
        // No content-type of our own: setting it loses the generated boundary
        // and the server sees no file at all.
        const res = await fetch(`${API_V1_URL}/purchases/file/parse`, {
          method: 'POST',
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(branchId ? { 'x-branch-id': branchId } : {}),
          },
          body: multipart(input, bytes, input.sheet, input.mapping),
        });
        const body = (await res.json().catch(() => null)) as (ParseResult & { message?: string; code?: string }) | null;
        if (!res.ok) throw new ApiError(body?.message ?? 'Could not read that file', res.status, body?.code, body);
        return body as ParseResult;
      };

      try {
        return await send(null);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        // The request never reached the server. If the file is readable, send
        // its bytes rather than its uri before blaming the network: a uri the
        // networking layer refuses is the one native failure that looks exactly
        // like being offline.
        if (found?.exists && found.size > 0) {
          try {
            return await send(await new File(decodeURI(input.uri)).bytes());
          } catch (retry) {
            if (retry instanceof ApiError) throw retry;
          }
        }
        throw new ApiError('The server could not be reached', 0, 'offline', null);
      }
    },
  });
}
