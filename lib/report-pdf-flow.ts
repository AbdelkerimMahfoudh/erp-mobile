import { isPrintableDocument, reportDocumentPath, type ReportDocument, type ReportRequest } from './report-document.ts';
import { buildReportHtml, reportFileName, type ReportPdfContext } from './report-pdf-html.ts';

/**
 * Making a report PDF, step by step, with the device handed in (docs/66).
 *
 * Kept apart from the Expo modules so the whole sequence runs under bare `node`: the
 * test drives it with recording fakes and proves what it may and may not do.
 *
 *   1. ask the server for the document — one GET, the only request in the flow
 *   2. drop it if the branch changed meanwhile (one shop's figures never land in a file
 *      the person believes is another's), or if this app cannot read its version
 *   3. lay it out (`report-pdf-html.ts`) and, on a phone, render it to a named PDF file
 *
 * Sharing is a separate step that is given the file and nothing else — it cannot reach
 * the server, so a dismissed or failed share cannot change anything there. Nothing here
 * sends a message, pays, schedules or names a recipient: the person chooses where the
 * file goes, in the operating system's own sheet.
 */

export interface ReportPdfDeps {
  /** The authenticated GET. */
  get: (path: string) => Promise<unknown>;
  activeBranch: () => string | null;
  /** The words, direction and formatters of the language the person is using now. */
  context: () => ReportPdfContext;
  /** A phone renders the page into a PDF file with this name and returns its URI. Absent on the web. */
  writePdf?: (html: string, filename: string, branchId: string | null) => Promise<string>;
}

export interface GeneratedReport {
  filename: string;
  /** The page itself — what the web opens in a tab to print or save. */
  html: string;
  /** The PDF file on a phone; null on the web. */
  uri: string | null;
  document: ReportDocument;
}

export type GenerateOutcome =
  | { status: 'ready'; report: GeneratedReport }
  /** The branch changed while the document was being read or written: discarded. */
  | { status: 'stale' }
  /** A document this app version cannot print (a newer contract): refused whole. */
  | { status: 'unsupported' }
  /** Another PDF is being made; a second tap is ignored, not queued. */
  | { status: 'busy' };

let inFlight = false;

export function isGeneratingReport(): boolean {
  return inFlight;
}

export async function generateReportPdf(request: ReportRequest, deps: ReportPdfDeps): Promise<GenerateOutcome> {
  if (inFlight) return { status: 'busy' };
  inFlight = true;
  const branchAtStart = deps.activeBranch();
  try {
    const doc = await deps.get(reportDocumentPath(request));
    if (deps.activeBranch() !== branchAtStart) return { status: 'stale' };
    if (!isPrintableDocument(doc, request.kind)) return { status: 'unsupported' };
    const ctx = deps.context();
    const html = buildReportHtml(doc, ctx);
    const filename = reportFileName(doc, ctx.lang);
    const uri = deps.writePdf ? await deps.writePdf(html, filename, branchAtStart) : null;
    if (deps.activeBranch() !== branchAtStart) return { status: 'stale' };
    return { status: 'ready', report: { filename, html, uri, document: doc } };
  } finally {
    inFlight = false;
  }
}

export type ShareOutcome = 'shared' | 'cancelled';

/**
 * Offer the finished file to the operating system's share sheet. Given the file only.
 *
 * A sheet the person dismisses rejects on some platforms and resolves on others, and
 * neither can be told from a failure to present it: both read as a cancellation, with no
 * error shown for backing out and nothing to undo anywhere.
 */
export async function shareGeneratedReport(
  report: Pick<GeneratedReport, 'uri' | 'filename'>,
  share: (uri: string, filename: string) => Promise<void>,
): Promise<ShareOutcome> {
  if (!report.uri) return 'cancelled';
  try {
    await share(report.uri, report.filename);
    return 'shared';
  } catch {
    return 'cancelled';
  }
}
