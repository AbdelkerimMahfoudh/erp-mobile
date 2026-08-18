/**
 * What a draft is allowed to be (Milestone J.1).
 *
 * Pure and free of `expo-file-system`, so every rule here runs under plain Node
 * with no device. Validation you cannot run is validation nobody runs.
 *
 * A draft is the shop's own unfinished work. It is **not** a submitted server
 * record, it is never queued by itself, and the server's answer to anything is
 * never restored from it — a stale price or a stale balance presented as
 * current is a worse failure than losing the draft would have been.
 */

/** Bumped when the envelope changes. A foreign version is quarantined. */
export const DRAFT_SCHEMA_VERSION = 2;

export interface DraftScope {
  companyId: string;
  branchId: string | null;
  userId: string;
}

export interface DraftEnvelope<T> {
  version: number;
  /** The form's own payload version, so a screen can migrate its own shape. */
  payloadVersion: number;
  savedAt: number;
  value: T;
}

/**
 * The filename a draft lives under.
 *
 * Identity is the filename, which is what makes scope isolation structural
 * rather than a check somebody could forget: a different user, company, branch,
 * form or record simply opens a different file. There is no query to get wrong.
 *
 * `recordId` distinguishes drafts of the same KIND against different subjects —
 * an investigation note for return A must not surface on return B.
 */
export function draftKey(
  form: string,
  scope: DraftScope,
  recordId?: string | null,
): string {
  /*
    Two sanitizers, because the segments are not alike. A form name is ours and
    is written with dots (`sell.cart`, `return.investigation`); an id comes from
    elsewhere and never needs one. Allowing dots in ids is how `../..` survives
    as `....` — harmless without a separator, but not something to leave lying
    in a filename.
  */
  const safeForm = (s: string) =>
    s.replace(/[^a-zA-Z0-9.-]/g, '').replace(/\.{2,}/g, '.').slice(0, 48) || 'form';
  const safeId = (s: string | null | undefined) =>
    (s ?? 'none').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48) || 'none';

  return [
    'd',
    safeForm(form),
    safeId(scope.companyId),
    safeId(scope.branchId),
    safeId(scope.userId),
    safeId(recordId),
  ].join('~') + '.json';
}

export function isDraftEnvelope(v: unknown): v is DraftEnvelope<unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as DraftEnvelope<unknown>;
  return (
    typeof e.version === 'number' &&
    typeof e.payloadVersion === 'number' &&
    typeof e.savedAt === 'number'
  );
}

/**
 * Whether a stored envelope may be handed back to a screen.
 *
 * Both versions must match. A payload written by a different build of the same
 * form would be read field by field under today's assumptions, which fails
 * quietly rather than loudly — the worse of the two.
 */
export function isReadable(
  envelope: DraftEnvelope<unknown>,
  payloadVersion: number,
): boolean {
  return envelope.version === DRAFT_SCHEMA_VERSION && envelope.payloadVersion === payloadVersion;
}

const FORBIDDEN_KEYS = [
  // Credentials, in any spelling.
  'password',
  'accesstoken',
  'refreshtoken',
  'token',
  'otp',
  'pin',
  'secret',
  'authorization',
  // Binary payloads. A draft is a form's inputs, never a file: photographs, OCR
  // frames and spreadsheet bytes are large, often sensitive, and there is no
  // lifecycle that would ever clean them up.
  'base64',
  'imagedata',
  'photo',
  'bytes',
  'blob',
  'filecontent',
  'buffer',
];

/** Recursive: something nested three objects deep is still the thing. */
export function containsForbidden(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => containsForbidden(v, depth + 1));
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return true;
    if (containsForbidden(nested, depth + 1)) return true;
  }
  return false;
}

/**
 * A very large draft is a mistake rather than a draft.
 *
 * Catches somebody accidentally persisting a whole server response — a page of
 * inventory, a preview of two hundred import rows — which would be both a
 * privacy problem and a way to fill a cheap phone's storage.
 */
export const MAX_DRAFT_BYTES = 128 * 1024;

export function isWritable(value: unknown): { ok: true } | { ok: false; reason: 'forbidden_field' | 'too_large' } {
  if (containsForbidden(value)) return { ok: false, reason: 'forbidden_field' };
  let size = 0;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    // Circular or otherwise unserialisable. Refusing is right: it cannot be
    // written faithfully, and writing something else would be a lie.
    return { ok: false, reason: 'forbidden_field' };
  }
  return size > MAX_DRAFT_BYTES ? { ok: false, reason: 'too_large' } : { ok: true };
}
