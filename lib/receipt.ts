import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatDateTime, formatMoney } from './format';
import { getLanguage, isRtlLanguage, t } from './i18n';
import { receiptPolicyLine } from './return-policy';
import { buildReceiptHtml, receiptLabels, type ReceiptData } from './receipt-html';
import { openPageInTab } from './browser-tab';

export type {
  ReceiptData,
  ReceiptLine,
  ReceiptParty,
  ReceiptPayment,
  ReceiptPayStatus,
} from './receipt-html';

/**
 * Sharing the customer's copy.
 *
 * Rendered as HTML → PDF → the OS share sheet, so it reaches the customer over
 * WhatsApp, which is how business actually gets done here. No printer driver,
 * no hardware assumption. The document itself is built by `receipt-html.ts`,
 * which knows nothing about the phone; this file only supplies the app's
 * language and formatters and hands the file to the share sheet.
 */

/** The document, in the app's current language. */
export function receiptHtml(data: ReceiptData): string {
  const lang = getLanguage();
  return buildReceiptHtml(data, {
    labels: receiptLabels((key) => t(key)),
    lang,
    rtl: isRtlLanguage(lang),
    formatMoney,
    formatDateTime,
    policyLine: receiptPolicyLine(data.returnPolicy, t, formatDateTime),
  });
}

/**
 * iOS lays the page out from these rather than from `@page`; Android's print
 * path reads the stylesheet. Both come to 16mm × 18mm, the same column.
 */
const PAGE_MARGINS_PT = { top: 45, bottom: 45, left: 51, right: 51 };

/**
 * Build the PDF and hand it to the OS share sheet.
 *
 * On web there is no share sheet: the receipt opens in a new tab, where the
 * browser prints it or saves it as a PDF. Returns false when it could not be
 * handed over — no share sheet on the phone, or the browser blocked the tab.
 */
export async function shareReceipt(data: ReceiptData): Promise<boolean> {
  if (Platform.OS === 'web') return openPageInTab(receiptHtml(data)) === 'opened';

  const { uri } = await Print.printToFileAsync({ html: receiptHtml(data), margins: PAGE_MARGINS_PT });
  if (!(await Sharing.isAvailableAsync())) return false;

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: t('sell.done.share'),
    UTI: 'com.adobe.pdf',
  });
  return true;
}
