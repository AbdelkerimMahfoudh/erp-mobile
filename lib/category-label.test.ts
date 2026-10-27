/**
 * Built-in categories are shown by key in the reader's language; a shop's own
 * by its name; subcategories under their parent (D223).
 *
 *   node lib/category-label.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CELLULAR_CATEGORY_KEYS, categoryLabel, inTreeOrder } from './category-label.ts';

let passed = 0;
function it(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const fr: Record<string, string> = { 'category.builtin.phones': 'Téléphones', 'category.builtin.phones.smartphones': 'Smartphones' };
const t = (k: string) => fr[k] ?? k;
const has = (k: string) => k in fr;

it('shows a built-in by its key, in the reader\'s language', () => {
  assert.equal(categoryLabel({ name: 'Phones', key: 'phones' }, t, has), 'Téléphones');
});

it('shows a shop\'s own category by the name the shop gave it', () => {
  assert.equal(categoryLabel({ name: 'Occasions', key: null }, t, has), 'Occasions');
});

it('falls back to the server\'s name for a key this build does not know', () => {
  assert.equal(categoryLabel({ name: 'Drones', key: 'drones' }, t, has), 'Drones');
});

it('orders each top-level category before its subcategories, one level deep', () => {
  const rows = inTreeOrder(
    [
      { id: 'c2', name: 'Smartphones', parentId: 'c1' },
      { id: 'c3', name: 'Cables', parentId: null },
      { id: 'c1', name: 'Phones', parentId: null },
      { id: 'c4', name: 'Refurbished', parentId: 'c1' },
    ],
    (c) => c.name,
  );
  assert.deepEqual(
    rows.map((r) => `${r.depth}:${r.category.name}`),
    ['0:Cables', '0:Phones', '1:Refurbished', '1:Smartphones'],
  );
});

it('keeps a subcategory whose parent is hidden, rather than losing it', () => {
  const rows = inTreeOrder([{ id: 'c2', name: 'Smartphones', parentId: 'gone' }], (c) => c.name);
  assert.equal(rows.length, 1);
});

it('offers for an IMEI only built-in categories that exist and allow IMEI on the server', () => {
  const server = readFileSync(new URL('../../erp-backend/src/catalog/default-categories.ts', import.meta.url), 'utf8');
  for (const key of CELLULAR_CATEGORY_KEYS) {
    const line = server.split('\n').find((l) => l.includes(`key: '${key}'`));
    assert.ok(line, `${key} is a built-in category`);
    assert.match(line!, /allowed: \[[^\]]*imei/, `${key} allows IMEI`);
  }
});

it('has a translation for every built-in category, in every language', () => {
  const server = readFileSync(new URL('../../erp-backend/src/catalog/default-categories.ts', import.meta.url), 'utf8');
  const keys = [...server.matchAll(/\{ key: '([a-z.]+)', name:/g)].map((m) => m[1]);
  assert.ok(keys.length >= 60);
  for (const lang of ['en', 'fr', 'ar']) {
    const catalogue = readFileSync(new URL(`./i18n/${lang}.ts`, import.meta.url), 'utf8');
    for (const key of keys) assert.ok(catalogue.includes(`'category.builtin.${key}':`), `${lang}: ${key}`);
  }
});

console.log(`category labels: ${passed} passed`);
