/**
 * The variant selectors, and the tracking question they sit next to.
 *
 *   node lib/variant.test.ts
 *
 * Two promises are pinned here:
 *
 *   1. **No value a shop ever typed is lost.** The field was free text for
 *      years, and every one of those values must still open, still show, and
 *      still save.
 *   2. **A phone is never counted as a quantity.** "12 iPhone 15" with no IMEIs
 *      cannot be sold to a named handset, warranted or traced, and the loss is
 *      silent.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_VARIANT, OTHER_KEY, composeVariant, parseVariant } from './variant.ts';
import { isPhoneBrand } from './phone-product.ts';

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

/** The server's lists, as the client receives them. */
const STORAGE = [
  { key: '4gb', label: '4 GB' },
  { key: '8gb', label: '8 GB' },
  { key: '16gb', label: '16 GB' },
  { key: '32gb', label: '32 GB' },
  { key: '64gb', label: '64 GB' },
  { key: '128gb', label: '128 GB' },
  { key: '256gb', label: '256 GB' },
  { key: '512gb', label: '512 GB' },
  { key: '1tb', label: '1 TB' },
  { key: '2tb', label: '2 TB' },
  { key: 'other', label: 'Other' },
];
const COLOUR = [
  { key: 'black', label: 'Black' },
  { key: 'white', label: 'White' },
  { key: 'gray', label: 'Gray' },
  { key: 'silver', label: 'Silver' },
  { key: 'gold', label: 'Gold' },
  { key: 'rose_gold', label: 'Rose Gold' },
  { key: 'blue', label: 'Blue' },
  { key: 'green', label: 'Green' },
  { key: 'red', label: 'Red' },
  { key: 'purple', label: 'Purple' },
  { key: 'pink', label: 'Pink' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'orange', label: 'Orange' },
  { key: 'brown', label: 'Brown' },
  { key: 'beige', label: 'Beige' },
  { key: 'other', label: 'Other' },
];

const parse = (v: string | null) => parseVariant(v, STORAGE, COLOUR);
const compose = (p: Parameters<typeof composeVariant>[0]) => composeVariant(p, STORAGE, COLOUR);

// ── the option lists ──────────────────────────────────────────────────────

it('the lists come from the server, never from a list in the app', () => {
  /*
   * The one rule that keeps there being ONE catalogue. A bundled copy is a
   * second list that cannot be corrected without shipping a release, sitting
   * next to one that can.
   */
  const code = withoutComments(source('components/catalog/VariantSelect.tsx'));
  assert.match(code, /fetchAttributes\(\)/);
  // No hard-coded capacities or colour names anywhere in the component.
  for (const literal of ['128 GB', '256 GB', 'Rose Gold', 'Beige']) {
    assert.ok(!code.includes(literal), `the component must not carry ${literal}`);
  }
  assert.match(withoutComments(source('lib/variant.ts')), /import type \{ AttributeOption \}/);
});

it('Other is always available in both lists', () => {
  for (const list of [STORAGE, COLOUR]) {
    assert.equal(list[list.length - 1].key, OTHER_KEY);
  }
  // And the component reveals a field for it rather than dead-ending.
  const code = withoutComments(source('components/catalog/VariantSelect.tsx'));
  assert.match(code, /parts\.storageKey === OTHER_KEY/);
  assert.match(code, /parts\.colourKey === OTHER_KEY/);
});

it('offers no market or region list', () => {
  /*
   * The audit finding, pinned so nobody adds one back by intuition:
   * `products.variant` records storage and colour — `schema.prisma` says so —
   * and a region would add a fourth term to the (company, brand, model,
   * variant) unique key, making a product row per market.
   */
  const code = source('components/catalog/VariantSelect.tsx') + source('lib/variant.ts');
  for (const region of ['Middle East', 'Hong Kong', 'South Korea', 'International']) {
    assert.ok(!code.includes(region), `variant is not a region: ${region}`);
  }
});

it('never offers a model suffix — those come from the model name', () => {
  const labels = [...STORAGE, ...COLOUR].map((o) => o.label.toLowerCase());
  for (const suffix of ['pro', 'plus', 'ultra', 'max', 'mini']) {
    assert.ok(!labels.includes(suffix));
  }
});

// ── reading and writing the stored value ──────────────────────────────────

it('round-trips a value it wrote', () => {
  const parts = parse('256 GB · Black');
  assert.equal(parts.storageKey, '256gb');
  assert.equal(parts.colourKey, 'black');
  assert.equal(compose(parts), '256 GB · Black');
});

it('recognises the spellings the free-text years produced', () => {
  for (const written of ['128GB', '128 gb', '128 Go', '128g', '128']) {
    assert.equal(parse(written).storageKey, '128gb', written);
  }
  assert.equal(parse('Grey').colourKey, 'gray');
  assert.equal(parse('rose-gold').colourKey, 'rose_gold');
});

it('accepts the separators people actually used', () => {
  for (const written of ['256 GB · Black', '256GB, Black', '256GB / Black', '256GB - Black']) {
    const p = parse(written);
    assert.deepEqual([p.storageKey, p.colourKey], ['256gb', 'black'], written);
  }
});

it('keeps a legacy value the lists do not know, verbatim and editable', () => {
  const parts = parse('Dual SIM export unit');
  assert.equal(parts.colourKey, OTHER_KEY);
  assert.equal(parts.colourCustom, 'Dual SIM export unit');
  assert.equal(compose(parts), 'Dual SIM export unit');
});

it('keeps the unknown half of a half-recognised value', () => {
  const parts = parse('256GB · Sierra Blue');
  assert.equal(parts.storageKey, '256gb');
  assert.equal(parts.colourKey, OTHER_KEY);
  assert.equal(parts.colourCustom, 'Sierra Blue');
  assert.equal(compose(parts), '256 GB · Sierra Blue');
});

it('never drops a word it did not recognise', () => {
  for (const written of ['Dual SIM export unit', '64GB Midnight Green', 'refurb grade B', '1 TB']) {
    const back = compose(parse(written));
    for (const word of written.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')) {
      assert.ok(
        back.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(word),
        `"${word}" was dropped from "${written}"`,
      );
    }
  }
});

it('rewrites a known synonym on purpose, so one phone is one product', () => {
  // The other half of the rule above: `Grey` and `Gray` must not become two
  // product rows. Canonicalising a KNOWN value is the feature.
  assert.equal(compose(parse('Grey')), 'Gray');
  assert.equal(compose(parse('128GB')), '128 GB');
});

it('with no lists loaded, the value still survives', () => {
  // No signal and no cache. Everything lands in `Other` with the text intact,
  // which is a working form rather than a blocked one.
  const parts = parseVariant('256 GB · Black', [], []);
  assert.equal(parts.colourKey, OTHER_KEY);
  assert.equal(composeVariant(parts, [], []), '256 GB · Black');
});

it('an empty value is no selection, not an empty string in the column', () => {
  for (const empty of [null, undefined, '', '   ']) {
    assert.deepEqual(parseVariant(empty, STORAGE, COLOUR), EMPTY_VARIANT);
  }
  assert.equal(compose(EMPTY_VARIANT), '');
});

// ── changing one selector leaves the rest of the draft alone ──────────────

it('choosing a colour does not touch the storage, and vice versa', () => {
  const start = parse('256 GB · Black');

  const recoloured = { ...start, colourKey: 'blue', colourCustom: '' };
  assert.equal(compose(recoloured), '256 GB · Blue');

  const resized = { ...start, storageKey: '512gb', storageCustom: '' };
  assert.equal(compose(resized), '512 GB · Black');
});

it('the component changes only the half that was chosen', () => {
  const code = withoutComments(source('components/catalog/VariantSelect.tsx'));
  // Spread the current parts, override one key. Anything else would clear the
  // other selector — and `onChange` touches nothing but `variant`, so the cost
  // somebody just typed cannot be lost by picking a colour.
  assert.match(code, /apply\(\{ \.\.\.parts, storageKey: option\.key, storageCustom: '' \}\)/);
  assert.match(code, /apply\(\{ \.\.\.parts, colourKey: option\.key, colourCustom: '' \}\)/);
});

it('the selection is derived from the stored value, never held twice', () => {
  const code = withoutComments(source('components/catalog/VariantSelect.tsx'));
  assert.match(code, /const parts = parseVariant\(value, storage, colour, separator\)/);
  // A second copy would be a second truth, and the two would disagree the first
  // time the form was reloaded with a draft.
  assert.ok(!/useState<VariantParts>/.test(code), 'the selection must not be stored separately');
});

// ── a phone is never a quantity ───────────────────────────────────────────

it('a catalogue brand is a phone brand', () => {
  const brands = [{ name: 'Apple' }, { name: 'Samsung' }, { name: 'Tecno' }];
  assert.equal(isPhoneBrand('Apple', brands), true);
  // Case and spacing are how the free-text years wrote it.
  assert.equal(isPhoneBrand('  apple ', brands), true);
  assert.equal(isPhoneBrand('SAMSUNG', brands), true);
});

it('anything the catalogue does not know is not treated as a phone', () => {
  const brands = [{ name: 'Apple' }, { name: 'Samsung' }];
  // Accessories must keep quantity tracking — a shop cannot book in cables one
  // by one, and guessing "phone" here would break stock intake outright.
  assert.equal(isPhoneBrand('Anker', brands), false);
  assert.equal(isPhoneBrand('', brands), false);
  assert.equal(isPhoneBrand('Apple', []), false, 'no catalogue means no claim');
});

/**
 * The tracking mode is no longer a choice on the product form.
 *
 * It used to be a segmented control, filtered so a phone could not be offered
 * "quantity". That guard is gone because the QUESTION is gone: the category
 * decides, the server enforces it, and the form only reports the consequence.
 * These assertions pin that down, because reintroducing a picker here would
 * quietly recreate a form that can contradict the server.
 */
it('the product form offers no tracking picker at all', () => {
  const code = withoutComments(source('components/catalog/ProductForm.tsx'));
  assert.ok(!code.includes('SegmentedControl'), 'the tracking mode must not be selectable here');
  assert.ok(!/set\('trackingType'/.test(code), 'nothing may set the tracking mode from this form');
});

it('the form derives the mode from the selected category', () => {
  const code = withoutComments(source('components/catalog/ProductForm.tsx'));
  assert.match(code, /derivedTracking[^\n]*selected\?\.defaultTrackingType/);
});

it('the form does not send a tracking mode the server would have to referee', () => {
  const code = withoutComments(source('components/catalog/ProductForm.tsx'));
  const payload = code.slice(code.indexOf('export function toProductPayload'));
  assert.ok(!payload.includes('trackingType'), 'the payload must state no opinion on tracking');
});

it('the derived copy answers both halves of "how will this be received?"', () => {
  const en = source('lib/i18n/en.ts');
  const at = (key: string) => {
    const i = en.indexOf(`'${key}'`);
    return en.slice(i, en.indexOf('\n', i) + 1);
  };
  // One says the goods are individual and why; the other says they are not, so
  // an employee reading either knows whether to reach for the scanner.
  assert.match(at('catalog.form.tracking.derived.imei'), /one by one/i);
  assert.match(at('catalog.form.tracking.derived.imei'), /IMEI/);
  assert.match(at('catalog.form.tracking.derived.quantity'), /quantity/i);
  assert.match(at('catalog.form.tracking.derived.quantity'), /no IMEI/i);
});

/**
 * The free-form "Details" rows are gone, but the column behind them is not.
 * Removing the input must never turn into removing the data.
 */
it('the free-form Details editor is gone from the product form', () => {
  const code = withoutComments(source('components/catalog/ProductForm.tsx'));
  assert.ok(!code.includes('specifications'), 'the form no longer edits specifications');
  assert.ok(!code.includes('MAX_SPECS'), 'its bound went with it');
});

it('the payload omits specifications, so historical values survive a PATCH', () => {
  const code = withoutComments(source('components/catalog/ProductForm.tsx'));
  const payload = code.slice(code.indexOf('export function toProductPayload'));
  assert.ok(!payload.includes('specifications'));
});

it('structured storage and colour are untouched by that removal', () => {
  const code = source('components/catalog/ProductForm.tsx');
  // They were never in `specifications` — they live in `variant`, via their own
  // component, which is exactly why removing Details could not take them out.
  assert.match(code, /VariantSelect/);
});

it('all three languages carry every new key', () => {
  const keys = [
    'catalog.form.storage',
    'catalog.form.storage.manual',
    'catalog.form.storage.manual.hint',
    'catalog.form.colour',
    'catalog.form.colour.manual',
    'catalog.form.colour.manual.hint',
    'catalog.variant.other',
    'catalog.select.searchStorage',
    'catalog.select.searchColour',
    'catalog.select.noMatch',
    'catalog.select.unavailable',
    'catalog.form.tracking.derived.imei',
    'catalog.form.tracking.derived.quantity',
    'catalog.form.tracking.derived.from',
    'catalog.form.tracking.derived.noCategory',
  ];
  for (const lang of ['en', 'fr', 'ar']) {
    const file = source(`lib/i18n/${lang}.ts`);
    for (const key of keys) {
      assert.ok(file.includes(`'${key}'`), `${lang} is missing ${key}`);
    }
  }
});

it('the Arabic copy is Arabic, not English left in place', () => {
  const ar = source('lib/i18n/ar.ts');
  for (const key of ['catalog.form.storage', 'catalog.form.colour', 'catalog.form.tracking.derived.quantity']) {
    const at = ar.indexOf(`'${key}'`);
    const value = ar.slice(at, ar.indexOf('\n', at + key.length + 40) + 1);
    assert.match(value, /[؀-ۿ]/, `${key} was not translated`);
  }
});

// ── the form is led by the category ───────────────────────────────────────

it('the category is asked for before anything else', () => {
  /*
   * Order matters here in a way it usually does not. The category decides how
   * the product is received, so asking for it last means the answer to "how
   * will this arrive?" changes under a form the user has already filled in.
   */
  const code = withoutComments(source('components/catalog/ProductForm.tsx'));
  const at = (key: string) => code.indexOf(`t('${key}')`);
  const category = at('catalog.form.section.category');
  const tracking = at('catalog.form.section.tracking');
  const identity = at('catalog.form.section.identity');
  const barcode = at('catalog.form.section.barcode');

  assert.ok(category > 0 && tracking > 0 && identity > 0 && barcode > 0, 'a section is missing');
  assert.ok(category < tracking, 'the derived mode must come after the category it derives from');
  assert.ok(tracking < identity, 'brand and model come after the category');
  assert.ok(identity < barcode, 'the optional barcode comes last of the inputs');
});

it('an IMEI can never populate the product barcode', () => {
  /*
   * A barcode identifies the reusable PRODUCT; an IMEI identifies one physical
   * handset. Letting a scanned IMEI fill this box would make every unit of that
   * model recognise as that one phone.
   */
  const code = withoutComments(source('components/catalog/ProductForm.tsx'));
  const handler = code.slice(code.indexOf('const handleScan'), code.indexOf('const submit'));
  const imeiGuard = handler.indexOf("result.kind === 'imei'");
  const fill = handler.indexOf("set('barcode'");
  assert.ok(imeiGuard > 0, 'the scan handler no longer checks for an IMEI');
  assert.ok(fill > imeiGuard, 'the barcode is filled before the IMEI is rejected');
  assert.match(handler.slice(imeiGuard, fill), /return;/, 'the IMEI branch must return');
});

console.log(`variant selectors and phone tracking: ${passed} passed`);
