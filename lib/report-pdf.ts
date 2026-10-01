import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { api } from './api-client';
import { getActiveBranchId } from './branch';
import { formatDate, formatDateTime, formatDayRange, formatMoney, formatMonth, formatNumber } from './format';
import { getLanguage, isRtlLanguage, t } from './i18n';
import type { ReportRequest } from './report-document';
import {
  generateReportPdf,
  shareGeneratedReport,
  type GeneratedReport,
  type GenerateOutcome,
  type ShareOutcome,
} from './report-pdf-flow';
import type { ReportPdfContext } from './report-pdf-html';

/**
 * The daily and monthly report PDFs on this device (docs/66).
 *
 * The sequence is `report-pdf-flow.ts`; this file only hands it the app's API client,
 * language and formatters, and the device's printer and share sheet — the same
 * HTML → PDF → share path the customer's invoice takes (`receipt.ts`).
 *
 * On a phone the PDF is rendered on A4 and written under the app's private cache with
 * its own name, so the share sheet, Files and a chat app all show
 * `RetailERP_MainStore_Daily_2026-10-01_EN.pdf` rather than a random one. The cache is
 * swept before each new PDF and dropped on sign-out with the spreadsheet exports
 * (`clearExports`): a report is the shop's financial data.
 *
 * On the web there is no PDF renderer and no share sheet: the same page opens in a new
 * tab, where the browser's Print can save it as a PDF.
 */

/** A4 in points: 210 × 297 mm. */
const A4 = { width: 595, height: 842 };
/** iOS lays the page out from these rather than from `@page`; Android reads the stylesheet. Both 14 × 16 mm. */
const PAGE_MARGINS_PT = { top: 40, bottom: 40, left: 45, right: 45 };

function context(): ReportPdfContext {
  const lang = getLanguage();
  return {
    lang,
    rtl: isRtlLanguage(lang),
    text: (key) => t(key as never),
    formatMoney: (value) => formatMoney(value),
    formatNumber: (value) => formatNumber(value),
    formatDate,
    formatDateTime,
    formatMonth,
    formatDayRange,
  };
}

/** Under the same cache folder as the spreadsheet exports, so signing out clears both. */
function pdfDirectory(branchId: string | null): Directory {
  const dir = new Directory(Paths.cache, 'reports', 'pdf', branchId ?? 'all-branches');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

async function writePdf(html: string, filename: string, branchId: string | null): Promise<string> {
  const printed = await Print.printToFileAsync({ html, ...A4, margins: PAGE_MARGINS_PT });
  const dir = pdfDirectory(branchId);
  try {
    // A PDF from an earlier run goes first; the newest one is the one being offered.
    for (const entry of dir.list()) if (entry instanceof File) entry.delete();
  } catch {
    // A file another app is still reading, or a folder already reclaimed: not worth failing over.
  }
  const file = new File(printed.uri);
  await file.move(new File(dir, filename), { overwrite: true });
  return file.uri;
}

/** Make the PDF of one report. Throws the server's own refusal (`ApiError`) unchanged. */
export function makeReportPdf(request: ReportRequest): Promise<GenerateOutcome> {
  return generateReportPdf(request, {
    get: (path) => api.get<unknown>(path),
    activeBranch: getActiveBranchId,
    context,
    writePdf: Platform.OS === 'web' ? undefined : writePdf,
  });
}

/** Phones only: the OS share sheet, where the person chooses Files, Mail, a chat app — or nothing. */
export function canShareReportPdf(): boolean {
  return Platform.OS !== 'web';
}

export async function shareReportPdf(report: GeneratedReport): Promise<ShareOutcome> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing-unavailable');
  return shareGeneratedReport(report, (uri, filename) =>
    Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: filename }),
  );
}

/**
 * Open the report to read it. A phone shows the PDF in the system print preview, where it
 * can be zoomed, printed or passed on; the web opens the same page in a new tab.
 *
 * On the web this must run straight from the press: a browser only opens a tab for a click.
 */
export async function openReportPdf(report: GeneratedReport): Promise<'opened' | 'blocked'> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([report.html], { type: 'text/html;charset=utf-8' }));
    const tab = window.open(url, '_blank');
    // Long enough for the tab to load what it was given; it holds its own copy afterwards.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return tab ? 'opened' : 'blocked';
  }
  if (!report.uri) return 'blocked';
  await Print.printAsync({ uri: report.uri });
  return 'opened';
}
