/**
 * The device catalogue on the device.
 *
 *   node lib/device-catalogue.test.ts
 *
 * Two things matter here and neither is the list itself, which lives on the
 * server: that the client's search matches the server's exactly, and that the
 * selector never traps somebody with a phone the catalogue has not heard of.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseSearch, matches, OTHER_BRAND_KEY } from './catalogue-search.ts';

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

const SELECT = 'components/catalog/BrandModelSelect.tsx';
const CLIENT = 'lib/device-catalogue.ts';

// ── Search parity with the server ─────────────────────────────────────────

it('normalises exactly as the server does', () => {
  /*
   * Filtering a CACHED list happens on the device with no server to ask. A
   * client that matched differently would show one set of results online and
   * another offline, which is the kind of difference nobody reports as a bug
   * and everybody works around.
   */
  assert.equal(normaliseSearch('Reno13'), 'reno 13');
  assert.equal(normaliseSearch('reno 13'), 'reno 13');
  assert.equal(normaliseSearch('Galaxy S25'), 'galaxy s 25');
  assert.equal(normaliseSearch('  POCO  X6  '), 'poco x 6');
  assert.equal(normaliseSearch('Français'), 'francais');
});

it('matches however the manufacturer spaced the name', () => {
  assert.ok(matches('Reno13 Pro', 'reno 13'));
  assert.ok(matches('Reno13 Pro', 'reno13'));
  assert.ok(matches('Galaxy S25 Ultra', 's25'));
  assert.ok(matches('Redmi Note 14 Pro+', 'note 14'));
  assert.ok(!matches('iPhone 15', 'galaxy'));
});

it('an empty query matches everything, so an empty box hides nothing', () => {
  assert.ok(matches('anything', ''));
  assert.ok(matches('anything', '   '));
});

// ── The selector's promises ───────────────────────────────────────────────

it('the model list waits for a brand', () => {
  const code = withoutComments(source(SELECT));
  // No brand, no press handler — the row is inert rather than opening an
  // empty list somebody has to back out of.
  assert.match(code, /disabled \|\| !value\.brand\.trim\(\) \? undefined :/);
  assert.match(code, /catalog\.select\.brandFirst/);
});

it('presents the server order, and never re-sorts it', () => {
  /*
   * Ordering is a product decision — which phone somebody is most likely
   * holding — and it lives on the server. A client that re-sorted would make
   * the list read one way on a phone and another in the portal, with neither
   * being the decision anybody made.
   *
   * Release year used to decide it and could not: a family spans years, so
   * `iPhone 17e` (2026) belongs below `iPhone 17 Pro Max` (2025).
   */
  for (const f of [CLIENT, SELECT]) {
    const code = withoutComments(source(f));
    assert.ok(!/\.sort\(/.test(code), `${f} must not sort the catalogue`);
    assert.ok(!/localeCompare/.test(code), `${f} must not order by name`);
  }
  // The selector does not read the ordering fields at all — it cannot use what
  // it never looks at.
  assert.ok(!/releaseYear|displayRank/.test(withoutComments(source(SELECT))));
  // Filtering is fine: it preserves order. Sorting is not.
  assert.match(withoutComments(source(SELECT)), /\.filter\(/);
});

it('loads only the models of the chosen brand', () => {
  const code = withoutComments(source(SELECT));
  assert.match(code, /fetchModels\(selectedBrandKey\)/);
  // The KEY, not the object: `find` returns a new reference every render, so
  // depending on the object refetched the list on every keystroke.
  assert.match(code, /\}, \[selectedBrandKey\]\)/);
  // "Every model of every brand" is a list nobody can use and a request nobody
  // should make on a phone.
  assert.ok(!/fetchModels\(\)/.test(code));
});

it('changing the brand clears the model and nothing else', () => {
  const code = withoutComments(source(SELECT));
  assert.match(code, /model: keepsModel \? value\.model : ''/);
  // The cost, the price and the barcode somebody just typed are untouched:
  // this hands back only the two fields it owns.
  assert.ok(!/variant:/.test(code), 'the selector must not touch other fields');
  assert.ok(!/cost|price|barcode/.test(code), 'the selector owns brand and model only');
});

it('offers manual entry for both, always, as an ordinary choice', () => {
  const code = withoutComments(source(SELECT));
  assert.match(code, /catalog\.select\.otherModel/);
  assert.match(code, /OTHER_BRAND_KEY/);
  assert.equal(OTHER_BRAND_KEY, 'other');
  // Manual is a MODE somebody chose, not a state inferred from an empty field —
  // inferring it opened a brand-new form already showing "type the brand".
  assert.match(code, /const \[brandMode, setBrandMode\] = useState<'catalogue' \| 'manual'>\('catalogue'\)/);
  assert.match(code, /const \[modelMode, setModelMode\] = useState<'catalogue' \| 'manual'>\('catalogue'\)/);
});

it('a legacy free-text value opens ready to edit, not looking broken', () => {
  const code = withoutComments(source(SELECT));
  // A product whose brand was typed years ago has no catalogue row. It starts
  // in manual mode rather than showing an empty selector.
  assert.match(code, /if \(brands\.length > 0 && value\.brand\.trim\(\) && !selectedBrand\) setBrandMode\('manual'\)/);
  // And a lower-case legacy `samsung` still matches Samsung.
  assert.match(code, /b\.name\.toLowerCase\(\) === value\.brand\.trim\(\)\.toLowerCase\(\)/);
});

it('returning from manual entry to the catalogue loses nothing else', () => {
  const code = withoutComments(source(SELECT));
  assert.match(code, /setBrandMode\(other \? 'manual' : 'catalogue'\)/);
  assert.match(code, /if \(!other\) setModelMode\('catalogue'\)/);
});

it('marks the selected row with more than colour', () => {
  const code = withoutComments(source(SELECT));
  assert.match(code, /<Check size=\{18\}/);
  assert.match(code, /selected=\{/);
});

it('uses design tokens, never a raw colour', () => {
  const code = withoutComments(source(SELECT));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), 'no hex colours');
  assert.ok(!/rgba?\(/.test(code), 'no raw rgb colours');
});

it('has no hardcoded copy', () => {
  const code = withoutComments(source(SELECT));
  // Every visible string goes through the catalogue.
  assert.ok(!/>[A-Z][a-z]{3,}[^<{]*</.test(code), 'visible text must be translated');
});

// ── Offline ───────────────────────────────────────────────────────────────

it('caches with the non-secret mechanism, not the secure store', () => {
  const code = withoutComments(source(CLIENT));
  assert.match(code, /from 'expo-file-system'/);
  assert.ok(!/expo-secure-store/.test(code), 'a brand list is not a credential');
  assert.ok(!/from '\.\/storage'/.test(code));
});

it('falls back to the last list and says which it is showing', () => {
  const code = withoutComments(source(CLIENT));
  assert.match(code, /origin: 'live'/);
  assert.match(code, /origin: 'cached'/);
  assert.match(code, /origin: 'unavailable'/);
  // And the screen tells the reader, rather than implying a live lookup.
  assert.match(withoutComments(source(SELECT)), /origin === 'cached'/);
  assert.match(withoutComments(source(SELECT)), /catalog\.select\.offline/);
});

it('bundles no second catalogue', () => {
  /*
   * The one rule that keeps this honest. A list of phones compiled into the
   * app is a list that drifts from the server's and cannot be corrected
   * without shipping a release.
   */
  const code = source(CLIENT) + source(SELECT);
  for (const name of ['iPhone 15', 'Galaxy S24', 'Redmi Note', 'Tecno Spark']) {
    assert.ok(!code.includes(name), `${name} must not be hardcoded in the app`);
  }
  assert.match(withoutComments(source(CLIENT)), /device-catalogue\/brands/);
});

it('a corrupt or missing cache is not an error anybody sees', () => {
  const code = withoutComments(source(CLIENT));
  assert.match(code, /catch \{/);
  assert.match(code, /return null;/);
  // The manual field always works, so a failed catalogue is a small problem.
  assert.ok(!/throw new Error/.test(code));
});

it('every screen that names a product gets this, because the form is shared', () => {
  const form = withoutComments(source('components/catalog/ProductForm.tsx'));
  assert.match(form, /<BrandModelSelect/);
  // The old free-text inputs are gone from the shared form.
  assert.ok(!/label=\{t\('catalog\.form\.brand'\)\}[\s\S]{0,200}onChangeText=\{\(v\) => set\('brand'/.test(form));
  for (const screen of ['app/catalog/new.tsx', 'app/catalog/edit.tsx']) {
    assert.match(source(screen), /ProductForm/);
  }
});

console.log(`device catalogue on the device: ${passed} passed`);
