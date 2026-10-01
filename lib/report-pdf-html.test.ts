/**
 * The daily and monthly report PDFs, as documents (docs/66).
 *
 *   node lib/report-pdf-html.test.ts
 *
 * Built under bare `node` from the same builder the app prints with, in the three
 * languages, from the three catalogues and the app's own money formatter. What is pinned:
 * every figure printed is the document's own, a section the server withheld is said to be
 * withheld and never drawn as zero, cost and profit never appear without the result, every
 * value somebody typed is escaped, Arabic is right-to-left with its figures intact, the
 * file is named as the brief asks, and the page rules keep a heading with its figures.
 */
import assert from 'node:assert/strict';
import { format } from 'date-fns';
import { buildReportHtml, fileSafeName, REPORT_PDF_DYNAMIC_PREFIXES, REPORT_PDF_KEYS, reportFileName, type ReportPdfContext, type ReportPdfLanguage } from './report-pdf-html.ts';
import type { DailyReportDocument, MonthlyReportDocument } from './report-document.ts';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';
import { formatMoney, formatNumber } from './money-format.ts';
import { dateLocaleFor } from './date-locale.ts';
import { calendarDate, dayRangeShape } from './day-range.ts';

process.env.TZ = 'UTC';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

const DICT = { en, fr, ar } as const;
const NBSP = ' ';
const MINUS = '−';

/** The app's own date conventions (lib/format.ts), rebuilt here because that file needs the i18n store. */
function ctx(lang: ReportPdfLanguage = 'en'): ReportPdfContext {
  const locale = dateLocaleFor(lang);
  const day = (d: string, pattern: string) => format(calendarDate(d), pattern, { locale });
  return {
    lang,
    rtl: lang === 'ar',
    text: (key) => (DICT[lang] as Record<string, string>)[key] ?? key,
    formatMoney: (v) => formatMoney(v),
    formatNumber: (v) => formatNumber(v),
    formatDate: (d) => day(d, 'd MMM yyyy'),
    formatDateTime: (i) => format(new Date(i), 'd MMM yyyy · HH:mm', { locale }),
    formatMonth: (m) => {
      const s = day(`${m}-01`, 'MMMM yyyy');
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    formatDayRange: (from, to) => {
      switch (dayRangeShape(from, to)) {
        case 'day':
          return day(from, 'd MMM yyyy');
        case 'month':
          return `${day(from, 'd')}–${day(to, 'd MMM yyyy')}`;
        case 'year':
          return `${day(from, 'd MMM')} – ${day(to, 'd MMM yyyy')}`;
        default:
          return `${day(from, 'd MMM yyyy')} – ${day(to, 'd MMM yyyy')}`;
      }
    },
  };
}

const m = (v: number) => formatMoney(v);
/**
 * Visible text only — tags dropped and the entities a test looks for decoded. A chip is a
 * word of its own; any other inline span is part of the text around it. Only ASCII
 * whitespace is collapsed: the no-break spaces inside an amount are part of the amount.
 */
const textOf = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/, '')
    .replace(/<span class="chip[^"]*">([^<]*)<\/span>/g, ' $1 ')
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\r\n]+/g, ' ');

// ── A worked day: the figures of the backend contract test (report-documents.spec.ts) ──
function daily(over: Partial<DailyReportDocument> = {}): DailyReportDocument {
  return {
    kind: 'daily',
    version: 1,
    identity: { company: 'Tech Plus', branch: 'Main Store', timezone: 'Africa/Nouakchott' },
    date: '2026-10-01',
    window: { startsAt: '2026-10-01T06:00:00.000Z', endsAt: '2026-10-02T06:00:00.000Z' },
    generatedAt: '2026-10-01T19:30:00.000Z',
    isToday: true,
    standing: 'open',
    basis: { source: 'live', closedAt: null, closedBy: null, reclosed: false, acknowledgedUnverified: false, reason: null },
    sections: { sales: true, expenses: true, result: true, refunds: true },
    sales: {
      invoices: { count: 3, value: 45_500, items: 7 },
      cancellations: { count: 1, value: 5_000, items: 1 },
      returns: { count: 1, value: 8_500 },
      net: { count: 2, items: 6, value: 32_000 },
      collected: 32_500,
      owed: 13_000,
    },
    result: {
      status: 'ok',
      netSales: 32_000,
      costOfUnitsSold: 25_250,
      grossProfit: 6_750,
      variableExpenses: 1_200,
      resultBeforeFixed: 5_550,
      fixedExpenses: 15_000,
      resultAfterExpenses: -9_450,
    },
    expenses: {
      total: 16_200,
      recorded: 16_200,
      reversed: 0,
      variable: 1_200,
      fixed: 15_000,
      salaries: 0,
      count: 3,
      byCategory: [
        { category: 'Rent', amount: 15_000, count: 1 },
        { category: 'Transport', amount: 800, count: 1 },
        { category: 'Food', amount: 400, count: 1 },
      ],
    },
    money: {
      basis: 'recorded_movement_not_balance',
      channels: [
        { kind: 'cash', label: 'Cash', in: 19_000, out: 7_200, net: 11_800 },
        { kind: 'account', label: 'Bankily', in: 10_500, out: 15_000, net: -4_500 },
      ],
      totals: { in: 29_500, out: 22_200, net: 7_300, olderDebts: 4_000 },
    },
    checks: [
      { kind: 'cash', label: 'Cash', expected: 31_800, counted: 31_500, difference: -300, verification: 'counted' },
      { kind: 'account', label: 'Bankily', expected: -4_500, counted: null, difference: null, verification: 'not_counted' },
    ],
    refunds: { confirmed: { count: 1, amount: 6_000 }, awaitingConfirmation: { count: 1, amount: 2_000 }, outstanding: { count: 2, amount: 10_500 } },
    receivables: { amount: 13_000, sales: 1 },
    warnings: [
      { code: 'pending_refund_reports', severity: 'warning', params: { count: 1, amount: 2_000 } },
      { code: 'previous_day_needs_review', severity: 'info', params: { date: '2026-09-30' } },
    ],
    ...over,
  };
}

function monthly(over: Partial<MonthlyReportDocument> = {}): MonthlyReportDocument {
  return {
    kind: 'monthly',
    version: 1,
    identity: { company: 'Tech Plus', branch: 'Main Store', timezone: 'Africa/Nouakchott' },
    month: '2026-09',
    from: '2026-09-01',
    to: '2026-09-30',
    complete: true,
    generatedAt: '2026-10-01T08:15:00.000Z',
    sections: { result: true, refunds: true },
    sales: {
      invoices: { count: 3, value: 200_000, items: 4 },
      cancellations: { count: 1, value: 20_000, items: 1 },
      returns: { count: 1, value: 30_000 },
      net: { count: 2, items: 3, value: 150_000 },
    },
    result: {
      status: 'ok',
      netSales: 150_000,
      costOfUnitsSold: 113_000,
      grossProfit: 37_000,
      variableExpenses: 8_000,
      resultBeforeFixed: 29_000,
      fixedExpenses: 25_000,
      salaries: 35_000,
      netOperatingProfit: -31_000,
    },
    expenses: { total: 68_000, variable: 8_000, fixedOther: 25_000, salaries: 35_000, count: 4 },
    refunds: { confirmed: { count: 1, amount: 30_000 }, awaitingConfirmation: { count: 0, amount: 0 }, outstanding: { count: 1, amount: 4_000 } },
    receivables: { sales: { amount: 41_000, sales: 3 }, loansReceivable: 5_000, loansPayable: 12_000, consignmentReceivable: 7_500 },
    commissions: { recorded: false },
    days: [
      { date: '2026-09-03', count: 2, items: 3, netSales: 120_000 },
      { date: '2026-09-14', count: 0, items: 0, netSales: 60_000 },
      { date: '2026-09-20', count: 0, items: 0, netSales: -30_000 },
    ],
    warnings: [],
    ...over,
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const RAW_KEY = /\b(?:reportPdf|dailyReport|closing|results|reports)\.[a-zA-Z_.]+/;

// ── The daily report ─────────────────────────────────────────────────────────

it('daily, English: who, which business day, its state and when the PDF was made', () => {
  const html = buildReportHtml(daily(), ctx('en'));
  const text = textOf(html);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /<title>RetailERP_MainStore_Daily_2026-10-01_EN<\/title>/);
  for (const s of ['Daily report', 'Tech Plus', 'Main Store', '1 Oct 2026', 'Not closed', 'Generated 1 Oct 2026 · 19:30', 'The day is still open']) {
    assert.ok(text.includes(s), `missing "${s}"`);
  }
  assert.ok(text.includes('Business day from 1 Oct 2026 · 06:00 to 2 Oct 2026 · 06:00'));
});

it('daily: sales value, the counts, invoiced, the cancellation and the return taken off, net sales', () => {
  const text = textOf(buildReportHtml(daily(), ctx('en')));
  assert.ok(text.includes(`Sales value ${m(45_500)} 2 sales · 6 items`));
  assert.ok(text.includes(`Invoiced sales ${m(45_500)}`));
  assert.ok(text.includes(`Sales cancelled (1 · 1 items) ${MINUS}${m(5_000)}`));
  assert.ok(text.includes(`Returns approved (1) ${MINUS}${m(8_500)}`));
  assert.ok(text.includes(`Net sales ${m(32_000)}`));
  assert.ok(text.includes(`Collected for these sales ${m(32_500)}`));
  assert.ok(text.includes(`Still owed on these sales ${m(13_000)}`));
});

it('daily: the result, line by line — a loss printed with a true minus and the negative ink, never colour alone', () => {
  const html = buildReportHtml(daily(), ctx('en'));
  const text = textOf(html);
  assert.ok(text.includes(`Cost of items sold ${MINUS}${m(25_250)}`));
  assert.ok(text.includes(`Gross profit ${m(6_750)}`));
  assert.ok(text.includes(`Variable expenses ${MINUS}${m(1_200)}`));
  assert.ok(text.includes(`Before fixed costs ${m(5_550)}`));
  assert.ok(text.includes(`Fixed, due this day ${MINUS}${m(15_000)}`));
  assert.ok(text.includes(`Result after expenses ${MINUS}${m(9_450)}`));
  assert.match(html, new RegExp(`<span class="figure neg">${MINUS}9${NBSP}450${NBSP}MRU</span>`));
});

it('daily: no fixed cost due — one result line, never a "before fixed costs" equal to it', () => {
  const doc = daily({ result: { status: 'ok', netSales: 32_000, costOfUnitsSold: 25_250, grossProfit: 6_750, variableExpenses: 1_200, resultBeforeFixed: 5_550, fixedExpenses: 0, resultAfterExpenses: 5_550 } });
  const text = textOf(buildReportHtml(doc, ctx('en')));
  assert.ok(!text.includes('Before fixed costs'));
  assert.ok(text.includes(`Result after expenses ${m(5_550)}`));
});

it('daily: money recorded per channel, said plainly not to be a bank or wallet balance', () => {
  const text = textOf(buildReportHtml(daily(), ctx('en')));
  assert.ok(text.includes(`Cash drawer ${m(19_000)} ${MINUS}${m(7_200)} ${m(11_800)}`));
  assert.ok(text.includes(`Bankily ${m(10_500)} ${MINUS}${m(15_000)} ${MINUS}${m(4_500)}`));
  assert.ok(text.includes(`Money in the shop — recorded movement ${m(29_500)} ${MINUS}${m(22_200)} ${m(7_300)}`));
  assert.ok(text.includes('not a bank or wallet balance, and no provider has confirmed these amounts'));
});

it('daily: the checks — the drawer counted 300 short, the account not checked — in words beside the colour', () => {
  const html = buildReportHtml(daily(), ctx('en'));
  const text = textOf(html);
  assert.ok(text.includes(`Cash drawer ${m(31_800)} ${m(31_500)} ${MINUS}${m(300)} Counted`));
  assert.ok(text.includes(`Bankily ${MINUS}${m(4_500)} — — Not checked`));
  assert.match(html, /chip tone-warning">Counted</);
});

it('daily: refunds paid, reported only and still owed are three lines — the reported ones never counted as paid', () => {
  const text = textOf(buildReportHtml(daily(), ctx('en')));
  assert.ok(text.includes(`Refunds paid this day (1) ${m(6_000)}`));
  assert.ok(text.includes(`Reported, not yet confirmed (1) — not counted as paid ${m(2_000)}`));
  assert.ok(text.includes(`Still owed to customers (2) ${m(10_500)}`));
  assert.ok(text.includes(`Unpaid sale balances at this branch (1 sales) ${m(13_000)}`));
  assert.ok(text.includes('Amounts still owed are as they stand at 1 Oct 2026 · 19:30'));
});

it('daily: the warnings in the Daily closing’s own sentences, with a word beside each colour', () => {
  const text = textOf(buildReportHtml(daily(), ctx('en')));
  assert.ok(text.includes(`Check 1 refunds reported but not confirmed (${m(2_000)}). They are not counted as paid.`));
  assert.ok(text.includes('Note The previous day (30 Sep 2026) was not closed.'));
});

it('daily without cost.view: no cost, no profit, no result — said to be withheld, never drawn as zero', () => {
  const doc = daily({ result: { status: 'hidden' }, sections: { sales: true, expenses: true, result: false, refunds: true } });
  const text = textOf(buildReportHtml(doc, ctx('en')));
  for (const s of ['Cost of items sold', 'Gross profit', 'Before fixed costs', 'Result after expenses']) assert.ok(!text.includes(s), `printed "${s}"`);
  assert.ok(text.includes('Cost and profit are not included: they are not shown to your role.'));
  // The third headline figure becomes the money recorded, which this role may see.
  assert.ok(text.includes(`Money in the shop — recorded movement ${m(7_300)}`));
});

it('daily: a result that cannot be calculated says why, and prints no profit', () => {
  const text = textOf(buildReportHtml(daily({ result: { status: 'cannot_calculate', missingCostLines: 2 } }), ctx('en')));
  assert.ok(text.includes('Cannot calculate yet — 2 items sold or returned have no recorded cost.'));
  assert.ok(!text.includes('Gross profit'));
});

it('daily without return.view: refunds are said to be withheld', () => {
  const text = textOf(buildReportHtml(daily({ refunds: null, sections: { sales: true, expenses: true, result: true, refunds: false } }), ctx('en')));
  assert.ok(text.includes('Refunds are not included: they are not shown to your role.'));
  assert.ok(!text.includes('Refunds paid this day'));
});

it('a closed day: as closed, when and by whom, the reason given and the acknowledgement', () => {
  const doc = daily({
    standing: 'closed',
    isToday: false,
    basis: { source: 'snapshot', closedAt: '2026-10-01T21:04:00.000Z', closedBy: 'Amina', reclosed: true, acknowledgedUnverified: true, reason: 'Bankily app down' },
  });
  const text = textOf(buildReportHtml(doc, ctx('en')));
  assert.ok(text.includes('As closed at 1 Oct 2026 · 21:04 by Amina'));
  assert.ok(text.includes('Closed with balances not physically checked'));
  assert.ok(text.includes('Not checked: Bankily app down'));
  assert.ok(text.includes('Closed'));
  assert.ok(!text.includes('The day is still open'));
});

it('a day with no activity says there is nothing to close — never that it was not closed', () => {
  const text = textOf(buildReportHtml(daily({ isToday: false, standing: 'inactive' }), ctx('en')));
  assert.ok(text.includes('Nothing was sold, paid, counted or opened on this day. There is nothing to close.'));
  assert.ok(!text.includes('This day was not closed'));
  assert.ok(text.includes('No activity recorded'));
});

it('a past day nobody closed says so', () => {
  const text = textOf(buildReportHtml(daily({ isToday: false, standing: 'needs_review' }), ctx('en')));
  assert.ok(text.includes('This day was not closed'));
  assert.ok(text.includes('Needs review'));
});

it('an empty day: zeros, and "no expenses" in words', () => {
  const doc = daily({
    sales: { invoices: { count: 0, value: 0, items: 0 }, cancellations: { count: 0, value: 0, items: 0 }, returns: { count: 0, value: 0 }, net: { count: 0, items: 0, value: 0 }, collected: 0, owed: 0 },
    result: { status: 'ok', netSales: 0, costOfUnitsSold: 0, grossProfit: 0, variableExpenses: 0, resultBeforeFixed: 0, fixedExpenses: 0, resultAfterExpenses: 0 },
    expenses: { total: 0, recorded: 0, reversed: 0, variable: 0, fixed: 0, salaries: 0, count: 0, byCategory: [] },
    money: { basis: 'recorded_movement_not_balance', channels: [{ kind: 'cash', label: 'Cash', in: 0, out: 0, net: 0 }], totals: { in: 0, out: 0, net: 0, olderDebts: 0 } },
    checks: [{ kind: 'cash', label: 'Cash', expected: 0, counted: null, difference: null, verification: 'not_counted' }],
    refunds: { confirmed: { count: 0, amount: 0 }, awaitingConfirmation: { count: 0, amount: 0 }, outstanding: { count: 0, amount: 0 } },
    receivables: { amount: 0, sales: 0 },
    warnings: [],
  });
  const html = buildReportHtml(doc, ctx('en'));
  const text = textOf(html);
  assert.ok(text.includes(`Sales value ${m(0)} 0 sales · 0 items`));
  assert.ok(text.includes('No expenses recorded for this day.'));
  assert.ok(!text.includes('Sales cancelled') && !text.includes('Returns approved'));
  assert.ok(!html.includes('Needs attention'));
  assert.ok(!html.includes(MINUS));
});

it('large figures keep every digit, grouped, on one line', () => {
  const doc = daily({
    sales: { invoices: { count: 812, value: 987_654_321, items: 1_204 }, cancellations: { count: 0, value: 0, items: 0 }, returns: { count: 0, value: 0 }, net: { count: 812, items: 1_204, value: 987_654_321 }, collected: 900_000_000, owed: 87_654_321 },
  });
  const html = buildReportHtml(doc, ctx('en'));
  assert.ok(html.includes(`987${NBSP}654${NBSP}321${NBSP}MRU`));
  assert.ok(textOf(html).includes('812 sales · 1 204 items'.replace(' 204', `${NBSP}204`)));
  assert.match(html, /\.figure \{ white-space: nowrap; direction: ltr; unicode-bidi: isolate;/);
});

// ── The monthly report ───────────────────────────────────────────────────────

it('monthly, English: the month, whole, then sales, the result to the net result with rent and salaries apart', () => {
  const html = buildReportHtml(monthly(), ctx('en'));
  const text = textOf(html);
  assert.match(html, /<title>RetailERP_MainStore_Monthly_2026-09_EN<\/title>/);
  for (const s of ['Monthly report', 'September 2026', 'Whole month · 1–30 Sep 2026', 'Generated 1 Oct 2026 · 08:15']) assert.ok(text.includes(s), `missing "${s}"`);
  assert.ok(text.includes(`Net sales ${m(150_000)} 2 sales · 3 items`));
  assert.ok(text.includes(`Cost of items sold ${MINUS}${m(113_000)}`));
  assert.ok(text.includes(`Gross profit ${m(37_000)}`));
  assert.ok(text.includes(`Variable expenses ${MINUS}${m(8_000)}`));
  assert.ok(text.includes(`Result before fixed costs ${m(29_000)}`));
  assert.ok(text.includes(`Rent and other fixed costs ${MINUS}${m(25_000)}`));
  assert.ok(text.includes(`Salaries ${MINUS}${m(35_000)}`));
  assert.ok(text.includes(`Net result ${MINUS}${m(31_000)}`));
  assert.ok(text.includes(`Total ${m(68_000)}`));
});

it('monthly: refunds, what is owed (branch and whole business), and commissions said to be unrecorded', () => {
  const text = textOf(buildReportHtml(monthly(), ctx('en')));
  assert.ok(text.includes(`Refunds paid this month (1) ${m(30_000)}`));
  assert.ok(text.includes(`Still owed to customers (1) ${m(4_000)}`));
  assert.ok(text.includes(`Unpaid sale balances at this branch (3 sales) ${m(41_000)}`));
  assert.ok(text.includes(`Loans owed to the business ${m(5_000)}`));
  assert.ok(text.includes(`Consignment owed to the business ${m(7_500)}`));
  assert.ok(text.includes(`Loans the business owes ${m(12_000)}`));
  assert.ok(text.includes('for the whole business, not this branch alone'));
  assert.ok(text.includes('External commissions Not recorded in the app yet, so no figure is shown rather than a zero.'));
});

it('monthly: the day-by-day table — each day, then the month, the same total as the sales above', () => {
  const html = buildReportHtml(monthly(), ctx('en'));
  const text = textOf(html);
  assert.ok(text.includes(`3 Sep 2026 2 3 ${m(120_000)}`));
  assert.ok(text.includes(`14 Sep 2026 0 0 ${m(60_000)}`));
  assert.ok(text.includes(`20 Sep 2026 0 0 ${MINUS}${m(30_000)}`));
  assert.ok(text.includes(`Month 2 3 ${m(150_000)}`));
  assert.equal((html.match(/<section class="block days">/g) ?? []).length, 1);
});

it('monthly without cost.view: no profit anywhere; expenses, refunds and what is owed remain', () => {
  const text = textOf(buildReportHtml(monthly({ result: { status: 'hidden' }, sections: { result: false, refunds: true } }), ctx('en')));
  for (const s of ['Gross profit', 'Net result', 'Cost of items sold', 'Result before fixed costs']) assert.ok(!text.includes(s), `printed "${s}"`);
  assert.ok(text.includes('Cost and profit are not included'));
  assert.ok(text.includes(`Salaries ${m(35_000)}`));
  assert.ok(text.includes(`Invoiced sales ${m(200_000)}`));
});

it('monthly: the month still running is said to be month to date, with the warning in words', () => {
  const doc = monthly({ month: '2026-10', from: '2026-10-01', to: '2026-10-01', complete: false, days: [], warnings: [{ code: 'month_in_progress', severity: 'info', params: { to: '2026-10-01' } }] });
  const text = textOf(buildReportHtml(doc, ctx('en')));
  assert.ok(text.includes('Month to date · 1 Oct 2026'));
  assert.ok(text.includes('Note The month is not over: these figures run to 1 Oct 2026.'));
  assert.ok(text.includes('No sales, cancellations or returns this month.'));
});

it('monthly: figures that disagree are a printed problem, never hidden', () => {
  const text = textOf(buildReportHtml(monthly({ warnings: [{ code: 'figures_disagree', severity: 'error', params: { count: 2 } }] }), ctx('en')));
  assert.ok(text.includes('Problem 2 figures from two of the server’s records do not agree yet.'));
});

// ── Languages and direction ──────────────────────────────────────────────────

it('Arabic: right to left, in Arabic words, with every amount an isolated left-to-right figure', () => {
  for (const html of [buildReportHtml(daily(), ctx('ar')), buildReportHtml(monthly(), ctx('ar'))]) {
    assert.match(html, /<html lang="ar" dir="rtl">/);
    const body = html.replace(/<style[\s\S]*?<\/style>/, '');
    // Every "MRU" sits inside a figure span: "45 500 MRU" can never read "MRU 500 45".
    const loose = body.replace(/<span class="figure[^"]*">[^<]*<\/span>/g, '');
    assert.ok(!loose.includes('MRU'), 'an amount outside an isolated figure');
    assert.ok(body.includes('صافي المبيعات'));
  }
  const text = textOf(buildReportHtml(daily(), ctx('ar')));
  for (const s of ['التقرير اليومي', 'قيمة المبيعات', 'الربح الإجمالي', 'المبالغ المستردة', 'حركات الأموال', 'أكتوبر']) assert.ok(text.includes(s), `missing "${s}"`);
  assert.ok(textOf(buildReportHtml(monthly(), ctx('ar'))).includes('سبتمبر 2026'));
});

it('Arabic: the layout follows the direction — start-aligned labels, end-aligned figures, the accent on the start side', () => {
  const html = buildReportHtml(daily(), ctx('ar'));
  assert.match(html, /th \{ text-align: start;/);
  assert.match(html, /td\.num, th\.num \{ text-align: end;/);
  assert.match(html, /border-inline-start: 2\.4pt solid/);
  assert.match(html, /\.when \{ text-align: end;/);
});

it('French: French words, French months, the same figures', () => {
  const text = textOf(buildReportHtml(daily(), ctx('fr')));
  for (const s of ['Rapport journalier', 'Valeur des ventes', 'Ventes nettes', 'Marge brute', 'Remboursements', 'oct.']) assert.ok(text.includes(s), `missing "${s}"`);
  assert.ok(text.includes(m(32_000)));
  assert.ok(textOf(buildReportHtml(monthly(), ctx('fr'))).includes('Septembre 2026'));
});

it('every language: no placeholder left unfilled and no catalogue key printed', () => {
  for (const lang of ['en', 'fr', 'ar'] as const) {
    for (const html of [
      buildReportHtml(daily(), ctx(lang)),
      buildReportHtml(daily({ result: { status: 'hidden' }, refunds: null }), ctx(lang)),
      buildReportHtml(daily({ standing: 'closed', basis: { source: 'snapshot', closedAt: '2026-10-01T21:04:00.000Z', closedBy: null, reclosed: false, acknowledgedUnverified: false, reason: null } }), ctx(lang)),
      buildReportHtml(monthly({ warnings: [{ code: 'month_in_progress', severity: 'info', params: { to: '2026-09-30' } }, { code: 'figures_disagree', severity: 'error', params: { count: 1 } }] }), ctx(lang)),
      buildReportHtml(monthly({ result: { status: 'hidden' }, refunds: null, days: [] }), ctx(lang)),
    ]) {
      const text = textOf(html);
      assert.ok(!/\{\w+\}/.test(text), `${lang}: an unfilled placeholder in "${text.match(/.{30}\{\w+\}.{10}/)?.[0]}"`);
      assert.ok(!RAW_KEY.test(text), `${lang}: a raw key ${text.match(RAW_KEY)?.[0]}`);
    }
  }
});

it('every key the page prints exists in all three catalogues — the fixed ones and those reached by a code', () => {
  for (const lang of ['en', 'fr', 'ar'] as const) {
    const dict = DICT[lang] as Record<string, string>;
    for (const key of REPORT_PDF_KEYS) assert.ok(dict[key], `${lang} lacks ${key}`);
    for (const standing of ['open', 'counting', 'counted', 'closed', 'reopened', 'needs_review', 'inactive']) assert.ok(dict[`closing.standing.${standing}`], `${lang} lacks closing.standing.${standing}`);
    for (const v of ['counted', 'skipped', 'not_verified', 'attested', 'stale', 'not_counted', 'account.counted', 'account.stale']) assert.ok(dict[`dailyReport.verify.${v}`], `${lang} lacks dailyReport.verify.${v}`);
    for (const w of ['channels_not_verified', 'channels_attested', 'channels_stale', 'account_movement_not_balance', 'unattributed_money', 'pending_refund_reports', 'pending_expense_reports', 'cost_missing', 'no_counted_opening', 'opening_not_verified', 'negative_expected', 'open_discrepancies', 'previous_day_needs_review', 'overcollected', 'changed_since_close', 'figures_disagree', 'other']) {
      assert.ok(dict[`dailyReport.warning.${w}`], `${lang} lacks dailyReport.warning.${w}`);
    }
    for (const s of ['info', 'warning', 'error']) assert.ok(dict[`reportPdf.severity.${s}`]);
  }
  assert.deepEqual([...REPORT_PDF_DYNAMIC_PREFIXES], ['closing.standing.', 'dailyReport.verify.', 'dailyReport.warning.']);
});

// ── What may never reach the page ────────────────────────────────────────────

it('every value somebody typed is escaped — names, labels, categories, the closer and the reason', () => {
  const evil = '<script>alert(1)</script>';
  const doc = daily({
    identity: { company: `Shop ${evil}`, branch: '"><img src=x onerror=alert(2)>', timezone: 'UTC' },
    standing: 'closed',
    basis: { source: 'snapshot', closedAt: '2026-10-01T21:04:00.000Z', closedBy: `Ali ${evil}`, reclosed: false, acknowledgedUnverified: false, reason: `</p><iframe src="https://evil">` },
    money: { basis: 'recorded_movement_not_balance', channels: [{ kind: 'account', label: `Bank & <b>Co</b>`, in: 1, out: 0, net: 1 }], totals: { in: 1, out: 0, net: 1, olderDebts: 0 } },
    checks: [{ kind: 'account', label: `<svg onload=alert(3)>`, expected: 1, counted: null, difference: null, verification: 'not_counted' }],
    expenses: { total: 5, recorded: 5, reversed: 0, variable: 5, fixed: 0, salaries: 0, count: 1, byCategory: [{ category: `Tea ${evil}`, amount: 5, count: 1 }] },
    warnings: [{ code: 'previous_day_needs_review', severity: 'info', params: { date: '2026-09-30' } }, { code: `x"><script>`, severity: 'warning' }],
  });
  for (const lang of ['en', 'ar'] as const) {
    const html = buildReportHtml(doc, ctx(lang));
    const body = html.replace(/<style[\s\S]*?<\/style>/, '');
    for (const tag of ['<script', '<img', '<iframe', '<svg', '<b>']) assert.ok(!body.includes(tag), `${lang}: unescaped ${tag}`);
    assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(body.includes('Bank &amp; &lt;b&gt;Co&lt;/b&gt;'));
    assert.ok(body.includes('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;'));
  }
  // The file name of a hostile branch is plain letters.
  assert.equal(reportFileName(doc, 'en'), 'RetailERP_ImgSrcXOnerrorAlert2_Daily_2026-10-01_EN.pdf');
});

it('no id, no WhatsApp, no payment link on the page — whatever extra field a document might carry', () => {
  const doc = daily() as DailyReportDocument & Record<string, unknown>;
  const smuggled = { ...doc, accountId: 'b0000000-0000-7000-8000-000000000001', userId: '01890000-0000-7000-8000-000000000002', phone: '+22236123456' };
  const html = buildReportHtml(smuggled, ctx('en'));
  assert.ok(!UUID.test(html));
  assert.ok(!html.includes('+22236123456'));
  assert.ok(!/whatsapp|wa\.me|graph\.facebook|paiement|payment/i.test(html.replace(/<style[\s\S]*?<\/style>/, '')));
  assert.ok(!/<script|<a\s|href=/i.test(html));
});

it('the same document always gives the same page', () => {
  assert.equal(buildReportHtml(daily(), ctx('fr')), buildReportHtml(daily(), ctx('fr')));
  assert.equal(buildReportHtml(monthly(), ctx('ar')), buildReportHtml(monthly(), ctx('ar')));
});

// ── The page and the file ────────────────────────────────────────────────────

it('A4 on white; a heading never ends a page alone; sections and table rows are kept whole; the header row repeats', () => {
  const html = buildReportHtml(monthly(), ctx('en'));
  assert.match(html, /@page \{ size: A4; margin: 14mm 16mm; \}/);
  assert.match(html, /html, body \{ margin: 0; padding: 0; background: #FFFFFF; \}/);
  assert.match(html, /section\.block \{[^}]*break-inside: avoid; page-break-inside: avoid; \}/);
  assert.match(html, /h2 \{[^}]*break-after: avoid; page-break-after: avoid; \}/);
  assert.match(html, /thead \{ display: table-header-group; \}/);
  assert.match(html, /tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
  // One accent, the app's indigo, and no images or gradients.
  assert.ok(html.includes('#5146D9'));
  assert.ok(!/gradient|<img|url\(/i.test(html));
});

it('the shop and its branch: the branch under the title, and said once when it carries the shop’s own name', () => {
  const two = buildReportHtml(daily(), ctx('en'));
  assert.match(two, /<h1>Tech Plus<\/h1><div class="branch">Main Store<\/div>/);
  const same = buildReportHtml(daily({ identity: { company: 'Boutique 1', branch: 'Boutique 1', timezone: 'UTC' } }), ctx('en'));
  assert.match(same, /<h1>Boutique 1<\/h1>(?!<div class="branch">)/);
  assert.equal((textOf(same).match(/Boutique 1/g) ?? []).length, 1);
});

it('the footer never takes a page of its own: it follows the last section', () => {
  assert.match(buildReportHtml(daily(), ctx('fr')), /footer \{[^}]*break-before: avoid; page-break-before: avoid; \}/);
});

it('file names: RetailERP, the store, the kind and period, the language — plain ASCII', () => {
  assert.equal(reportFileName(daily(), 'en'), 'RetailERP_MainStore_Daily_2026-10-01_EN.pdf');
  assert.equal(reportFileName(monthly({ month: '2026-10' }), 'ar'), 'RetailERP_MainStore_Monthly_2026-10_AR.pdf');
  assert.equal(reportFileName(daily(), 'fr'), 'RetailERP_MainStore_Daily_2026-10-01_FR.pdf');
  assert.equal(fileSafeName('Boutique Élan / Nouakchott #2'), 'BoutiqueElanNouakchott2');
  assert.equal(fileSafeName('متجر النور', 'Tech Plus'), 'TechPlus');
  assert.equal(fileSafeName('متجر النور', 'شركة'), 'Store');
  assert.equal(fileSafeName('../../etc/passwd'), 'EtcPasswd');
  assert.equal(fileSafeName('a'.repeat(80)).length, 40);
  assert.equal(fileSafeName(null, undefined, ''), 'Store');
});

console.log(`report pdf html: ${passed} passed`);
