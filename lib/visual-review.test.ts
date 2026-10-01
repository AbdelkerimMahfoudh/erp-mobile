/**
 * What the visual review of 2026-10-01 found wrong on screen, pinned so it stays fixed (docs/66).
 *
 *   node lib/visual-review.test.ts
 *
 * Every screen of the web export was opened as the Owner, a Manager and an Employee, in English,
 * French and Arabic, and looked at. These are the defects that review fixed. The screens need the
 * native modules, so — like `branch-restore.test.ts` — each rule is read from the source.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';

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
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
const catalogues = { en, fr, ar } as Record<string, Record<string, string>>;

it('a placeholder is single-braced, and every language fills the same ones', () => {
  // "Because it is filed under {{category}}" showed "{Accessories}" on Edit product.
  const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');
  for (const [lang, catalogue] of Object.entries(catalogues)) {
    for (const [key, value] of Object.entries(catalogue)) {
      assert.ok(!value.includes('{{'), `${lang} ${key} has a double brace`);
      assert.equal(placeholders(value), placeholders(en[key as keyof typeof en]), `${lang} ${key} fills other placeholders than English`);
    }
  }
});

it('one is never "1 items", "1 lines", "1 phones" or "the 1 days before"', () => {
  for (const key of ['sales.items.one', 'sales.itemsInOneLine', 'salesPeriod.phones.one', 'salesPeriod.dayLine.one', 'goals.hint.running.one', 'goals.hint.notStarted.one']) {
    for (const [lang, catalogue] of Object.entries(catalogues)) assert.ok(catalogue[key], `${lang} lacks ${key}`);
  }
  const sales = code('app/sales/index.tsx');
  assert.match(sales, /row\.itemCount === 1\s*\?\s*t\('sales\.items\.one'\)/);
  assert.match(sales, /row\.lineCount === 1\s*\?\s*t\('sales\.itemsInOneLine'/);
  const period = code('app/sales/period.tsx');
  assert.match(period, /phonesSold === 1\s*\?\s*t\('salesPeriod\.phones\.one'\)/);
  assert.match(period, /day\.phones === 1 \? t\('salesPeriod\.dayLine\.one'\)/);
  const goals = code('app/goals/index.tsx');
  assert.match(goals, /daysRemaining === 1\s*\?\s*t\('goals\.hint\.running\.one'/);
  assert.match(goals, /daysTotal === 1\s*\?\s*t\('goals\.hint\.notStarted\.one'\)/);
  // Every Home period ends today: a one-day comparison is "vs yesterday" (the 1st of the month).
  assert.match(code('app/(tabs)/index.tsx'), /period === 'today' \|\| compareDays === 1\s*\?\s*t\('home\.compare\.yesterday'/);
});

it('a target says its daily figure as money or a count, and its dates in words', () => {
  const goals = code('app/goals/index.tsx');
  assert.match(goals, /goal\.isMoney \? formatMoney\(perDay\) : formatNumber\(perDay/);
  assert.doesNotMatch(goals, /needed: String\(/, 'the bare "10675 a day"');
  assert.match(goals, /formatDayRange\(goal\.periodStart, goal\.periodEnd\)/);
  assert.match(code('app/goals/new.tsx'), /from: formatDate\(month\.periodStart\), to: formatDate\(month\.periodEnd\)/);
});

it('choosing Custom opens the hours field and changes nothing — never a silent "No returns"', () => {
  const settings = code('app/settings.tsx');
  const preset = settings.slice(settings.indexOf('const onReturnPreset'), settings.indexOf('const onCustomHours'));
  const custom = preset.slice(preset.indexOf("if (value === 'custom')"), preset.indexOf('return;'));
  assert.match(custom, /setCustomMode\(true\)/);
  assert.doesNotMatch(custom, /setDraft/, 'choosing Custom wrote a return window');
  assert.match(settings, /const returnSegment = customMode \|\| !RETURN_PRESETS\.includes/);
});

it('pinned buttons reserve their measured height, so the end of the page can be read', () => {
  for (const file of ['app/returns/[id].tsx', 'app/returns/new.tsx']) {
    const src = code(file);
    assert.match(src, /style=\{styles\.actions\} onLayout=\{measureActions\}/, file);
    assert.match(src, /paddingBottom: space\['5xl'\] \+ (\(showsActions \? actionsHeight : 0\)|actionsHeight)/, file);
    assert.doesNotMatch(src, /content: \{[^}]*paddingBottom/, `${file} still pads by a constant`);
  }
  const detail = code('app/returns/[id].tsx');
  assert.equal((detail.match(/<View style=\{styles\.actions\} onLayout=\{measureActions\}>/g) ?? []).length, 4, 'every action group is measured');
});

it('a sale fact keeps its own width beside the label, never a quarter of the row (docs/61 §8)', () => {
  const sale = code('app/sales/[id].tsx');
  assert.match(sale, /factValue: \{ flexShrink: 1, minWidth: 0 \}/);
  assert.doesNotMatch(sale, /factValue: \{ flex: 1/);
});

it('a difference: the channel in words, the date in words, each decision readable in full', () => {
  const detail = code('app/discrepancies/[id].tsx');
  assert.doesNotMatch(detail, /SegmentedControl/, '"A record was …" was cut in every language');
  assert.match(detail, /allowedResolutions\(d\.kind\)\.map\(\(r\) => \(\s*<ListRow/);
  assert.match(detail, /channelLabel\(d\.channel,/);
  assert.doesNotMatch(detail, /d\.channel\.label/, 'CASH is a key for the app to word');
  assert.match(detail, /date: formatDate\(d\.date\)/);
  const list = code('app/discrepancies/index.tsx');
  assert.match(list, /channelLabel\(row\.channel,/);
  assert.match(list, /formatDate\(row\.date\)/);
});

it('no empty "What you can do" card when the move is the other store\'s', () => {
  const consignment = code('app/consignments/[id].tsx');
  const actions = consignment.slice(consignment.indexOf('function Actions('));
  assert.match(actions, /if \(\s*!\(showNegotiate \|\| [^)]*\)\s*\) \{\s*return null;\s*\}/);
});

it('a debt never offers what the server refuses: agreeing to or countering your own offer, disputing twice', () => {
  const loan = code('app/loans/[id].tsx');
  assert.match(loan, /const mayAnswer = !loan\.ownOffer;/);
  assert.match(loan, /const mayDispute = loan\.status !== 'disputed';/);
  assert.match(loan, /\{mayAnswer \? \(\s*<>\s*<MoneyField label=\{t\('loans\.counterAmount'\)\}/);
  assert.match(loan, /t\('loans\.ownOffer', \{ name: loan\.otherParty \}\)/);
  assert.match(code('lib/loans.ts'), /ownOffer\?: boolean;/);
});

it('retired roles are worded, never shown as a key', () => {
  const team = code('app/team.tsx');
  for (const role of ['branch_manager', 'sales_employee', 'warehouse_employee']) {
    assert.match(team, new RegExp(`case '${role}':\\s*return t\\('team\\.role\\.${role}'\\);`));
    for (const [lang, catalogue] of Object.entries(catalogues)) assert.ok(catalogue[`team.role.${role}`], `${lang} lacks team.role.${role}`);
  }
});

it('an open shop that lands on the refusal screen is sent into the app, not told its subscription ended', () => {
  assert.match(code('app/subscription-blocked.tsx'), /if \(entitlement\?\.canRead && entitlement\.canWrite\) return <Redirect href="\/" \/>;/);
});

console.log(`visual review: ${passed} passed`);
