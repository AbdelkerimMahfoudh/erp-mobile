import { Directory, File, Paths } from 'expo-file-system';
import { isDurable } from './durable-storage.ts';
import {
  draftKey,
  DRAFT_SCHEMA_VERSION,
  isDraftEnvelope,
  isReadable,
  isWritable,
  type DraftEnvelope,
  type DraftScope,
} from './draft-schema.ts';

/**
 * Half-finished work, kept on this phone (Milestone J, extended in J.1).
 *
 * Separate from the queue on purpose. A queued item is something the shop has
 * decided to send; a draft is work in progress that may never be sent at all,
 * and the entire safety argument is that the two are not the same thing.
 *
 * Scoped by user, company, branch, form **and record**, because that tuple is
 * the filename. A cart built by one employee on the counter phone is invisible
 * to whoever signs in next, and an investigation note about one return can
 * never surface on another.
 *
 * The rules live in `draft-schema.ts` so they can be tested without a device.
 */

const ROOT = () => new Directory(Paths.document, 'drafts');

function fileFor(form: string, scope: DraftScope, recordId?: string | null): File {
  return new File(ROOT(), draftKey(form, scope, recordId));
}

function ensureRoot(): void {
  const dir = ROOT();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export interface SaveResult {
  saved: boolean;
  reason?: 'forbidden_field' | 'too_large' | 'io' | 'unsupported';
}

export function saveDraft<T>(
  form: string,
  scope: DraftScope,
  value: T,
  payloadVersion: number,
  recordId?: string | null,
): SaveResult {
  // Refused BEFORE any I/O: a credential or a photograph must never reach the
  // disk even briefly, and a refusal that happened after the write would be
  // an apology rather than a guarantee.
  // Web keeps nothing. Reported as an ordinary refusal so the screen can
  // say so, rather than as an io error that suggests a transient problem.
  if (!isDurable()) return { saved: false, reason: 'unsupported' };

  const allowed = isWritable(value);
  if (!allowed.ok) return { saved: false, reason: allowed.reason };

  try {
    ensureRoot();
    const envelope: DraftEnvelope<T> = {
      version: DRAFT_SCHEMA_VERSION,
      payloadVersion,
      savedAt: Date.now(),
      value,
    };
    fileFor(form, scope, recordId).write(JSON.stringify(envelope));
    return { saved: true };
  } catch {
    /*
      Best-effort by design. Failing to save a draft is a nuisance; throwing
      would take down the screen the shopkeeper is actively using, which is
      worse than losing the draft.
    */
    return { saved: false, reason: 'io' };
  }
}

export interface LoadedDraft<T> {
  value: T;
  savedAt: number;
}

/**
 * Read a draft back, or `null`.
 *
 * Unreadable or foreign-versioned data is quarantined rather than deleted, the
 * same as the queue. A draft is somebody's work: silently binning it and
 * showing an empty form teaches people the app loses things, which is precisely
 * the fear this milestone exists to remove.
 */
export function loadDraft<T>(
  form: string,
  scope: DraftScope,
  payloadVersion: number,
  recordId?: string | null,
): LoadedDraft<T> | null {
  if (!isDurable()) return null;
  try {
    ensureRoot();
    const file = fileFor(form, scope, recordId);
    if (!file.exists) return null;

    const parsed: unknown = JSON.parse(file.textSync());
    if (!isDraftEnvelope(parsed) || !isReadable(parsed, payloadVersion)) {
      quarantine(file);
      return null;
    }
    return { value: (parsed as DraftEnvelope<T>).value, savedAt: parsed.savedAt };
  } catch {
    try {
      quarantine(fileFor(form, scope, recordId));
    } catch {
      /* nothing further to do */
    }
    return null;
  }
}

function quarantine(file: File): void {
  try {
    if (!file.exists) return;
    const kept = new File(ROOT(), `${file.name}.corrupt-${Date.now()}`);
    kept.write(file.textSync());
  } catch {
    /* if it cannot be read there is nothing to keep */
  }
  try {
    if (file.exists) file.delete();
  } catch {
    /* the next read will try again */
  }
}

/**
 * Forget a draft.
 *
 * Called only on confirmed server acceptance or an explicit discard by the
 * person who wrote it — never because a submission failed, and never because a
 * restored draft turned out to be stale. A draft that is no longer valid is
 * kept so it can be corrected.
 */
export function clearDraft(form: string, scope: DraftScope, recordId?: string | null): void {
  if (!isDurable()) return;
  try {
    const file = fileFor(form, scope, recordId);
    if (file.exists) file.delete();
  } catch {
    /* best effort */
  }
}

/** Diagnostics for the Sync centre. */
export function listDraftFiles(): string[] {
  if (!isDurable()) return [];
  try {
    ensureRoot();
    return ROOT()
      .list()
      .map((e) => e.name)
      .filter((n) => n.startsWith('d~'));
  } catch {
    return [];
  }
}
