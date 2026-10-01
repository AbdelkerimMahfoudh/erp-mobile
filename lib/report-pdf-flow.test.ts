/**
 * Making a report PDF — what the flow may and may not do (docs/66).
 *
 *   node lib/report-pdf-flow.test.ts
 *
 * Driven with recording fakes in place of the API client, the printer and the share
 * sheet. Pinned: the only request is one GET of the report document; nothing is sent,
 * paid, scheduled or addressed to anybody; a document from another branch or a newer
 * contract is never printed; a second tap does not start a second PDF; and a share the
 * person dismisses — or that fails — touches nothing on the server.
 */
import assert from 'node:assert/strict';
import { generateReportPdf, isGeneratingReport, shareGeneratedReport, type ReportPdfDeps } from './report-pdf-flow.ts';
import { reportDocumentPath, REPORT_DOCUMENT_VERSION } from './report-document.ts';
import type { ReportPdfContext } from './report-pdf-html.ts';
import { en } from './i18n/en.ts';

let passed = 0;
const tests: [string, () => Promise<void>][] = [];
const it = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const ctx: ReportPdfContext = {
  lang: 'en',
  rtl: false,
  text: (k) => (en as Record<string, string>)[k] ?? k,
  formatMoney: (v) => `${v} MRU`,
  formatNumber: (v) => String(v),
  formatDate: (d) => d,
  formatDateTime: (i) => i,
  formatMonth: (m) => m,
  formatDayRange: (a, b) => `${a}–${b}`,
};

const DAILY = {
  kind: 'daily',
  version: REPORT_DOCUMENT_VERSION,
  identity: { company: 'Tech Plus', branch: 'Main Store', timezone: 'UTC' },
  date: '2026-10-01',
  window: { startsAt: '2026-10-01T06:00:00.000Z', endsAt: '2026-10-02T06:00:00.000Z' },
  generatedAt: '2026-10-01T19:30:00.000Z',
  isToday: true,
  standing: 'open',
  basis: { source: 'live', closedAt: null, closedBy: null, reclosed: false, acknowledgedUnverified: false, reason: null },
  sections: { sales: true, expenses: true, result: false, refunds: false },
  sales: { invoices: { count: 1, value: 100, items: 1 }, cancellations: { count: 0, value: 0, items: 0 }, returns: { count: 0, value: 0 }, net: { count: 1, items: 1, value: 100 }, collected: 100, owed: 0 },
  result: { status: 'hidden' },
  expenses: { total: 0, recorded: 0, reversed: 0, variable: 0, fixed: 0, salaries: 0, count: 0, byCategory: [] },
  money: { basis: 'recorded_movement_not_balance', channels: [{ kind: 'cash', label: 'Cash', in: 100, out: 0, net: 100 }], totals: { in: 100, out: 0, net: 100, olderDebts: 0 } },
  checks: [{ kind: 'cash', label: 'Cash', expected: 100, counted: null, difference: null, verification: 'not_counted' }],
  refunds: null,
  receivables: { amount: 0, sales: 0 },
  warnings: [],
};

const MONTHLY = {
  kind: 'monthly',
  version: REPORT_DOCUMENT_VERSION,
  identity: { company: 'Tech Plus', branch: 'Main Store', timezone: 'UTC' },
  month: '2026-09',
  from: '2026-09-01',
  to: '2026-09-30',
  complete: true,
  generatedAt: '2026-10-01T08:00:00.000Z',
  sections: { result: false, refunds: false },
  sales: { invoices: { count: 0, value: 0, items: 0 }, cancellations: { count: 0, value: 0, items: 0 }, returns: { count: 0, value: 0 }, net: { count: 0, items: 0, value: 0 } },
  result: { status: 'hidden' },
  expenses: { total: 0, variable: 0, fixedOther: 0, salaries: 0, count: 0 },
  refunds: null,
  receivables: { sales: { amount: 0, sales: 0 }, loansReceivable: 0, loansPayable: 0, consignmentReceivable: 0 },
  commissions: { recorded: false },
  days: [],
  warnings: [],
};

/** A fake server: records every request and holds some state a write would change. */
function fakeServer(reply: unknown = DAILY) {
  const requests: string[] = [];
  const state = { sales: 3, closings: 1, auditRows: 10 };
  const before = JSON.stringify(state);
  return {
    requests,
    unchanged: () => JSON.stringify(state) === before,
    get: async (path: string) => {
      requests.push(`GET ${path}`);
      return structuredClone(reply);
    },
  };
}

function deps(over: Partial<ReportPdfDeps> & { server?: ReturnType<typeof fakeServer>; branch?: () => string | null; written?: string[] } = {}): ReportPdfDeps {
  const server = over.server ?? fakeServer();
  return {
    get: server.get,
    activeBranch: over.branch ?? (() => 'branch-a'),
    context: () => ctx,
    writePdf: async (html, filename, branchId) => {
      over.written?.push(`${branchId}/${filename}:${html.length > 0}`);
      return `file:///cache/reports/pdf/${branchId}/${filename}`;
    },
    ...over,
  };
}

it('the daily PDF: one GET of that business date, then a named file on the phone', async () => {
  const server = fakeServer();
  const written: string[] = [];
  const outcome = await generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps({ server, written }));
  assert.equal(outcome.status, 'ready');
  assert.deepEqual(server.requests, ['GET /reports/daily?date=2026-10-01']);
  assert.deepEqual(written, ['branch-a/RetailERP_MainStore_Daily_2026-10-01_EN.pdf:true']);
  if (outcome.status !== 'ready') return;
  assert.equal(outcome.report.filename, 'RetailERP_MainStore_Daily_2026-10-01_EN.pdf');
  assert.equal(outcome.report.uri, 'file:///cache/reports/pdf/branch-a/RetailERP_MainStore_Daily_2026-10-01_EN.pdf');
  assert.match(outcome.report.html, /^<!DOCTYPE html>/);
});

it('the monthly PDF: the month asked for, or the current one when none is', async () => {
  const server = fakeServer(MONTHLY);
  await generateReportPdf({ kind: 'monthly', month: '2026-09' }, deps({ server }));
  await generateReportPdf({ kind: 'monthly' }, deps({ server }));
  assert.deepEqual(server.requests, ['GET /reports/monthly?month=2026-09', 'GET /reports/monthly']);
  assert.equal(reportDocumentPath({ kind: 'daily' }), '/reports/daily');
});

it('on the web there is no file: the page is kept to open in a tab', async () => {
  const outcome = await generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps({ writePdf: undefined }));
  assert.equal(outcome.status, 'ready');
  if (outcome.status === 'ready') {
    assert.equal(outcome.report.uri, null);
    assert.ok(outcome.report.html.includes('Daily report'));
  }
});

it('only ever reads: no request but the one GET, and none to a messaging, payment or subscription service', async () => {
  const server = fakeServer();
  await generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps({ server }));
  assert.equal(server.requests.length, 1);
  for (const r of server.requests) {
    assert.match(r, /^GET \/reports\/(daily|monthly)(\?|$)/);
    assert.ok(!/whatsapp|message|notif|payment|subscription|schedule|recipient/i.test(r));
  }
  assert.ok(server.unchanged());
});

it('the branch changed while the document was read: discarded, nothing written', async () => {
  let branch = 'branch-a';
  const server = fakeServer();
  const written: string[] = [];
  const outcome = await generateReportPdf(
    { kind: 'daily', date: '2026-10-01' },
    deps({
      written,
      branch: () => branch,
      get: async (path) => {
        const reply = await server.get(path);
        branch = 'branch-b';
        return reply;
      },
    }),
  );
  assert.deepEqual(outcome, { status: 'stale' });
  assert.deepEqual(written, []);
});

it('the branch changed while the file was written: discarded too', async () => {
  let branch = 'branch-a';
  const outcome = await generateReportPdf(
    { kind: 'daily', date: '2026-10-01' },
    deps({
      branch: () => branch,
      writePdf: async () => {
        branch = 'branch-b';
        return 'file:///x.pdf';
      },
    }),
  );
  assert.deepEqual(outcome, { status: 'stale' });
});

it('a document of a newer contract, or of the other kind, is refused whole — never printed half-understood', async () => {
  const written: string[] = [];
  for (const reply of [{ ...DAILY, version: REPORT_DOCUMENT_VERSION + 1 }, MONTHLY, null, { kind: 'daily' }]) {
    const outcome = await generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps({ server: fakeServer(reply), written }));
    assert.deepEqual(outcome, { status: 'unsupported' });
  }
  assert.deepEqual(written, []);
});

it('a second tap while a PDF is being made starts nothing; the next one after it does', async () => {
  let release: () => void = () => undefined;
  const server = fakeServer();
  const slow = deps({ get: (path) => new Promise((resolve) => (release = () => void server.get(path).then(resolve))) });
  const first = generateReportPdf({ kind: 'daily', date: '2026-10-01' }, slow);
  assert.equal(isGeneratingReport(), true);
  assert.deepEqual(await generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps({ server })), { status: 'busy' });
  release();
  assert.equal((await first).status, 'ready');
  assert.equal(isGeneratingReport(), false);
  assert.equal((await generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps())).status, 'ready');
});

it('a refusal from the server reaches the screen unchanged, and the next attempt can still run', async () => {
  const refusal = Object.assign(new Error('Missing permission(s): report.view'), { status: 403 });
  await assert.rejects(generateReportPdf({ kind: 'daily' }, deps({ get: async () => Promise.reject(refusal) })), refusal);
  assert.equal(isGeneratingReport(), false);
});

it('a printer failure is an error, and nothing else happens', async () => {
  const server = fakeServer();
  await assert.rejects(
    generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps({ server, writePdf: async () => Promise.reject(new Error('print failed')) })),
    /print failed/,
  );
  assert.equal(server.requests.length, 1);
  assert.ok(server.unchanged());
});

it('sharing: given the file only; dismissed or failed, it is a cancellation and the server is untouched', async () => {
  const server = fakeServer();
  const outcome = await generateReportPdf({ kind: 'daily', date: '2026-10-01' }, deps({ server }));
  assert.equal(outcome.status, 'ready');
  if (outcome.status !== 'ready') return;
  const shared: string[] = [];
  assert.equal(await shareGeneratedReport(outcome.report, async (uri, name) => void shared.push(`${uri}|${name}`)), 'shared');
  assert.deepEqual(shared, [`${outcome.report.uri}|RetailERP_MainStore_Daily_2026-10-01_EN.pdf`]);
  assert.equal(await shareGeneratedReport(outcome.report, async () => Promise.reject(new Error('User did not share'))), 'cancelled');
  assert.equal(await shareGeneratedReport(outcome.report, async () => Promise.reject(new Error('Unable to present'))), 'cancelled');
  assert.equal(await shareGeneratedReport({ uri: null, filename: 'x.pdf' }, async () => assert.fail('no file, no sheet')), 'cancelled');
  // Generating once and sharing three times read the server once and changed nothing there.
  assert.equal(server.requests.length, 1);
  assert.ok(server.unchanged());
});

for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
}
console.log(`report pdf flow: ${passed} passed`);
