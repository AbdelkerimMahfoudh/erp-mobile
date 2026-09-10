import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api, type DownloadedFile } from './api-client';
import { getActiveBranchId } from './branch';
import { hasPermission } from './permissions';
import { getLanguage } from './i18n';

/**
 * Getting a report off the phone.
 *
 * The server decides everything that matters — which columns, which period,
 * which branch, whether the caller may have it at all. This module's job is
 * narrower and entirely about the device: ask, check what came back, write it
 * somewhere private, hand it to the share sheet, and clean up.
 *
 * ## Why the file is written at all
 *
 * `Sharing.shareAsync` takes a URI, not a string. So the bytes have to land on
 * disk before the OS will offer them to Mail, Files or WhatsApp. They go in the
 * CACHE directory — the system may reclaim it, which is exactly right for a
 * file whose only purpose is the next few seconds.
 *
 * `expo-print` is not involved. It renders HTML to PDF; a CSV is already text.
 *
 * ## Why the context is captured
 *
 * A report takes a moment to generate. In that moment the user can switch
 * branch, or sign out. Writing the answer to disk afterwards would leave one
 * shop's figures in a file under another shop's context — so the branch is
 * recorded before the request and compared after it, and a mismatch throws the
 * result away rather than saving it.
 */

export const REPORT_KINDS = [
  'profit-by-product',
  'profit-by-employee',
  'profit-by-branch',
  'movers',
  'dead-stock',
  'debtors-creditors',
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

/** Reports that take a window. The rest describe the present. */
export const PERIOD_KINDS: ReadonlySet<ReportKind> = new Set([
  'profit-by-product',
  'profit-by-employee',
  'profit-by-branch',
  'movers',
]);

/**
 * What a report needs beyond `report.view`, mirroring the server catalogue.
 *
 * ⚠️ UX, not security. The server checks this again on every request and is the
 * only authority. This exists so a user is not offered a report that will 403 —
 * being shown a door that does not open is worse than not being shown it.
 */
const EXTRA_PERMISSIONS: Partial<Record<ReportKind, string>> = {
  'debtors-creditors': 'loan.view',
};

/** The reports this user may actually ask for. */
export function availableReports(): ReportKind[] {
  if (!hasPermission('report.view')) return [];
  return REPORT_KINDS.filter((kind) => {
    const extra = EXTRA_PERMISSIONS[kind];
    return !extra || hasPermission(extra as never);
  });
}

export type ExportOutcome =
  | { status: 'shared'; filename: string; rows: number | null }
  /** Web: the browser took it. There is no share sheet to report on. */
  | { status: 'downloaded'; filename: string; rows: number | null }
  /** The user backed out of the share sheet. Not an error. */
  | { status: 'cancelled' }
  /** Context changed mid-flight; the result was discarded unsaved. */
  | { status: 'stale' };

/** One export at a time. A second tap while one runs is ignored, not queued. */
let inFlight = false;

export function isExporting(): boolean {
  return inFlight;
}

/**
 * Ask for a report and hand it to the user.
 *
 * Throws `ApiError` for anything the server refused — an expired session, a
 * revoked permission, an oversized report — so the caller can show the
 * server's own reason rather than inventing one.
 */
export async function exportReport(
  kind: ReportKind,
  options: { days?: number } = {},
): Promise<ExportOutcome> {
  if (inFlight) return { status: 'cancelled' };
  inFlight = true;

  // The context this report is ABOUT, captured before the request.
  const branchAtStart = getActiveBranchId();

  try {
    const query = new URLSearchParams({ locale: getLanguage() });
    // Only a period report accepts one; the server rejects it on the others,
    // and sending it anyway would turn a valid request into a 400.
    if (options.days !== undefined && PERIOD_KINDS.has(kind)) {
      query.set('days', String(options.days));
    }

    const file = await api.download(`/reports/${kind}.csv?${query.toString()}`);

    /*
     * The user moved while we were waiting. Throwing the bytes away is the
     * only safe answer: writing them now would put one branch's figures in a
     * file the user believes belongs to the branch they are looking at.
     */
    if (getActiveBranchId() !== branchAtStart) return { status: 'stale' };

    if (Platform.OS === 'web') {
      saveInBrowser(file);
      return { status: 'downloaded', filename: file.filename, rows: file.rows };
    }

    return await shareNatively(file, branchAtStart);
  } finally {
    inFlight = false;
  }
}

// ── native ───────────────────────────────────────────────────────────────────

/**
 * The directory this session's exports live in.
 *
 * Scoped by branch so two branches' files cannot collide, and because a
 * leftover file is then obviously attributable rather than anonymous. Under
 * the app's cache directory, which is app-private on both platforms — no other
 * app can read it, and the system may reclaim it.
 */
function exportDirectory(branchId: string | null): Directory {
  const dir = new Directory(Paths.cache, 'reports', branchId ?? 'all-branches');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

async function shareNatively(file: DownloadedFile, branchId: string | null): Promise<ExportOutcome> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('sharing-unavailable');
  }

  // Anything still lying about from a previous export goes first, so a failure
  // here cannot leave the directory growing quietly forever.
  sweep(branchId);

  const target = new File(exportDirectory(branchId), file.filename);
  if (target.exists) target.delete();
  target.write(file.text);

  try {
    await Sharing.shareAsync(target.uri, {
      mimeType: 'text/csv',
      dialogTitle: file.filename,
      // The iOS type for a comma-separated file. Without it Mail and Files
      // offer to attach it as an opaque blob.
      UTI: 'public.comma-separated-values-text',
    });
  } catch {
    /*
     * A share sheet dismissed by the user rejects on some platforms and
     * resolves on others, and neither is distinguishable from a genuine
     * failure to present it. Treated as a cancellation: the user sees no
     * error for backing out, and a real failure costs them one retry.
     */
    return { status: 'cancelled' };
  } finally {
    /*
     * NOT deleted here.
     *
     * `shareAsync` resolves when the sheet closes, which on iOS can be BEFORE
     * the receiving app has finished reading the file — Mail in particular
     * reads it while composing. Deleting now produces an empty attachment.
     * The next export sweeps it instead, and the OS reclaims the cache anyway.
     */
  }

  return { status: 'shared', filename: file.filename, rows: file.rows };
}

/** Remove exports left by earlier runs. Best effort: never fails an export. */
function sweep(branchId: string | null): void {
  try {
    for (const entry of exportDirectory(branchId).list()) {
      if (entry instanceof File) entry.delete();
    }
  } catch {
    // A file another app is still holding, or a directory already reclaimed.
    // Neither is worth failing the export the user actually asked for.
  }
}

/**
 * Drop every exported file, for every branch.
 *
 * Called on sign-out: a report is the shop's financial data, and leaving it in
 * a cache directory after somebody has signed out is leaving it for whoever
 * signs in next.
 */
export function clearExports(): void {
  try {
    const root = new Directory(Paths.cache, 'reports');
    if (root.exists) root.delete();
  } catch {
    // Nothing to clear, or already gone.
  }
}

// ── web ──────────────────────────────────────────────────────────────────────

/**
 * Hand the browser a file it already has.
 *
 * The bytes arrived through the authenticated API layer, so this creates an
 * object URL from what is already in memory rather than pointing the browser
 * at the endpoint — a plain link would be an unauthenticated request, and
 * putting a token in the URL to fix that would write it into history, logs and
 * the referer header.
 *
 * `Sharing.shareAsync` cannot do this: on web it has no local file URI to
 * share.
 */
function saveInBrowser(file: DownloadedFile): void {
  const blob = new Blob([file.text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously can beat the download in
  // some browsers and produce an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
