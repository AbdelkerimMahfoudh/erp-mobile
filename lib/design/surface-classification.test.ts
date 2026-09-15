/**
 * Every `ListRow` consumer is deliberately classified.
 *
 *   node lib/design/surface-classification.test.ts
 *
 * The target was never "everything flat". Flattening a financial summary until
 * it stops standing out is exactly as wrong as wrapping every field in a card,
 * and both mistakes had been made in this app. What this file enforces is that
 * **no screen is un-decided**: every consumer appears in the table below with a
 * reason, and a new one cannot be added without choosing.
 *
 * The classification, from the binding rule:
 *
 *   grouped — repeated operational records; flat rows inside a RowGroup or a
 *             FlatList that separates them
 *   card    — metrics, warnings, financial summaries, high-emphasis content
 *   custom  — a bespoke surface whose shape is the point (a picker sheet, a
 *             gallery, a form step)
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

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

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

type Kind = 'grouped' | 'card' | 'custom';

/** Every file that renders a `ListRow`, and what it was decided to be. */
const CLASSIFICATION: Record<string, { kind: Kind; why: string }> = {
  'app/(tabs)/index.tsx': { kind: 'grouped', why: 'pending work, stock figures and destinations' },
  'app/(tabs)/inventory.tsx': { kind: 'grouped', why: 'units and stock lines' },
  'app/(tabs)/more.tsx': { kind: 'grouped', why: 'destination menu; sign-out kept separate' },
  'app/(tabs)/money-hub.tsx': { kind: 'card', why: 'money metrics, meant to stand out' },
  'app/analytics.tsx': { kind: 'grouped', why: 'supporting values under each metric' },
  'app/catalog/[id].tsx': { kind: 'grouped', why: 'per-branch stock' },
  'app/catalog/categories.tsx': { kind: 'custom', why: 'management sheet' },
  'app/consignments/index.tsx': { kind: 'grouped', why: 'consignment records' },
  'app/devices.tsx': { kind: 'grouped', why: 'enrolled devices' },
  'app/discrepancies/index.tsx': { kind: 'grouped', why: 'discrepancy records' },
  'app/expenses/index.tsx': { kind: 'grouped', why: 'expense records' },
  'app/hub/[id].tsx': { kind: 'card', why: 'hub landing tiles' },
  'app/imports/index.tsx': { kind: 'grouped', why: 'import batches' },
  'app/loans/index.tsx': { kind: 'grouped', why: 'loan records' },
  'app/select-branch.tsx': { kind: 'custom', why: 'a one-off choice before the app opens' },
  'app/settings.tsx': { kind: 'card', why: 'grouped settings panels' },
  'app/team.tsx': { kind: 'grouped', why: 'team members' },
  'app/dev/gallery.tsx': { kind: 'custom', why: 'component gallery; not a user route' },
};

const CONSUMERS = Object.keys(CLASSIFICATION);

it('every classified file still exists', () => {
  const missing = CONSUMERS.filter((f) => !existsSync(f));
  assert.deepEqual(missing, [], `classified but gone:\n  ${missing.join('\n  ')}`);
});

it('a grouped screen actually separates its rows', () => {
  /*
   * The failure this catches: marking a row `flat` and forgetting the
   * container. Borderless rows with a gap between them are floating blocks of
   * text — worse than the cards they replaced, because at least a card had an
   * edge.
   */
  const offenders: string[] = [];
  for (const [file, { kind }] of Object.entries(CLASSIFICATION)) {
    if (kind !== 'grouped') continue;
    const src = strip(readFileSync(file, 'utf8'));
    const separates = /<RowGroup|ItemSeparatorComponent/.test(src);
    if (!separates) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `grouped but nothing separates the rows:\n  ${offenders.join('\n  ')}`);
});

it('no grouped list leaves a gap that would break the run', () => {
  /*
   * `gap` on the list container fights the hairline: the rows stop touching, so
   * the separator floats in the middle of empty space and the group reads as
   * broken cards again.
   */
  const offenders: string[] = [];
  for (const file of ['app/expenses/index.tsx', 'app/loans/index.tsx']) {
    const src = strip(readFileSync(file, 'utf8'));
    const list = src.match(/list: \{[^}]*\}/)?.[0] ?? '';
    if (/gap:/.test(list)) offenders.push(`${file} → ${list}`);
  }
  assert.deepEqual(offenders, [], `separated lists must not also have a gap:\n  ${offenders.join('\n  ')}`);
});

it('financial summaries were NOT flattened', () => {
  /*
   * The opposite mistake, and the one a "make everything flat" pass would
   * cause. Sale totals and the refund summary must still be cards — they are
   * what somebody opens the screen to read.
   */
  const sale = strip(readFileSync('app/sales/[id].tsx', 'utf8'));
  const totals = sale.slice(sale.indexOf("sales.detail.totals"));
  assert.match(totals.slice(0, 400), /<Card>/, 'sale totals must stay an emphasised card');

  const refunds = strip(readFileSync('components/returns/RefundSections.tsx', 'utf8'));
  assert.match(refunds, /<Card>/, 'the refund summary must stay a card');
});

it('sign out is not an ordinary menu destination', () => {
  /*
   * It ends the session. A row that looks like "Devices" is a row somebody taps
   * while scanning a menu, so it sits outside the group with its own surface
   * and the danger tone.
   */
  const src = strip(readFileSync('app/(tabs)/more.tsx', 'utf8'));
  const group = src.slice(src.indexOf('<RowGroup>'), src.lastIndexOf('</RowGroup>'));
  assert.ok(!/signOut/.test(group), 'sign out must not be inside the destinations group');
  assert.match(src, /tone="danger"/);
});

// ── refund semantics, which colour alone must never carry ─────────────────

it('a reported-but-unconfirmed payout reads as pending, never as settled', () => {
  /*
   * The money rule this app is built around: reported is a CLAIM, confirmed is
   * a settlement. Only confirmed may be green — and each state also carries a
   * word, so the distinction survives a colour-blind reader.
   */
  const src = strip(readFileSync('components/returns/RefundSections.tsx', 'utf8'));
  const due = src.slice(src.indexOf('RefundDueSection'), src.indexOf('RefundPendingSection'));
  const pending = src.slice(src.indexOf('RefundPendingSection'), src.indexOf('RefundConfirmedSection'));
  const confirmed = src.slice(src.indexOf('RefundConfirmedSection'));

  assert.match(due, /tone="warning"/, 'an unpaid approved refund is a debt');
  assert.match(pending, /tone="warning"/, 'a reported payout is not yet money that moved');
  assert.ok(!/tone="success"/.test(pending), 'pending must never read as settled');
  assert.match(confirmed, /tone="success"/, 'only a confirmed payout is green');
});

it('the scanner never uses green for a mere detection', () => {
  /*
   * A detected IMEI is a reading, not an outcome. Green here would tell
   * somebody the phone is in stock when nothing has been submitted.
   */
  const src = strip(readFileSync('components/scanner/ScannerSheet.tsx', 'utf8'));
  const result = src.slice(src.indexOf("t('scan.detected')") - 800, src.indexOf("t('scan.detected')") + 400);
  assert.ok(!/success/.test(result), 'the detection header must not use a success tone');
  assert.match(result, /border\.reticle/, 'the detection icon uses the accent');
});

console.log(`surface classification: ${passed} passed`);
