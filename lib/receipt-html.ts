import type { ReturnPolicySnapshot } from './return-policy';

/**
 * The customer's copy — the HTML that becomes the invoice PDF.
 *
 * Pure. No React Native, no i18n store, no printer: the labels, the writing
 * direction and the two formatters are handed in, so the same builder runs
 * under bare `node` for the tests and inside the app for the share sheet.
 * There is exactly one generator; `receipt.ts` is the thin wrapper that feeds
 * it the app's language and hands the result to the OS.
 *
 * ## What may reach the customer
 *
 * Only what the server confirmed about THIS sale: who sold it and where, what
 * exactly was sold (the item, its variant, and the full IMEI or serial — the
 * warranty proof, per docs/04 §D 19d), what it cost the customer, how it was
 * paid and what is still owed. `ReceiptData` has no field for cost, margin,
 * profit, an internal id or anybody's permissions, so none of them can be
 * printed by accident; `receipt-privacy.test.ts` pins that shape.
 *
 * ## The page
 *
 * A4 and Letter both. The content sits in a column about 83% of the page
 * width with even margins, the table's header repeats on every page and a row
 * never splits across one. Print-safe ink only — no gradients, no photos: an
 * invoice is read on paper and on a cracked phone screen alike.
 */

export interface ReceiptLine {
  /** The product as the shop names it — brand and model. */
  label: string;
  /** The exact variant (colour, storage), when the label does not already say it. */
  variant?: string | null;
  /** The full IMEI or serial number of a serialized item. Absent for a counted product. */
  identifier?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface ReceiptPayment {
  /** How it was paid, already in the reader's language. */
  method: string;
  amount: number;
  /** The receiving account as it was labelled when the money arrived. */
  account?: string | null;
  /** Money taken with the sale, or received later against the balance. */
  kind?: 'at_sale' | 'collection';
  paidAt?: Date | null;
}

export interface ReceiptParty {
  name: string;
  phone?: string | null;
}

export type ReceiptPayStatus = 'paid' | 'partial' | 'unpaid';

export interface ReceiptData {
  invoiceNo: string;
  soldAt: Date;
  /** The business, when the app knows it. The branch is always named. */
  storeName?: string | null;
  branchName: string;
  /**
   * A configured logo, as a `data:` or file URI. The slot exists; nothing sets
   * it until the server exposes a store logo, and the header lays out the same
   * with or without one.
   */
  logoUri?: string | null;
  cashierName: string;
  /** The named customer, or null for a cash customer. */
  customer?: ReceiptParty | null;
  lines: ReceiptLine[];
  subtotal: number;
  discount: number;
  total: number;
  payments: ReceiptPayment[];
  amountPaid?: number;
  balanceDue?: number;
  payStatus?: ReceiptPayStatus;
  /** Who owes the balance, when one is owed. A customer, or a partner store. */
  debtor?: (ReceiptParty & { kind: 'customer' | 'store' }) | null;
  /**
   * The policy THIS sale was sold under, as the server snapshotted it.
   *
   * Not the shop's current setting: the receipt in the customer's hand has to
   * say what they were actually promised, and a receipt reprinted after the
   * Owner changes the policy must still say the same thing.
   */
  returnPolicy: ReturnPolicySnapshot;
}

/** Every word the document prints that is not data. */
export interface ReceiptLabels {
  invoice: string;
  date: string;
  branch: string;
  customer: string;
  cashCustomer: string;
  phone: string;
  servedBy: string;
  item: string;
  qty: string;
  price: string;
  lineTotal: string;
  subtotal: string;
  discount: string;
  total: string;
  amountPaid: string;
  remaining: string;
  statusPaid: string;
  statusPartial: string;
  statusUnpaid: string;
  payments: string;
  /** "on {date}" — a later collection says when the money arrived. */
  paidOn: string;
  owedBy: string;
  owedByStore: string;
  thanks: string;
}

/** The catalogue key behind each label, so one `t` builds the whole set. */
export const RECEIPT_LABEL_KEYS = {
  invoice: 'receipt.invoice',
  date: 'receipt.date',
  branch: 'receipt.branch',
  customer: 'receipt.customer',
  cashCustomer: 'receipt.cashCustomer',
  phone: 'receipt.phone',
  servedBy: 'receipt.servedBy',
  item: 'receipt.item',
  qty: 'receipt.qty',
  price: 'receipt.price',
  lineTotal: 'receipt.lineTotal',
  subtotal: 'sell.subtotal',
  discount: 'sell.discount',
  total: 'sell.total',
  amountPaid: 'receipt.amountPaid',
  remaining: 'receipt.remaining',
  statusPaid: 'receipt.status.paid',
  statusPartial: 'receipt.status.partial',
  statusUnpaid: 'receipt.status.unpaid',
  payments: 'receipt.payments',
  paidOn: 'receipt.paidOn',
  owedBy: 'receipt.owedBy',
  owedByStore: 'receipt.owedByStore',
  thanks: 'receipt.thanks',
} as const satisfies Record<keyof ReceiptLabels, string>;

export type ReceiptLabelKey = (typeof RECEIPT_LABEL_KEYS)[keyof typeof RECEIPT_LABEL_KEYS];

/** The label set for one language, from any translator that knows these keys. */
export function receiptLabels(translate: (key: ReceiptLabelKey) => string): ReceiptLabels {
  const out = {} as Record<keyof ReceiptLabels, string>;
  for (const name of Object.keys(RECEIPT_LABEL_KEYS) as (keyof ReceiptLabels)[]) {
    out[name] = translate(RECEIPT_LABEL_KEYS[name]);
  }
  return out;
}

export interface ReceiptContext {
  labels: ReceiptLabels;
  /** BCP-47 tag for `<html lang>`. */
  lang: string;
  rtl: boolean;
  formatMoney: (value: number, options?: { showCurrency?: boolean }) => string;
  formatDateTime: (value: Date) => string;
  /** The return-policy sentence for this sale, already worded. Never hardcoded here. */
  policyLine: string;
}

/**
 * Print-safe ink. Six flat colours, defined once: dark text, a quieter grey,
 * hairlines, and one pair each for paid, partly paid and unpaid. No gradients —
 * a wash reads as a grey block on a thermal printer and as mud on a photocopy.
 */
const INK = {
  text: '#151B26',
  muted: '#5F6877',
  rule: '#D8DDE5',
  paid: { fg: '#0F6E3C', bg: '#E6F4EC' },
  partial: { fg: '#8A5A00', bg: '#FFF4D6' },
  unpaid: { fg: '#9B1C1C', bg: '#FCE8E8' },
} as const;

/** Escape anything that lands in the HTML — every value is somebody's typing. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The status the document states. An explicit one wins; otherwise the money says. */
export function receiptPayStatus(data: Pick<ReceiptData, 'payStatus' | 'amountPaid' | 'balanceDue' | 'total'>): ReceiptPayStatus {
  if (data.payStatus) return data.payStatus;
  const owed = data.balanceDue ?? 0;
  if (owed <= 0) return 'paid';
  return (data.amountPaid ?? 0) > 0 ? 'partial' : 'unpaid';
}

export function buildReceiptHtml(data: ReceiptData, ctx: ReceiptContext): string {
  const { labels: L } = ctx;
  const money = (v: number) => esc(ctx.formatMoney(v));
  const bare = (v: number) => esc(ctx.formatMoney(v, { showCurrency: false }));
  const dir = ctx.rtl ? 'rtl' : 'ltr';

  const status = receiptPayStatus(data);
  const statusLabel = status === 'paid' ? L.statusPaid : status === 'partial' ? L.statusPartial : L.statusUnpaid;
  const owed = data.balanceDue ?? Math.max(0, data.total - (data.amountPaid ?? data.payments.reduce((s, p) => s + p.amount, 0)));
  const paid = data.amountPaid ?? data.payments.reduce((s, p) => s + p.amount, 0);

  const rows = data.lines
    .map(
      (line) => `
      <tr>
        <td class="name">
          <div class="label">${esc(line.label)}</div>
          ${line.variant ? `<div class="variant">${esc(line.variant)}</div>` : ''}
          ${line.identifier ? `<div class="id">${esc(line.identifier)}</div>` : ''}
        </td>
        <td class="num">${esc(line.quantity)}</td>
        <td class="num">${bare(line.unitPrice)}</td>
        <td class="num strong">${bare(line.unitPrice * line.quantity)}</td>
      </tr>`,
    )
    .join('');

  const payments = data.payments
    .map((p) => {
      const parts = [esc(p.method)];
      if (p.account) parts.push(esc(p.account));
      if (p.kind === 'collection' && p.paidAt) {
        // The label is escaped, then the date is dropped in already isolated.
        const date = `<span class="ltr">${esc(ctx.formatDateTime(p.paidAt))}</span>`;
        parts.push(esc(L.paidOn).replace('{date}', date));
      }
      return `
      <div class="row">
        <span>${parts.join(' · ')}</span>
        <span class="figure">${money(p.amount)}</span>
      </div>`;
    })
    .join('');

  const customer = data.customer
    ? `<div class="value">${esc(data.customer.name)}</div>${
        data.customer.phone ? `<div class="muted ltr">${esc(data.customer.phone)}</div>` : ''
      }`
    : `<div class="value muted">${esc(L.cashCustomer)}</div>`;

  const debtor =
    owed > 0 && data.debtor
      ? `
    <section class="block debtor">
      <div class="label">${esc(data.debtor.kind === 'store' ? L.owedByStore : L.owedBy)}</div>
      <div class="value">${esc(data.debtor.name)}</div>
      ${data.debtor.phone ? `<div class="muted ltr">${esc(data.debtor.phone)}</div>` : ''}
    </section>`
      : '';

  return `<!DOCTYPE html>
<html lang="${esc(ctx.lang)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${esc(L.invoice)} ${esc(data.invoiceNo)}</title>
<style>
  /*
   * A4 is 210mm wide, Letter 215.9mm. With these margins the column is
   * 174mm on A4 (83%) and 180mm on Letter (83%): the same document on both,
   * and never a narrow strip down the middle of the page.
   */
  @page { margin: 16mm 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif;
    font-size: 11pt; line-height: 1.4; color: ${INK.text};
    width: 100%;
  }
  /*
   * Figures, dates, identifiers and phone numbers are Latin-digit strings and
   * read the same in every language, so they are isolated left-to-right: in an
   * Arabic document "329 000 MRU" must not come out as "MRU 000 329".
   */
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .muted { color: ${INK.muted}; }
  .strong { font-weight: 600; }
  .label { font-size: 9pt; color: ${INK.muted}; text-transform: uppercase; letter-spacing: .06em; }
  .value { font-size: 12pt; font-weight: 600; overflow-wrap: anywhere; }
  .figure { white-space: nowrap; direction: ltr; unicode-bidi: isolate; }

  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm;
           padding: 2mm 0 7mm; border-bottom: 1.5pt solid ${INK.text}; }
  .store { display: flex; align-items: center; gap: 6mm; min-width: 0; }
  .logo { width: 22mm; height: 22mm; object-fit: contain; flex: none; }
  h1 { font-size: 18pt; line-height: 1.2; margin: 0; overflow-wrap: anywhere; }
  .branch { margin-top: 1mm; }
  .invoice { text-align: end; flex: none; }
  .invoice .no { font-size: 15pt; font-weight: 700; margin: 1mm 0; }
  .status { display: inline-block; margin-top: 2mm; padding: 1mm 3mm; border-radius: 2mm;
            font-size: 9.5pt; font-weight: 700; }
  .status-paid { color: ${INK.paid.fg}; background: ${INK.paid.bg}; }
  .status-partial { color: ${INK.partial.fg}; background: ${INK.partial.bg}; }
  .status-unpaid { color: ${INK.unpaid.fg}; background: ${INK.unpaid.bg}; }

  .parties { display: flex; gap: 12mm; padding: 6mm 0; border-bottom: .5pt solid ${INK.rule}; }
  .parties > div { flex: 1; min-width: 0; }

  table { width: 100%; border-collapse: collapse; margin-top: 6mm; }
  thead { display: table-header-group; }
  th { text-align: start; font-size: 9pt; color: ${INK.muted}; text-transform: uppercase;
       letter-spacing: .06em; padding: 0 0 2mm; border-bottom: .5pt solid ${INK.rule}; }
  td { padding: 3mm 0; vertical-align: top; border-bottom: .5pt solid ${INK.rule}; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th.num, td.num { text-align: end; white-space: nowrap; padding-inline-start: 4mm; }
  td.num { direction: ltr; unicode-bidi: isolate; }
  .name { width: 58%; }
  .name .label { text-transform: none; letter-spacing: 0; color: ${INK.text}; font-size: 11pt; font-weight: 600;
                 overflow-wrap: anywhere; }
  .variant { color: ${INK.muted}; overflow-wrap: anywhere; }
  .id { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 9.5pt; color: ${INK.muted};
        direction: ltr; unicode-bidi: isolate; text-align: start; overflow-wrap: anywhere; }

  .totals { margin-inline-start: auto; width: 60%; max-width: 100mm; padding-top: 5mm;
            break-inside: avoid; page-break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 6mm; padding: 1.2mm 0; }
  .row.total { font-size: 15pt; font-weight: 700; border-top: 1.5pt solid ${INK.text};
               margin-top: 2mm; padding-top: 3mm; }
  .row.owed { font-weight: 700; color: ${INK.unpaid.fg}; }

  .block { padding-top: 7mm; break-inside: avoid; page-break-inside: avoid; }
  .block .label { margin-bottom: 2mm; }
  .payments .row { border-bottom: .5pt solid ${INK.rule}; }

  footer { margin-top: 12mm; padding-top: 5mm; border-top: .5pt solid ${INK.rule};
           break-inside: avoid; page-break-inside: avoid; }
  .policy { font-weight: 600; }
  .thanks { margin-top: 4mm; }
</style>
</head>
<body>
  <header>
    <div class="store">
      ${data.logoUri ? `<img class="logo" src="${esc(data.logoUri)}" alt="" />` : ''}
      <div>
        <h1>${esc(data.storeName || data.branchName)}</h1>
        ${data.storeName ? `<div class="branch muted">${esc(L.branch)}: ${esc(data.branchName)}</div>` : ''}
      </div>
    </div>
    <div class="invoice">
      <div class="label">${esc(L.invoice)}</div>
      <div class="no ltr">${esc(data.invoiceNo)}</div>
      <div class="muted ltr">${esc(ctx.formatDateTime(data.soldAt))}</div>
      <span class="status status-${status}">${esc(statusLabel)}</span>
    </div>
  </header>

  <section class="parties">
    <div>
      <div class="label">${esc(L.customer)}</div>
      ${customer}
    </div>
    <div>
      <div class="label">${esc(L.servedBy)}</div>
      <div class="value">${esc(data.cashierName)}</div>
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th>${esc(L.item)}</th>
        <th class="num">${esc(L.qty)}</th>
        <th class="num">${esc(L.price)}</th>
        <th class="num">${esc(L.lineTotal)}</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>

  <section class="totals">
    <div class="row"><span>${esc(L.subtotal)}</span><span class="figure">${money(data.subtotal)}</span></div>
    ${data.discount > 0 ? `<div class="row"><span>${esc(L.discount)}</span><span class="figure">−${money(data.discount)}</span></div>` : ''}
    <div class="row total"><span>${esc(L.total)}</span><span class="figure">${money(data.total)}</span></div>
    <div class="row"><span>${esc(L.amountPaid)}</span><span class="figure">${money(paid)}</span></div>
    ${owed > 0 ? `<div class="row owed"><span>${esc(L.remaining)}</span><span class="figure">${money(owed)}</span></div>` : ''}
  </section>

  ${data.payments.length > 0 ? `
  <section class="block payments">
    <div class="label">${esc(L.payments)}</div>${payments}
  </section>` : ''}
  ${debtor}

  <footer>
    <div class="policy">${esc(ctx.policyLine)}</div>
    <div class="thanks muted">${esc(L.thanks)}</div>
  </footer>
</body>
</html>`;
}
