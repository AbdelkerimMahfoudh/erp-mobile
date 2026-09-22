/**
 * Three ways to find the phone, one selection: scan, typed IMEI and the shelf
 * all end in the same server lookup and the same payment flow, and none of
 * them creates stock.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  availabilityKey,
  identifierProblem,
  lookupFailure,
  manualImeiProblem,
  normalizeImeiInput,
  sourceKey,
} from './phone-selection-rules.ts';

// Resolve against this file's URL — `__dirname` does not exist under the ESM
// type-stripping the pure suites run on.
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const QUICK_SELL = read('app/quick-sell.tsx');
const PICKER = read('components/sell/PhonePicker.tsx');
const LIB = read('lib/phone-selection.ts');

it('typed IMEI: only presentation characters are removed', () => {
  assert.equal(normalizeImeiInput(' 49 0154-2032.37518 '), '490154203237518');
});

it('a serial number is sent whole — its dashes are part of it', () => {
  // The live defect: the shelf sent CAN-1662030-0019 as CAN16620300019, and no
  // unit carries that, so "Continue" on any serial-tracked item found nothing.
  assert.equal(normalizeImeiInput('CAN-1662030-0019'), 'CAN-1662030-0019');
  assert.equal(normalizeImeiInput('  SN-AB12 '), 'SN-AB12');
  assert.equal(normalizeImeiInput('6901234567890'), '6901234567890');
});

it('typed IMEI: empty, letters, length and checksum each have their own message', () => {
  assert.equal(manualImeiProblem(''), 'empty');
  assert.equal(manualImeiProblem('49015420323751O'), 'not_digits');
  assert.equal(manualImeiProblem('49015420323751'), 'length');
  assert.equal(manualImeiProblem('490154203237519'), 'checksum');
  assert.equal(manualImeiProblem('490154203237518'), null);
});

it('a typed identifier accepts a serial or barcode, and refuses only empty or a bad 15-digit IMEI', () => {
  assert.equal(identifierProblem(''), 'empty');
  // A serial (letters) and a barcode (13 or other-length digits) are looked up.
  assert.equal(identifierProblem('C02XK1ABJHD5'), null);
  assert.equal(identifierProblem('6901234567890'), null);
  assert.equal(identifierProblem('49015420323751'), null);
  // A 15-digit number with a bad checksum is a mistyped IMEI, never a barcode.
  assert.equal(identifierProblem('490154203237519'), 'checksum');
  assert.equal(identifierProblem('490154203237518'), null);
});

it('lookup failures map to plain outcomes, network apart', () => {
  assert.equal(lookupFailure(400, 'imei_checksum'), 'invalid');
  assert.equal(lookupFailure(404), 'not_found');
  assert.equal(lookupFailure(404, 'not_available_here'), 'not_here');
  assert.equal(lookupFailure(403), 'forbidden');
  assert.equal(lookupFailure(0), 'network');
  assert.equal(lookupFailure(500), 'server');
});

it('every availability and source has words', () => {
  for (const a of ['available', 'sold', 'faulty', 'reserved', 'other_branch', 'unavailable'] as const) {
    assert.equal(availabilityKey(a), `pick.availability.${a}`);
  }
  for (const s of ['scan', 'manual', 'stock'] as const) assert.equal(sourceKey(s), `pick.source.${s}`);
});

it('all three ways end in the one server lookup and one choose()', () => {
  assert.ok(LIB.includes('/sales/selection/'));
  assert.ok(QUICK_SELL.includes("findAndChoose(result.code, 'scan')"));
  assert.ok(QUICK_SELL.includes('<ManualImeiPanel'));
  assert.ok(QUICK_SELL.includes('<StockPicker'));
  assert.ok(PICKER.includes('lookupSelection('));
});

it('the scanner is reused, and payment is the existing sheet', () => {
  assert.ok(QUICK_SELL.includes('ScanTarget'));
  assert.ok(QUICK_SELL.includes('PaymentSheet'));
  assert.ok(QUICK_SELL.includes("t('pick.continue')"));
});

it('finding a phone never creates stock or writes a barcode', () => {
  for (const src of [QUICK_SELL, PICKER, LIB]) {
    assert.doesNotMatch(src, /\bpost\(\s*['`]\/(units|products|inventory)/);
    assert.doesNotMatch(src, /barcode\s*:/);
  }
});

it('EN, FR and AR carry every pick key', () => {
  const keys = (read('lib/i18n/en.ts').match(/'pick\.[^']+'/g) ?? []);
  assert.ok(keys.length >= 40);
  for (const lang of ['fr', 'ar']) {
    const src = read(`lib/i18n/${lang}.ts`);
    for (const k of keys) assert.ok(src.includes(`${k}:`), `${lang} lacks ${k}`);
  }
});

it('the picker uses tokens, not raw colours', () => {
  assert.doesNotMatch(PICKER, /#[0-9a-fA-F]{3,6}\b/);
});

it('another branch is named only when the server sent it', () => {
  // The app never infers another branch: it shows a name only when the server
  // (branch.manage) included one, and otherwise the server's generic answer.
  assert.ok(PICKER.includes('selection.otherBranch'));
  assert.doesNotMatch(PICKER + QUICK_SELL, /usePermission('branch.manage')/);
  assert.ok(read('lib/i18n/en.ts').includes("'pick.failure.not_here': 'This item is not available in this branch.'"));
});

it('a counted product is sold by id and a quantity; a serialized unit by its identifier', () => {
  // The one lookup returns a kind; the checkout sends the right line for each
  // through the one rule in `sale-submission`, which is proved on its own.
  assert.ok(QUICK_SELL.includes('saleLineFor(picked.selection, identifier, quantity, proposedPrice)'));
  // No quantity is ever hard-coded: a counted product sells how many was chosen.
  assert.doesNotMatch(QUICK_SELL, /quantity:\s*1\b/);
  assert.ok(QUICK_SELL.includes('<Stepper'));
});

it('Sell an item: three ways on one surface, each a row with an icon, words and a chevron — no pictures', () => {
  const chooser = PICKER.slice(PICKER.indexOf('export function PhoneChooser'), PICKER.indexOf('export function ManualImeiPanel'));
  assert.equal((chooser.match(/<RowGroup>/g) ?? []).length, 1, 'one section');
  assert.ok(chooser.includes('<ListRow key={way.mode} flat leading={way.icon} title={way.title} subtitle={way.hint} onPress='), 'rows are the design system row: icon, title, hint, chevron');
  assert.equal((chooser.match(/mode: '(scan|manual|stock)'/g) ?? []).length, 3);
  assert.doesNotMatch(PICKER, /Thumbnail|<Image|placeholder\.png/, 'no product pictures or placeholders');
  assert.doesNotMatch(chooser, /<Card/, 'no card nested in the section');
  // The one action under the section, for several items: outlined and full width.
  const under = QUICK_SELL.slice(QUICK_SELL.indexOf('<PhoneChooser'), QUICK_SELL.indexOf("mode === 'scan' ?"));
  assert.match(under, /variant="secondary"[\s\S]{0,60}fullWidth/, 'a restrained outlined full-width action');
});

it('Choose from stock: one search row with the filter, one virtualized paginated list, the control in a trailing column', () => {
  const picker = PICKER.slice(PICKER.indexOf('export function StockPicker'), PICKER.indexOf('function StockFilterSheet'));
  assert.match(picker, /<FlatList/, 'a virtualized list');
  assert.match(picker, /onEndReached=\{loadMore\}/, 'the next page loads as the end comes into view');
  assert.match(picker, /style=\{styles\.searchRow\}[\s\S]{0,400}<SearchInput[\s\S]{0,300}<Button/, 'search and Filter share one row');
  assert.doesNotMatch(picker, /flexWrap|<FilterChip/, 'no wall of wrapping chips on the picker itself');
  assert.match(picker, /placeholder=\{t\('pick\.stock\.search'\)\}/);
  assert.ok(read('lib/i18n/en.ts').includes("'pick.stock.search': 'Name or identifier'"));
  const row = PICKER.slice(PICKER.indexOf('const StockOption = React.memo'), PICKER.indexOf('export function SelectedPhoneCard'));
  assert.match(row, /<View style=\{styles\.trailing\}>[\s\S]*styles\.radio/, 'the selection control lives in the trailing column');
  assert.match(row, /trackingLabelKey\(tracking\)/, 'the identifier is labelled by its tracking type');
  assert.doesNotMatch(row, /Available|pick\.chip/, 'no redundant Available badge on every row');
  // The shelf is the screen's own scroller in stock mode — never a list inside the scroll view.
  assert.match(QUICK_SELL, /mode === 'stock' \? \(\s*<StockPicker/);
  assert.match(QUICK_SELL, /disabled=\{!stockPick \|\| lookingUp\}/, 'Continue is enabled only for a valid selection');
  assert.match(QUICK_SELL, /t\('pick\.stock\.selected', \{ name: stockPick\.label \}\)/, 'the selected item is named above the button');
});

it('the shelf never answers Continue with silence: a lookup failure is shown where the button is', () => {
  const start = QUICK_SELL.indexOf('footer={');
  const footer = QUICK_SELL.slice(start, QUICK_SELL.indexOf('<Stack.Screen', start));
  assert.ok(footer.includes("mode === 'stock'"));
  assert.ok(footer.includes('{lookupNotice}'), 'the failure notice is in the footer, with the button');
  assert.match(QUICK_SELL, /const lookupNotice = lookupError \? \(/, 'and it is the lookup failure, in words');
  assert.ok(footer.includes('loading={lookingUp}'));
});
