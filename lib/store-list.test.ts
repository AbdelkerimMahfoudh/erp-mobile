import assert from 'node:assert/strict';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';
import { compactStores, moreKey, storesLine } from './store-list.ts';

const catalogues = { en, fr, ar } as unknown as Record<string, Record<string, string>>;
const t = (language: string) => (key: string, vars: { count: number }) => catalogues[language][key].replace('{count}', String(vars.count));
const plain = (s: string) => s.replace(/[⁨⁩]/g, '');
const store = (name: string, nameAr: string | null = null) => ({ name, nameAr });
const CENTRE = store('Boutique Centre', 'متجر المركز');
const list = (n: number) => [CENTRE, ...Array.from({ length: n }, (_, i) => store(`S${i}`))];

const cases: [string, number, string][] = [
  ['en', 1, 'Boutique Centre + 1 more'],
  ['en', 2, 'Boutique Centre + 2 more'],
  ['fr', 1, 'Boutique Centre + 1 autre'],
  ['fr', 2, 'Boutique Centre + 2 autres'],
  ['fr', 11, 'Boutique Centre + 11 autres'],
  ['ar', 1, 'متجر المركز + متجر آخر'],
  ['ar', 2, 'متجر المركز + متجران آخران'],
  ['ar', 3, 'متجر المركز + 3 متاجر أخرى'],
  ['ar', 10, 'متجر المركز + 10 متاجر أخرى'],
  ['ar', 11, 'متجر المركز + 11 متجرًا آخر'],
];
for (const [language, n, want] of cases) {
  assert.equal(plain(compactStores(list(n), language, t(language))), want, `${language} ${n}`);
}

// One store has no suffix; none says nothing.
assert.equal(plain(compactStores([CENTRE], 'en', t('en'))), 'Boutique Centre');
assert.equal(compactStores([], 'en', t('en')), '');

// A Latin name in an Arabic line is isolated, so the sentence keeps its order.
const mixed = compactStores([store('Phone House'), store('B')], 'ar', t('ar'));
assert.ok(mixed.startsWith('⁨Phone House⁩ '), mixed);

// A store with no Arabic name shows its Latin one, never blank.
assert.equal(plain(compactStores([store('Phone House')], 'ar', t('ar'))), 'Phone House');

assert.equal(moreKey(1), 'stores.more.one');
assert.equal(moreKey(2), 'stores.more.two');
assert.equal(moreKey(10), 'stores.more.few');
assert.equal(moreKey(11), 'stores.more.many');

// However many stores there are, the compact line stays one name and a count: nothing to overflow but the name itself.
const many = compactStores(list(500), 'en', t('en'));
assert.equal(plain(many), 'Boutique Centre + 500 more');

assert.equal(plain(storesLine([CENTRE, store('Port')], 'fr')), 'Boutique Centre, Port');
assert.equal(plain(storesLine([CENTRE, store('Port')], 'ar')), 'متجر المركز، Port');

console.log('store-list: ok');
