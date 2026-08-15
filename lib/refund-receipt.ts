import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { api } from './api-client';
import { formatDateTime, formatMoney } from './format';
import { getLanguage, isRtlLanguage, t } from './i18n';
import type { RefundReceipt } from '../types/api';

/**
 * The customer's refund receipt.
 *
 * Same delivery path as the sale receipt — HTML → PDF → the OS share sheet, via
 * `expo-print` and `expo-sharing`, both already dependencies. No new package, no
 * printer driver, no persistence beyond the temporary file the OS hands to the
 * share sheet.
 *
 * **The content comes only from the server's confirmed-refund endpoint.** Not
 * from the return detail the screen is holding, and not from anything the app
 * computed: a receipt is a statement about money that has already moved, so it
 * must be a projection of the immutable record rather than a re-derivation. The
 * endpoint refuses with 409 until the refund is confirmed, which is also what
 * stops a receipt existing for a payout nobody has vouched for.
 *
 * Deliberately absent: cost, margin, internal ids, permissions, audit metadata,
 * and any suggestion that a bank or provider verified the transaction. The shop
 * is stating what it paid; nothing here was checked with anyone else.
 */

/** Escape anything dynamic — product names, labels and notes are user data. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The identifier, masked the way the sale receipt already masks it.
 *
 * A full IMEI on a shared PDF is the customer's device fingerprint travelling
 * over WhatsApp. The last four are enough for them to match it to the phone
 * they handed in.
 */
function maskIdentifier(identifier: string | null): string {
  if (!identifier) return '—';
  if (identifier.length <= 4) return identifier;
  return `••••${identifier.slice(-4)}`;
}

export function buildRefundReceiptHtml(data: RefundReceipt): string {
  const rtl = isRtlLanguage(getLanguage());
  const dir = rtl ? 'rtl' : 'ltr';

  const adjustmentRows = data.adjustments
    .map(
      (a) =>
        `<div class="row"><span>${esc(a.label)}${
          a.quantity > 1 ? ` ×${a.quantity}` : ''
        }</span><span>-${esc(formatMoney(a.amount))}</span></div>`,
    )
    .join('');

  const adjustmentTotal = data.adjustments.reduce((sum, a) => sum + a.amount, 0);

  const methodLine =
    data.method === 'cash'
      ? esc(t('refund.method.cash'))
      : esc(data.accountLabel ?? t('refund.method.account'));

  return `<!doctype html>
<html dir="${dir}" lang="${esc(getLanguage())}">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; width: 80mm; margin: 0 auto; padding: 8mm 4mm; color: #111; direction: ${dir}; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 2mm; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 8pt; }
  .row { display: flex; justify-content: space-between; gap: 4mm; font-size: 9pt; margin: 1mm 0; }
  .total { font-weight: 700; font-size: 11pt; }
  hr { border: 0; border-top: 1px dashed #999; margin: 3mm 0; }
</style>
</head>
<body>
  <div class="center"><strong>${esc(data.store.name)}</strong></div>
  <div class="center muted">${esc(data.store.branch)}${
    data.store.phone ? ` · ${esc(data.store.phone)}` : ''
  }</div>
  <hr />
  <h1>${esc(t('refund.receipt.title'))}</h1>
  <div class="row"><span>${esc(t('refund.receipt.reference'))}</span><span>${esc(data.reference)}</span></div>
  <div class="row"><span>${esc(t('refund.receipt.originalInvoice'))}</span><span>${esc(data.originalInvoiceNo)}</span></div>
  <div class="row"><span>${esc(t('refund.confirmedAt'))}</span><span>${esc(
    formatDateTime(new Date(data.confirmedAt)),
  )}</span></div>
  <hr />
  <div class="row"><span>${esc(data.product)}</span><span>${esc(maskIdentifier(data.identifier))}</span></div>
  <hr />
  <div class="row"><span>${esc(t('returns.detail.gross'))}</span><span>${esc(formatMoney(data.grossRefund))}</span></div>
  ${adjustmentRows}
  ${
    data.adjustments.length > 0
      ? `<div class="row"><span>${esc(t('refund.receipt.adjustmentTotal'))}</span><span>-${esc(
          formatMoney(adjustmentTotal),
        )}</span></div>`
      : ''
  }
  <div class="row total"><span>${esc(t('refund.receipt.netReturned'))}</span><span>${esc(
    formatMoney(data.netAmountReturned),
  )}</span></div>
  <hr />
  <div class="row"><span>${esc(t('refund.method'))}</span><span>${methodLine}</span></div>
  ${
    data.transactionReference
      ? `<div class="row"><span>${esc(t('refund.reference'))}</span><span>${esc(
          data.transactionReference,
        )}</span></div>`
      : ''
  }
  <div class="row"><span>${esc(t('refund.receipt.status'))}</span><span>${esc(
    t('refund.confirmed.status'),
  )}</span></div>
  <hr />
  <div class="center muted">${esc(t('receipt.thanks'))}</div>
</body>
</html>`;
}

/**
 * Fetch the confirmed receipt, render it and hand it to the share sheet.
 *
 * Returns false when sharing is unavailable rather than throwing, so the caller
 * can say so plainly. **A failure here changes nothing about the confirmed
 * record** — the money moved and the server said so; producing the paperwork is
 * a separate act that can be retried.
 */
export async function shareRefundReceipt(returnId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const data = await api.get<RefundReceipt>(`/returns/${returnId}/refund/receipt`);
  const { uri } = await Print.printToFileAsync({ html: buildRefundReceiptHtml(data) });
  if (!(await Sharing.isAvailableAsync())) return false;

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: t('refund.receipt.action'),
    UTI: 'com.adobe.pdf',
  });
  return true;
}

/** Whether the receipt button should be offered at all. */
export function canShareRefundReceipt(): boolean {
  return Platform.OS !== 'web';
}
