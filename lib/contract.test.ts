/**
 * A server older than the app: its reply is refused whole, and the screen says so —
 * never a crash on a missing figure, never a missing figure shown as zero (docs/54).
 *
 *   node lib/contract.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkHome, checkMoneyOverview, checkSalesByDay, IncompatibleResponse, retryUnlessIncompatible } from './contract.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const figures = {
  salesValue: 20040, salesCount: 1, phonesSold: 1,
  cancellations: { count: 1, value: 10040, phones: 1 },
  returns: { count: 0, value: 0, phones: 0 },
  netSalesValue: 10000, collected: 10000, expenses: 0, expensesRecorded: 0, expensesReversed: 0, expensesCount: 0,
  stillOwed: 0, stillOwedScope: 'these_sales',
};
const home = () => ({
  period: 'today',
  range: { from: '2026-09-25', to: '2026-09-25' },
  businessDay: { businessDate: '2026-09-25', localDate: '2026-09-25', timezone: 'Asia/Dubai', startsAt: '', endsAt: '', startedEarly: false },
  figures: structuredClone(figures),
  series: { unit: 'hour', total: 20040, bars: [{ key: '9', label: '09', from: '', to: '', value: 20040 }] },
  topPartner: null,
  partners: { available: false, partnersExist: false, ranked: 0 },
  arrivals: [{ unitId: 'u', label: 'iPhone 16', variant: null, receivedAt: '2026-09-24T21:30:00.000Z', receivedLocalDate: '2026-09-25', receivedLocalTime: '01:30', status: 'in_stock', identifierKind: 'imei', identifierLast4: '1234' }],
  closing: null,
  generatedAt: '',
}) as never;

const refused = (fn: () => unknown): IncompatibleResponse => {
  try { fn(); } catch (e) { if (e instanceof IncompatibleResponse) return e; throw e; }
  throw new Error('expected the reply to be refused');
};

it('Home as the running server sent it before the update (no returns): refused, naming what is missing — the crash on the phone', () => {
  const old = home() as { figures: Record<string, unknown> };
  delete old.figures.returns;
  delete old.figures.netSalesValue;
  const e = refused(() => checkHome(old as never));
  assert.equal(e.code, 'incompatible_response');
  assert.ok(e.missing.includes('figures.returns.count'), e.missing.join());
  assert.ok(e.missing.includes('figures.netSalesValue'), e.missing.join());
});

it('Home without the store-local arrival time or the store date: refused, rather than guessed from the phone\'s clock', () => {
  const noLocal = home() as { arrivals: Record<string, unknown>[]; businessDay: Record<string, unknown> };
  delete noLocal.arrivals[0].receivedLocalTime;
  delete noLocal.businessDay.localDate;
  const e = refused(() => checkHome(noLocal as never));
  assert.deepEqual([...e.missing].sort(), ['arrivals.0.receivedLocalTime', 'businessDay.localDate']);
});

it('a figure sent as null or text is not a number, and is refused rather than read as zero', () => {
  const nulled = home() as { figures: Record<string, unknown> };
  nulled.figures.collected = null;
  nulled.figures.stillOwed = '0';
  assert.deepEqual(refused(() => checkHome(nulled as never)).missing, ['figures.collected', 'figures.stillOwed']);
});

it('Home for a person who may not see money (figures and series null) is valid; figures left out entirely are not', () => {
  const hidden = home() as { figures: unknown; series: unknown };
  hidden.figures = null;
  hidden.series = null;
  assert.equal(checkHome(hidden as never), hidden);
  const absent = home() as { figures?: unknown };
  delete absent.figures;
  assert.ok(refused(() => checkHome(absent as never)).missing.includes('figures.salesValue'));
});

it('a complete Home passes through unchanged', () => {
  const ok = home();
  assert.equal(checkHome(ok), ok);
});

const cashHeld = () => ({
  key: 'cash', channel: 'cash', accountId: null, label: '', scope: 'branch', isActive: true, known: true, position: 3400, unknownReason: null,
  anchor: { source: 'counted_close', amount: 3400, at: '2026-09-25T20:00:00.000Z', businessDate: '2026-09-25', byName: 'Mariam' }, sinceAnchorNet: 0,
});
const bankilyHeld = () => ({
  key: 'account:b', channel: 'account', accountId: 'b', label: 'Bankily', scope: 'company', isActive: true, known: true, position: 3600, unknownReason: null,
  anchor: { source: 'declared', amount: 3000, at: '2026-09-25T09:00:00.000Z', businessDate: '2026-09-25', byName: null }, sinceAnchorNet: 600,
});
const moneyOverview = () => ({
  today: '2026-09-26',
  cashNow: 5000,
  moneyToday: {
    channels: [
      { channel: 'cash', accountId: null, label: 'CASH', isUnattributed: false, moneyIn: 3400, moneyOut: 0, net: 3400 },
      { channel: 'account', accountId: 'b', label: 'Bankily', isUnattributed: false, moneyIn: 3600, moneyOut: 0, net: 3600 },
    ],
    total: { moneyIn: 7000, moneyOut: 0, net: 7000 },
  },
  trackedMoney: {
    asOf: '2026-09-26T08:00:00.000Z', businessDate: '2026-09-26', basis: 'anchor_plus_recorded_movement', branchCount: 1, accountsVisible: true,
    methods: [cashHeld(), bankilyHeld()], total: 7000, unknownKeys: [] as string[],
  },
  period: { phonesSold: 1, unitsSold: 1, salesCount: 1, salesValue: 20040, cancellations: { count: 1, value: 10040, phones: 1 }, returns: { count: 0, value: 0, phones: 0 }, adjusted: 10040, netSalesValue: 10000, collected: 10000, outstanding: 0, refunds: 0 },
  expensesToday: { total: -300, recorded: 0, reversed: 300, rows: [{ amount: -300 }] },
});

it('Money\'s overview and sales by day from the older server are refused; complete ones pass', () => {
  const overview = moneyOverview();
  assert.equal(checkMoneyOverview(overview as never), overview);
  const old = { cashNow: 5000, period: { phonesSold: 1, salesValue: 20040, collected: 10000, outstanding: 0, refunds: 0 }, expensesToday: { total: 0, rows: [] } };
  const e = refused(() => checkMoneyOverview(old as never));
  assert.ok(['today', 'period.unitsSold', 'period.cancellations.count', 'period.netSalesValue', 'expensesToday.reversed', 'moneyToday.total.net', 'moneyToday.channels'].every((p) => e.missing.includes(p)), e.missing.join());
  const day = { day: '2026-09-25', sales: 1, units: 1, value: 20040, cancelled: 10040, returned: 0, returns: 0, adjusted: 10040, net: 10000, phones: 1, outstanding: 0 };
  assert.ok(checkSalesByDay({ days: [day] } as never));
  assert.deepEqual(refused(() => checkSalesByDay({ days: [{ day: '2026-09-25', sales: 2, value: 20040 }] } as never)).missing.slice(0, 2), ['days.0.units', 'days.0.cancelled']);
});

it('money held: an unknown method is a null position and a null total, and passes — never read as zero (2026-09-27)', () => {
  const partial = moneyOverview();
  partial.trackedMoney.methods = [
    { ...cashHeld(), known: false, position: null, unknownReason: 'no_counted_close', anchor: null, sinceAnchorNet: null },
    bankilyHeld(),
  ] as never;
  (partial.trackedMoney as { total: number | null }).total = null;
  partial.trackedMoney.unknownKeys = ['cash'];
  assert.equal(checkMoneyOverview(partial as never), partial);
});

it('money held: a reply without it, a known method without its figure or anchor, or an absent total is refused', () => {
  const without = moneyOverview() as { trackedMoney?: unknown };
  delete without.trackedMoney;
  const e = refused(() => checkMoneyOverview(without as never));
  assert.ok(['trackedMoney.branchCount', 'trackedMoney.accountsVisible', 'trackedMoney.total', 'trackedMoney.methods'].every((p) => e.missing.includes(p)), e.missing.join());

  const gaps = moneyOverview();
  gaps.trackedMoney.methods = [{ ...cashHeld(), position: null }, { ...bankilyHeld(), anchor: null }] as never;
  delete (gaps.trackedMoney as { total?: unknown }).total;
  assert.deepEqual(refused(() => checkMoneyOverview(gaps as never)).missing, [
    'trackedMoney.total',
    'trackedMoney.methods.0.position',
    'trackedMoney.methods.1.anchor.amount',
    'trackedMoney.methods.1.anchor.businessDate',
  ]);

  // An unknown method must still say null: a position left out is not "unknown".
  const absent = moneyOverview();
  const noPosition: Record<string, unknown> = { ...cashHeld(), known: false };
  delete noPosition.position;
  absent.trackedMoney.methods = [noPosition] as never;
  assert.deepEqual(refused(() => checkMoneyOverview(absent as never)).missing, ['trackedMoney.methods.0.position']);
});

it('money held for someone other than the Owner: the drawer alone and no total pass; whether the accounts are shown must be said as a boolean', () => {
  const drawer = moneyOverview();
  drawer.trackedMoney.accountsVisible = false;
  drawer.trackedMoney.methods = [cashHeld()];
  (drawer.trackedMoney as { total: number | null }).total = null;
  assert.equal(checkMoneyOverview(drawer as never), drawer);

  for (const said of [undefined, null, 'false', 0]) {
    const unsaid = moneyOverview() as { trackedMoney: Record<string, unknown> };
    if (said === undefined) delete unsaid.trackedMoney.accountsVisible;
    else unsaid.trackedMoney.accountsVisible = said;
    assert.deepEqual(refused(() => checkMoneyOverview(unsaid as never)).missing, ['trackedMoney.accountsVisible'], String(said));
  }
});

it('an incompatible reply is not retried; any other failure is retried once', () => {
  assert.equal(retryUnlessIncompatible(0, new IncompatibleResponse('/home', ['x'])), false);
  assert.equal(retryUnlessIncompatible(0, new Error('network')), true);
  assert.equal(retryUnlessIncompatible(1, new Error('network')), false);
});

it('the reads use the check, and the screens say the server needs updating', () => {
  assert.match(code(read('./home.ts')), /queryFn: async \(\) => checkHome\(await api\.get<HomeResponse>/);
  assert.match(code(read('./home.ts')), /retry: retryUnlessIncompatible/);
  const money = code(read('./money-overview.ts'));
  assert.match(money, /checkMoneyOverview\(await api\.get<MoneyOverview>/);
  assert.match(money, /checkSalesByDay\(await api\.get</);
  assert.match(code(read('./errors.ts')), /if \(error instanceof IncompatibleResponse\) \{\s*return generic\('contract\.incompatible\.title', 'contract\.incompatible\.body', true\);/);
  const screen = code(read('../app/(tabs)/index.tsx'));
  assert.match(screen, /const failure = home\.isError && !data \? toFriendlyError\(home\.error\) : null;/);
  assert.match(code(read('../app/(tabs)/money-hub.tsx')), /isIncompatible\(card\.error\) \? t\('contract\.incompatible\.title'\)/);
  assert.match(code(read('../app/sales/period.tsx')), /overview\.isError \? \(/);
});

console.log(`contract: ${passed} passed`);
