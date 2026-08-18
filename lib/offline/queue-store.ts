import { Directory, File, Paths } from 'expo-file-system';
import type { QueueItem } from './queue-rules.ts';
import {
  fileNameFor,
  isQueueFile,
  isQueueItem,
  QUEUE_SCHEMA_VERSION,
  type QueueFile,
} from './queue-schema.ts';

/**
 * Where the queue actually lives (Milestone J).
 *
 * Built on `expo-file-system`, which was **already installed** — the audit
 * looked for an existing durable store before reaching for a dependency, and
 * `expo-secure-store` was the wrong tool (Android warns above roughly 2 KB per
 * value, and a queue is unbounded by nature).
 *
 * Three rules this file exists to keep:
 *
 * 1. **Scoped by user, company and branch.** One file per triple, so a shared
 *    counter phone cannot show one employee another's drafts, and nothing can
 *    replay under a company it was not made in.
 * 2. **Versioned.** A payload written by an older or newer build is recognised
 *    as foreign rather than misread as current.
 * 3. **Fails closed.** Unreadable data is quarantined, never guessed at. A
 *    queue that silently drops what it cannot parse is worse than one that says
 *    it lost something.
 *
 * The shape rules themselves live in `queue-schema.ts`, so they can be tested
 * without a device.
 */

export interface Scope {
  companyId: string;
  branchId: string | null;
  userId: string;
}

/**
 * The document directory, not the cache.
 *
 * A cache directory is explicitly the place the OS may delete under storage
 * pressure. A shop's unsent expense report is not a cache.
 */
const ROOT = () => new Directory(Paths.document, 'offline-queue');

function fileFor(scope: Scope): File {
  return new File(ROOT(), fileNameFor(scope));
}

function ensureRoot(): void {
  const dir = ROOT();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

/**
 * Read the queue for one scope.
 *
 * Anything unreadable is moved aside rather than deleted: the shop is told it
 * has a problem, and the bytes still exist if somebody needs to look. Returning
 * an empty queue and silently binning the file would lose a payment report with
 * no trace that it ever existed.
 */
export function readQueue(scope: Scope): { items: QueueItem[]; quarantined: boolean } {
  ensureRoot();
  const file = fileFor(scope);
  if (!file.exists) return { items: [], quarantined: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(file.textSync());
  } catch {
    quarantine(file);
    return { items: [], quarantined: true };
  }

  // A foreign version would be misinterpreted field by field rather than fail,
  // which is the more dangerous of the two outcomes.
  if (!isQueueFile(parsed) || parsed.version !== QUEUE_SCHEMA_VERSION) {
    quarantine(file);
    return { items: [], quarantined: true };
  }

  // Individual malformed items are dropped rather than poisoning the whole
  // queue, so one bad row cannot strand every other unsent report.
  return { items: parsed.items.filter(isQueueItem), quarantined: false };
}

export function writeQueue(scope: Scope, items: QueueItem[]): void {
  ensureRoot();
  const payload: QueueFile = { version: QUEUE_SCHEMA_VERSION, items };
  fileFor(scope).write(JSON.stringify(payload));
}

/** Move a file we cannot trust out of the way, keeping the bytes. */
function quarantine(file: File): void {
  try {
    const bad = new File(ROOT(), `${file.name}.corrupt-${Date.now()}`);
    bad.write(file.textSync());
  } catch {
    // If reading failed there is nothing to preserve. Deleting below is still
    // right: leaving it would re-quarantine on every single read.
  }
  try {
    file.delete();
  } catch {
    /* the next read will try again */
  }
}

/**
 * Forget one scope's queue entirely.
 *
 * Not called on sign-out. Drafts are **kept** — an employee whose shift ended
 * has not abandoned the expense they were half-way through reporting — and they
 * stay readable only by the same user in the same company and branch, because
 * that triple is the filename. The next person to sign in on the same phone
 * opens a different file and sees nothing of theirs.
 */
export function clearScope(scope: Scope): void {
  const file = fileFor(scope);
  if (file.exists) file.delete();
}

/** Diagnostics for the Sync centre: which scope files exist on this device. */
export function listScopeFiles(): string[] {
  ensureRoot();
  try {
    return ROOT()
      .list()
      .map((entry) => entry.name)
      .filter((name) => name.startsWith('q-'));
  } catch {
    return [];
  }
}
