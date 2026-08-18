import { Directory, File, Paths } from 'expo-file-system';
import { fileNameFor } from './queue-schema.ts';
import type { Scope } from './queue-store.ts';

/**
 * Half-finished work, kept on this phone (Milestone J).
 *
 * Separate from the queue on purpose. A queued item is something the shop has
 * decided to send; a draft is work in progress that may never be sent at all,
 * and the two must never be confused — the entire safety argument is that a
 * draft is **not** a submitted server record.
 *
 * Scoped exactly like the queue: one file per form, per user, company and
 * branch. A cart built by one employee on the counter phone is not visible to
 * the next person who signs in, because their scope opens a different file.
 *
 * Drafts survive sign-out rather than being destroyed — an employee whose shift
 * ended has not abandoned the sale they were building — and become readable
 * again only when the same person signs back into the same branch.
 */

const ROOT = () => new Directory(Paths.document, 'drafts');

/** Bumped when a draft's shape changes; a foreign version is discarded. */
const DRAFT_VERSION = 1;

interface Envelope<T> {
  version: number;
  savedAt: number;
  value: T;
}

function fileFor(form: string, scope: Scope): File {
  const safeForm = form.replace(/[^a-zA-Z0-9.-]/g, '');
  return new File(ROOT(), `${safeForm}--${fileNameFor(scope)}`);
}

function ensureRoot(): void {
  const dir = ROOT();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export function saveDraft<T>(form: string, scope: Scope, value: T): void {
  try {
    ensureRoot();
    const envelope: Envelope<T> = { version: DRAFT_VERSION, savedAt: Date.now(), value };
    fileFor(form, scope).write(JSON.stringify(envelope));
  } catch {
    /*
      Best-effort by design. Failing to save a draft is a nuisance; throwing
      here would take down the screen the shopkeeper is actively using, which
      is worse than losing the draft.
    */
  }
}

/**
 * Read a draft back, or `null`.
 *
 * Anything unreadable or foreign-versioned returns null and deletes the file:
 * unlike the queue, a draft nobody can parse is not evidence of anything owed,
 * so keeping the bytes would be hoarding rather than caution.
 */
export function loadDraft<T>(form: string, scope: Scope): { value: T; savedAt: number } | null {
  try {
    ensureRoot();
    const file = fileFor(form, scope);
    if (!file.exists) return null;

    const parsed = JSON.parse(file.textSync()) as Envelope<T>;
    if (typeof parsed !== 'object' || parsed === null || parsed.version !== DRAFT_VERSION) {
      file.delete();
      return null;
    }
    return { value: parsed.value, savedAt: parsed.savedAt };
  } catch {
    try {
      fileFor(form, scope).delete();
    } catch {
      /* nothing further to do */
    }
    return null;
  }
}

export function clearDraft(form: string, scope: Scope): void {
  try {
    const file = fileFor(form, scope);
    if (file.exists) file.delete();
  } catch {
    /* best effort */
  }
}
