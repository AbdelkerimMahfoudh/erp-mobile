/**
 * The category decides the product form — proved without a screen (D223, 2026-10-28).
 *
 *   node lib/intake-form.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  builtinKeyOf,
  catalogueCovers,
  categoryFits,
  fieldsFor,
  modesFor,
  restrictionForScan,
  specificationsPayload,
  startingMode,
  withCategory,
  type FormCategory,
} from './intake-form.ts';
import { parseBuyingCost } from './missing-cost-parse.ts';

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
const withoutComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const PHONES: FormCategory = { id: 'p', key: 'phones.smartphones', defaultTrackingType: 'imei', allowedTrackingTypes: ['imei'], attributeSchema: [{ key: 'storage', label: 'Storage', type: 'measurement' }, { key: 'color', label: 'Colour', type: 'text' }] };
const TABLETS: FormCategory = { id: 't', key: 'tablets.wifi', defaultTrackingType: 'serial', allowedTrackingTypes: ['serial', 'quantity'], attributeSchema: [{ key: 'storage', label: 'Storage', type: 'measurement' }, { key: 'color', label: 'Colour', type: 'text' }] };
const LAPTOPS: FormCategory = { id: 'l', key: 'computers.laptops', defaultTrackingType: 'serial', allowedTrackingTypes: ['serial', 'quantity'], attributeSchema: [{ key: 'processor', label: 'Processor', type: 'text' }, { key: 'ram', label: 'RAM', type: 'measurement', unit: 'GB' }, { key: 'storage', label: 'Storage', type: 'measurement' }] };
const AUDIO: FormCategory = { id: 'a', key: 'audio', defaultTrackingType: 'quantity', allowedTrackingTypes: ['serial', 'quantity'], attributeSchema: [{ key: 'color', label: 'Colour', type: 'text' }] };
const CABLES: FormCategory = { id: 'c', key: 'cables', defaultTrackingType: 'quantity', allowedTrackingTypes: ['quantity'], attributeSchema: [{ key: 'length', label: 'Length', type: 'measurement', unit: 'm' }] };
const OWN_UNDER_PHONES: FormCategory = { id: 'o', key: null, parentId: 'phones-root', defaultTrackingType: 'imei', attributeSchema: [] };
const PHONES_ROOT: FormCategory = { id: 'phones-root', key: 'phones', defaultTrackingType: 'imei', allowedTrackingTypes: ['imei'] };
const ALL = [PHONES, TABLETS, LAPTOPS, AUDIO, CABLES, OWN_UNDER_PHONES, PHONES_ROOT];

it('no category means no catalogue, no storage, no colour, no attribute', () => {
  assert.deepEqual(fieldsFor(null), { storage: false, colour: false, others: [] });
  assert.equal(catalogueCovers(null), false);
});

it('the phone catalogue only under Phones — never Tablets, Laptops or Audio, whatever the brand', () => {
  assert.equal(catalogueCovers(builtinKeyOf(PHONES, ALL)), true);
  assert.equal(catalogueCovers(builtinKeyOf(OWN_UNDER_PHONES, ALL)), true, "a shop's own subcategory of Phones");
  for (const c of [TABLETS, LAPTOPS, AUDIO, CABLES]) assert.equal(catalogueCovers(builtinKeyOf(c, ALL)), false, c.key!);
});

it('storage and colour only where the category asks them; laptops get processor and RAM', () => {
  assert.deepEqual([fieldsFor(PHONES).storage, fieldsFor(PHONES).colour], [true, true]);
  assert.deepEqual([fieldsFor(AUDIO).storage, fieldsFor(AUDIO).colour], [false, true]);
  assert.deepEqual([fieldsFor(CABLES).storage, fieldsFor(CABLES).colour], [false, false]);
  assert.deepEqual(fieldsFor(LAPTOPS).others.map((a) => a.key), ['processor', 'ram']);
});

it('the category suggests the mode; a scan narrows it; a mode is never decided by the brand', () => {
  assert.equal(startingMode(LAPTOPS, null), 'serial');
  assert.deepEqual(modesFor(LAPTOPS, null), ['serial', 'quantity']);
  assert.deepEqual(modesFor(LAPTOPS, restrictionForScan('serial')), ['serial']);
  assert.equal(startingMode(AUDIO, restrictionForScan('barcode')), 'quantity');
  assert.equal(categoryFits(PHONES, restrictionForScan('serial')), false, 'a serial cannot become a phone');
  assert.equal(categoryFits(CABLES, restrictionForScan('imei')), false, 'an IMEI is never a cable');
});

it('changing the category clears brand, model, storage, colour, attributes and the mode', () => {
  const before = { brand: 'Apple', model: 'iPhone 18 Pro Max', variant: '1 TB · Silver', categoryId: 'p', trackingType: 'imei' as const, specifications: { x: '1' }, barcode: '' };
  const after = withCategory(before, LAPTOPS, null);
  assert.deepEqual(
    { brand: after.brand, model: after.model, variant: after.variant, specifications: after.specifications, trackingType: after.trackingType, categoryId: after.categoryId },
    { brand: '', model: '', variant: '', specifications: {}, trackingType: 'serial', categoryId: 'l' },
  );
  assert.equal(withCategory(after, LAPTOPS, null), after, 'choosing the same category again changes nothing');
});

it('attributes are sent typed, only the category’s own and only when filled', () => {
  assert.deepEqual(specificationsPayload(fieldsFor(LAPTOPS).others, { processor: ' Core i5 ', ram: '16', stray: 'x' }), { processor: 'Core i5', ram: 16 });
  assert.equal(specificationsPayload(fieldsFor(LAPTOPS).others, { processor: '' }), undefined);
});

it('a buying cost is a positive amount, nothing typed is unknown — never zero', () => {
  assert.equal(parseBuyingCost(''), null);
  assert.equal(parseBuyingCost('  '), null);
  assert.equal(parseBuyingCost('0'), 'invalid');
  assert.equal(parseBuyingCost('-3'), 'invalid');
  assert.equal(parseBuyingCost('abc'), 'invalid');
  assert.equal(parseBuyingCost('12,5'), 12.5);
  assert.equal(parseBuyingCost('25000'), 25000);
});

/* ── the screens keep these promises ──────────────────────────────────── */

it('the freeze: a deliberate exit is allowed BEFORE navigating, and the guard lets it through without a dialog', () => {
  const form = withoutComments(source('components/catalog/ProductForm.tsx'));
  assert.match(form, /if \(allowLeaveRef\?\.current\) \{\s*navigation\.dispatch\(data\.action\);\s*return;\s*\}/);
  assert.match(form, /if \(asking\.current\) return;/, 'only one confirm at a time');
  const screen = withoutComments(source('app/catalog/new.tsx'));
  assert.match(screen, /leaving\.current = true;\s*if \(router\.canGoBack\(\)\) router\.back\(\);/);
  // The old order — clear the busy flag, then navigate — is gone.
  assert.doesNotMatch(screen, /setHandingBack\(false\);\s*\}\s*if \(router\.canGoBack\(\)\)/);
});

it('no selling price in any intake form, and none sent by intake', () => {
  for (const file of ['components/catalog/ProductForm.tsx', 'components/receive/ReceiveItemSheet.tsx', 'app/quick-receive.tsx', 'app/catalog/new.tsx', 'app/receive.tsx']) {
    const code = withoutComments(source(file));
    assert.doesNotMatch(code, /defaultPrice|'catalog\.form\.price|'receive\.price/, file);
  }
  assert.doesNotMatch(withoutComments(source('lib/receive-outcome.ts')), /price:/);
});

it('the missing-cost question is the one shared native dialog, three answers, never stacked', () => {
  const ask = withoutComments(source('lib/missing-cost.ts'));
  assert.match(ask, /if \(asking\) return 'cancel';/);
  assert.match(ask, /choices: \[t\('cost\.missing\.add'\), t\('cost\.missing\.continue'\)\]/);
  for (const file of ['app/catalog/new.tsx', 'app/quick-receive.tsx', 'components/receive/ReceiveItemSheet.tsx']) {
    assert.match(withoutComments(source(file)), /askMissingCost\(\)/, file);
  }
});

it('the copy exists in all three languages, word for word as agreed', () => {
  const en = source('lib/i18n/en.ts');
  const fr = source('lib/i18n/fr.ts');
  const ar = source('lib/i18n/ar.ts');
  assert.match(en, /'cost\.missing\.title': 'Buying cost is missing'/);
  assert.match(fr, /'cost\.missing\.title': 'Le coût d’achat manque'/);
  assert.match(ar, /'cost\.missing\.title': 'تكلفة الشراء غير مُدخلة'/);
  assert.match(en, /'cost\.missing\.continue': 'Continue without cost'/);
  assert.match(fr, /'cost\.missing\.add': 'Ajouter le coût'/);
  assert.match(ar, /'cost\.missing\.continue': 'المتابعة دون تكلفة'/);
  for (const [lang, file] of [['en', en], ['fr', fr], ['ar', ar]] as const) {
    assert.doesNotMatch(file, /'quick\.receive\.title': '(Receive a phone|Réceptionner un téléphone|استلام هاتف)'/, lang);
  }
});

it('a visit that typed nothing leaves no draft, so no "Restored" card over an empty screen', () => {
  const screen = withoutComments(source('app/quick-receive.tsx'));
  assert.match(screen, /persist: Boolean\(cost\.trim\(\) \|\| imei2\.trim\(\) \|\| uncertain\)/);
  assert.match(screen, /\{restoredTyped \? <DraftNotice/);
  const hook = withoutComments(source('lib/offline/use-draft.ts'));
  assert.match(hook, /if \(!persist\) \{\s*if \(lastWritten\.current !== null\) \{\s*clearDraft\(form, scope, recordId\);/);
});

console.log(`intake form: ${passed} passed`);
