/**
 * The Stock screen — what it may say, and what it must never say.
 *
 *   node lib/stock-screen.test.ts
 *
 * Half of this is arithmetic proved directly (`stock-price.ts`); the other half
 * is structural and read from source, because the failures it guards against —
 * a cost field in a preview, a status filter mixed into the category chips, a
 * Receive button that covers the last row — are invisible to the type checker.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { priceWording, stockStatus } from './stock-price.ts';

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

const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SCREEN = withoutComments(source('app/(tabs)/inventory.tsx'));
const ROW = withoutComments(source('components/inventory/StockRow.tsx'));

/* ── price ──────────────────────────────────────────────────────────────── */

it('says nothing is priced instead of showing zero', () => {
  assert.deepEqual(priceWording(null), { kind: 'unset' });
});

it('shows one price only when every priced unit agrees', () => {
  assert.deepEqual(priceWording({ min: 42000, max: 42000, pricedCount: 3, unpricedCount: 0 }), {
    kind: 'single',
    amount: 42000,
    unpriced: 0,
  });
});

it('shows "from" when one phone has its own price', () => {
  assert.deepEqual(priceWording({ min: 39000, max: 42000, pricedCount: 2, unpricedCount: 0 }), {
    kind: 'from',
    amount: 39000,
    unpriced: 0,
  });
});

it('keeps unpriced units visible alongside a price', () => {
  assert.equal(priceWording({ min: 39000, max: 39000, pricedCount: 1, unpricedCount: 2 }).kind, 'single');
  const w = priceWording({ min: 39000, max: 39000, pricedCount: 1, unpricedCount: 2 });
  assert.equal(w.kind !== 'unset' && w.unpriced, 2);
});

it('handles a very large price without changing the wording', () => {
  assert.equal(priceWording({ min: 999_999_999_999.99, max: 999_999_999_999.99, pricedCount: 1, unpricedCount: 0 }).kind, 'single');
});

/* ── status ─────────────────────────────────────────────────────────────── */

it('out of stock wins over low stock', () => {
  assert.equal(stockStatus(0, true), 'out');
  assert.equal(stockStatus(2, true), 'low');
  assert.equal(stockStatus(9, false), null);
});

it('never shows a status as colour alone', () => {
  // The chip carries its word; there is no bare coloured dot for low stock.
  assert.match(ROW, /<Chip label=\{status\}/);
});

/* ── data the screen must never touch ────────────────────────────────────── */

it('reads no cost or margin from a summary row', () => {
  for (const forbidden of ['row.cost', 'margin', 'grossProfit', 'inventoryValue']) {
    assert.ok(!ROW.includes(forbidden), `StockRow must not read ${forbidden}`);
  }
});

it('shows unit cost only when the server sent it', () => {
  assert.match(SCREEN, /row\.cost !== undefined \?/);
});

it('uses the server summary, not a client-side count', () => {
  assert.match(SCREEN, /'\/inventory\/summary'/);
  assert.ok(!/\.reduce\([^)]*available/.test(SCREEN), 'no client-side totalling of available stock');
});

it('uses no product image it cannot vouch for', () => {
  // The only image field is one handset's photo; it must not stand in for a variant.
  assert.ok(!/imageRef|<Image/.test(ROW + SCREEN));
});

/* ── search, filters, scanning ──────────────────────────────────────────── */

it('searches on the server, including both IMEIs', () => {
  assert.match(SCREEN, /params\.set\('search', debounced\)/);
  const en = source('lib/i18n/en.ts');
  assert.match(en, /'inventory\.search': '[^']*IMEI[^']*'/);
});

it('keeps category chips and status chips apart', () => {
  const summaryBranch = SCREEN.slice(SCREEN.indexOf("mode === 'summary' ? ("), SCREEN.indexOf(') : (', SCREEN.indexOf("mode === 'summary' ? (")));
  assert.match(summaryBranch, /stock\.category\.phone/);
  assert.ok(!summaryBranch.includes('STATUS_FILTERS'), 'status filters must not sit with categories');
  assert.match(SCREEN, /STATUS_FILTERS\.map/);
});

it('keeps the status filters and their server meaning', () => {
  assert.match(source('app/(tabs)/inventory.tsx'), /STATUS_FILTERS = \['in_stock', 'sold', 'faulty', ''\]/);
  assert.match(SCREEN, /params\.set\('status', status\)/);
});

it('keeps pagination on the unit list', () => {
  assert.match(SCREEN, /getNextPageParam: \(last\) => last\.nextCursor/);
  assert.match(SCREEN, /fetchNextPage\(\)/);
});

it('scans through the unchanged scanner sheet', () => {
  assert.match(SCREEN, /<ScannerSheet /);
  assert.ok(!/TextRecognition|recognizeText|takePictureAsync/.test(SCREEN), 'no OCR');
});

/* ── branch ─────────────────────────────────────────────────────────────── */

it('keys every query by branch', () => {
  assert.match(SCREEN, /qk\.inventorySummary\(branchId\)/);
  assert.match(SCREEN, /qk\.inventory\(branchId,/);
});

it('drops the previous branch\'s focus and search on a switch, without an effect', () => {
  assert.match(SCREEN, /if \(shownBranch !== branchId\)/);
  assert.ok(!/useEffect\(/.test(SCREEN));
});

it('puts the summary under the inventory prefix so existing invalidations reach it', () => {
  assert.match(source('lib/query-keys.ts'), /inventorySummary: \(branchId: string \| null\) => \['inventory', 'summary', branchId\]/);
  for (const f of ['app/(tabs)/sell.tsx', 'app/receive.tsx']) {
    assert.match(source(f), /qk\.inventorySummary\(branchId\)/, `${f} refreshes the shelf`);
  }
});

/* ── receive stock ──────────────────────────────────────────────────────── */

it('places Receive stock in the pinned footer, outside the list', () => {
  assert.match(SCREEN, /footer=\{footer\}/);
  assert.match(SCREEN, /const footer = canReceive \?/);
  assert.match(SCREEN, /router\.push\('\/receive' as Href\)/);
});

it('gates Receive stock on the same permission as Home', () => {
  assert.match(SCREEN, /usePermission\('purchase\.manage'\)/);
  assert.match(source('app/(tabs)/index.tsx'), /usePermission\('purchase\.manage'\)/);
});

it('never calls a refused delivery received', () => {
  const receive = withoutComments(source('app/receive.tsx'));
  // The server's answer decides, through the proved rules in lib/receive-outcome.
  assert.match(receive, /const outcome = settle\(lines, res\);/);
  // All refused: nothing written, the delivery stays on screen.
  assert.match(receive, /if \(outcome\.outcome === 'none'\) \{[\s\S]*?toast\.error\(t\('receive\.refused\.none'\)\);[\s\S]*?return;/);
  // Received counts come from what the server named, and refused lines are listed.
  assert.match(receive, /const received = outcome\.receivedUnits \+ outcome\.receivedPieces;/);
  assert.match(receive, /<RefusedNotice lines=\{refused\}/);
  for (const lang of ['en', 'fr', 'ar']) {
    const locale = source(`lib/i18n/${lang}.ts`);
    for (const key of ['receive.refused.title', 'receive.refused.none', 'receive.refused.alreadyRegistered', 'receive.refused.duplicateInBatch', 'receive.refused.other']) {
      assert.ok(locale.includes(`'${key}'`), `${lang} is missing ${key}`);
    }
  }
});

/* ── states ─────────────────────────────────────────────────────────────── */

it('never draws unknown stock as an empty shelf', () => {
  assert.match(SCREEN, /active\.isError && !active\.data \? \(/);
  assert.match(SCREEN, /<ErrorState /);
});

it('says when it is showing stale data', () => {
  assert.match(SCREEN, /\(!online \|\| active\.isError\) && active\.data/);
});

/* ── language ───────────────────────────────────────────────────────────── */

it('has every new key in all three languages', () => {
  const keys = [...source('components/inventory/StockRow.tsx').matchAll(/'(stock\.[a-zA-Z.]+)'/g), ...source('app/(tabs)/inventory.tsx').matchAll(/'(stock\.[a-zA-Z.]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10, 'found the keys');
  for (const lang of ['en', 'fr', 'ar']) {
    const locale = source(`lib/i18n/${lang}.ts`);
    for (const key of new Set(keys)) assert.ok(locale.includes(`'${key}'`), `${lang} is missing ${key}`);
  }
});

it('uses direction-aware alignment, not left or right', () => {
  assert.ok(!/align="(left|right)"/.test(ROW + SCREEN));
  assert.ok(!/marginLeft|marginRight|paddingLeft|paddingRight/.test(ROW + SCREEN));
});

it('keeps an amount in reading order inside an Arabic sentence', () => {
  assert.match(ROW, /isolateLtr\(formatMoney\(w\.amount\)\)/);
});

/* ── categories and quantities ───────────────────────────────────────────── */

it('makes serial-tracked devices reachable by a category chip, and keeps them under All', () => {
  assert.match(SCREEN, /type Category = 'all' \| 'phone' \| 'accessory' \| 'other'/);
  assert.match(SCREEN, /label=\{t\('stock\.category\.other'\)\}/);
  // All is the unfiltered list.
  assert.match(SCREEN, /category === 'all' \? allRows :/);
});

it('says what the filter numbers count', () => {
  assert.match(SCREEN, /t\('stock\.countsHint'\)/);
});

it('explains a low warning next to a reserved quantity instead of changing the rule', () => {
  assert.match(ROW, /row\.reserved > 0/);
  assert.match(ROW, /stock\.reservedOnHand/);
  // The row does not recompute "low" — the server's shared rule decides.
  assert.match(ROW, /stockStatus\(row\.available, row\.lowStock\)/);
});

it('agrees "available" with the count in French', () => {
  const fr = source('lib/i18n/fr.ts');
  assert.match(fr, /'stock\.available': 'disponible'/);
  assert.match(fr, /'stock\.availablePlural': 'disponibles'/);
  assert.match(ROW, /row\.available > 1 \? 'stock\.availablePlural' : 'stock\.available'/);
});

/* ── layout direction and the tab bar ────────────────────────────────────── */

it('lays Arabic out right-to-left on web as well as native', () => {
  const dir = source('lib/design/layout-direction.ts');
  assert.match(dir, /document\.documentElement\.dir = rtl \? 'rtl' : 'ltr'/);
  assert.match(dir, /Platform\.OS === 'web' \? webRtl : I18nManager\.isRTL/);
  const i18n = source('lib/i18n/index.ts');
  assert.match(i18n, /applyWebDirection\(isRtlLanguage\(lang\), lang\)/);
  // Native keeps the restart behaviour.
  assert.match(i18n, /I18nManager\.forceRTL\(wantsRtl\)/);
  // Nothing reads the web stub's isRTL directly.
  for (const f of ['lib/design/direction.ts', 'components/ui/Stepper.tsx']) {
    assert.ok(!/I18nManager\.isRTL\b/.test(withoutComments(source(f))), `${f} reads I18nManager.isRTL`);
  }
});

it('sizes the tab bar from the safe area instead of a fixed height', () => {
  const tabs = withoutComments(source('app/(tabs)/_layout.tsx'));
  assert.match(tabs, /height: TAB_BAR_CONTENT \+ insets\.bottom/);
  assert.match(tabs, /paddingBottom: TAB_BAR_PADDING \+ insets\.bottom/);
  assert.ok(!/height: 60,/.test(tabs));
});

console.log(`stock screen: ${passed} passed`);
