import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatDateTime, formatMoney } from './format';
import { isRtlLanguage, getLanguage, t } from './i18n';

/**
 * Receipt generation.
 *
 * Rendered as HTML → PDF → the OS share sheet, so it reaches the customer over
 * WhatsApp, which is how business actually gets done here. No printer driver,
 * no hardware assumption. Thermal printing can be added later without changing
 * this shape — the receipt data is already separated from how it is delivered.
 *
 * Deliberately narrow (80mm) so it also looks right if someone does send it to
 * a receipt printer.
 */

export interface ReceiptLine {
  label: string;
  identifier?: string;
  quantity: number;
  unitPrice: number;
}

export interface ReceiptData {
  invoiceNo: string;
  soldAt: Date;
  branchName: string;
  cashierName: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount: number;
  total: number;
  payments: { method: string; amount: number }[];
}

/** Escape anything that lands in the HTML — product names are user data. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(data: ReceiptData): string {
  const rtl = isRtlLanguage(getLanguage());
  const dir = rtl ? 'rtl' : 'ltr';

  const rows = data.lines
    .map(
      (line) => `
      <tr>
        <td class="name">
          ${esc(line.label)}
          ${line.identifier ? `<div class="id">${esc(line.identifier)}</div>` : ''}
        </td>
        <td class="num">${line.quantity}</td>
        <td class="num">${esc(formatMoney(line.unitPrice, { showCurrency: false }))}</td>
        <td class="num strong">${esc(formatMoney(line.unitPrice * line.quantity, { showCurrency: false }))}</td>
      </tr>`,
    )
    .join('');

  const payments = data.payments
    .map(
      (p) => `
      <div class="row">
        <span>${esc(p.method)}</span>
        <span>${esc(formatMoney(p.amount))}</span>
      </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html dir="${dir}">
<head><meta charset="utf-8" />
<style>
  @page { margin: 8mm; }
  body {
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px; color: #151B26; width: 80mm; margin: 0 auto;
  }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .muted { color: #5F6877; font-size: 11px; }
  .center { text-align: center; }
  hr { border: none; border-top: 1px dashed #D8DDE5; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: ${rtl ? 'right' : 'left'}; font-size: 10px; color: #5F6877;
       text-transform: uppercase; letter-spacing: .04em; padding-bottom: 4px; }
  td { padding: 4px 0; vertical-align: top; }
  .num { text-align: ${rtl ? 'left' : 'right'}; white-space: nowrap; }
  .name { width: 55%; }
  .id { font-family: "SF Mono", Menlo, monospace; font-size: 10px;
        color: #8A93A2; direction: ltr; unicode-bidi: isolate; }
  .strong { font-weight: 600; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .total { font-size: 16px; font-weight: 700; }
</style>
</head>
<body>
  <div class="center">
    <h1>${esc(data.branchName)}</h1>
    <div class="muted">${esc(t('receipt.invoice'))} ${esc(data.invoiceNo)}</div>
    <div class="muted">${esc(formatDateTime(data.soldAt))}</div>
  </div>
  <hr />
  <table>
    <thead>
      <tr>
        <th>${esc(t('receipt.item'))}</th>
        <th class="num">${esc(t('receipt.qty'))}</th>
        <th class="num">${esc(t('receipt.price'))}</th>
        <th class="num">${esc(t('receipt.lineTotal'))}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <hr />
  <div class="row"><span>${esc(t('sell.subtotal'))}</span><span>${esc(formatMoney(data.subtotal))}</span></div>
  ${
    data.discount > 0
      ? `<div class="row"><span>${esc(t('sell.discount'))}</span><span>-${esc(formatMoney(data.discount))}</span></div>`
      : ''
  }
  <div class="row total"><span>${esc(t('sell.total'))}</span><span>${esc(formatMoney(data.total))}</span></div>
  <hr />
  ${payments}
  <hr />
  <div class="center muted">${esc(t('receipt.servedBy'))}: ${esc(data.cashierName)}</div>
  <div class="center muted">${esc(t('receipt.thanks'))}</div>
</body>
</html>`;
}

/**
 * Build the PDF and hand it to the OS share sheet.
 *
 * Returns false when sharing is unavailable — on web there is no share sheet,
 * so the caller should keep the button hidden rather than offer something that
 * cannot work.
 */
export async function shareReceipt(data: ReceiptData): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { uri } = await Print.printToFileAsync({ html: buildHtml(data) });
  if (!(await Sharing.isAvailableAsync())) return false;

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: t('sell.done.share'),
    UTI: 'com.adobe.pdf',
  });
  return true;
}

/** Whether the receipt button should be offered at all. */
export function canShareReceipt(): boolean {
  return Platform.OS !== 'web';
}
