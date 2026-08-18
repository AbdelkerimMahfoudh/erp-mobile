import type { QueueItem } from './queue-rules.ts';

/**
 * What is allowed to reach the disk (Milestone J).
 *
 * Kept apart from `queue-store.ts` because that file talks to
 * `expo-file-system`, and these rules must be testable by plain Node with no
 * device and no native module. Validation you cannot run is validation nobody
 * runs.
 */

/** Bump when the on-disk shape changes. Older files are quarantined, not read. */
export const QUEUE_SCHEMA_VERSION = 1;

export interface QueueFile {
  version: number;
  items: QueueItem[];
}

export function isQueueFile(v: unknown): v is QueueFile {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as QueueFile).version === 'number' &&
    Array.isArray((v as QueueFile).items)
  );
}

/**
 * Shape check, deliberately strict.
 *
 * Also refuses anything carrying a credential-shaped field: **access tokens are
 * never persisted inside a queued payload**, and enforcing it here means the
 * rule survives somebody adding a convenient field in a later milestone.
 */
export function isQueueItem(v: unknown): v is QueueItem {
  if (typeof v !== 'object' || v === null) return false;
  const i = v as Record<string, unknown>;
  const stringy = ['id', 'kind', 'clientUuid', 'companyId', 'userId', 'summary'];
  if (!stringy.every((k) => typeof i[k] === 'string')) return false;
  if (typeof i.createdAt !== 'number' || typeof i.attempts !== 'number') return false;
  if (typeof i.payloadVersion !== 'number') return false;
  if (i.branchId !== null && typeof i.branchId !== 'string') return false;
  if (containsCredential(i.payload)) return false;
  return true;
}

const CREDENTIAL_KEYS = [
  'password',
  'accesstoken',
  'refreshtoken',
  'token',
  'otp',
  'pin',
  'secret',
  'authorization',
];

/** Recursive, because a token nested two objects deep is still a token. */
export function containsCredential(payload: unknown, depth = 0): boolean {
  if (depth > 6 || payload === null || typeof payload !== 'object') return false;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (CREDENTIAL_KEYS.includes(key.toLowerCase().replace(/[^a-z]/g, ''))) return true;
    if (containsCredential(value, depth + 1)) return true;
  }
  return false;
}

/**
 * Identity is part of the filename, so the wrong file cannot be opened by
 * accident. Characters outside the safe set are stripped: these come from ids
 * whose formatting we do not control, and a path separator in a filename is a
 * directory traversal waiting to happen.
 */
export function fileNameFor(scope: {
  companyId: string;
  branchId: string | null;
  userId: string;
}): string {
  const safe = (s: string | null) => (s ?? 'none').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  return `q-${safe(scope.companyId)}-${safe(scope.branchId)}-${safe(scope.userId)}.json`;
}
