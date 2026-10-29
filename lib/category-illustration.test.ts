import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_ILLUSTRATIONS,
  CATEGORY_ILLUSTRATIONS,
  illustrationFor,
  illustrationForCategory,
  illustrationForLines,
  illustrationForNested,
  isCategoryIllustration,
} from './category-illustration.ts';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';

/**
 * The picture a product wears comes from its category (D225): a PlayStation 5 is a console, never the desktop
 * computer its serial tracking used to draw.
 *
 *   node lib/category-illustration.test.ts
 */

/** The server's closed list (`src/categories/category-icons.ts`), pinned in both repositories. */
const SERVER_ICONS = [
  'phone', 'tablet', 'laptop', 'desktop', 'monitor', 'console', 'controller', 'tv', 'earbuds', 'headphones',
  'smartwatch', 'speaker', 'camera', 'router', 'charger', 'cable', 'powerbank', 'storage', 'sim',
  'screen_protector', 'case', 'printer', 'electronics', 'accessory',
];

/** Every built-in category key the server seeds (`src/catalog/default-categories.ts`, D223). */
const BUILTIN_KEYS = [
  'phones', 'phones.smartphones', 'phones.feature',
  'tablets', 'tablets.cellular', 'tablets.wifi',
  'computers', 'computers.laptops', 'computers.desktops', 'computers.monitors',
  'wearables', 'wearables.smartwatches', 'wearables.bands',
  'audio', 'audio.earbuds', 'audio.headphones', 'audio.headsets', 'audio.speakers',
  'chargers', 'chargers.wall', 'chargers.car', 'chargers.wireless', 'chargers.adapters',
  'cables', 'cables.usbc', 'cables.lightning', 'cables.microusb', 'cables.hdmi', 'cables.other',
  'powerbanks', 'cases',
  'protection', 'protection.glass', 'protection.films', 'protection.privacy', 'protection.camera',
  'pcaccessories', 'pcaccessories.mice', 'pcaccessories.keyboards', 'pcaccessories.stands', 'pcaccessories.webcams',
  'storage', 'storage.memorycards', 'storage.usb', 'storage.ssd', 'storage.hdd',
  'networking', 'networking.routers', 'networking.mifi', 'networking.repeaters', 'networking.accessories',
  'gaming', 'gaming.consoles', 'gaming.controllers', 'gaming.accessories',
  'parts', 'parts.screens', 'parts.batteries', 'parts.ports', 'parts.cameras',
  'other',
];

it('draws exactly the twenty-four pictures the server accepts', () => {
  assert.deepEqual([...CATEGORY_ILLUSTRATIONS], SERVER_ICONS);
  assert.equal(new Set(CATEGORY_ILLUSTRATIONS).size, 24);
});

it('maps every built-in category, and nothing that is not one', () => {
  assert.deepEqual(Object.keys(BUILTIN_ILLUSTRATIONS).sort(), [...BUILTIN_KEYS].sort());
  for (const [key, picture] of Object.entries(BUILTIN_ILLUSTRATIONS)) {
    assert.ok(isCategoryIllustration(picture), `${key} → ${picture}`);
  }
});

it('a games console is a console, and its controller is a controller — never a desktop or a phone', () => {
  assert.equal(illustrationFor({ key: 'gaming.consoles', parentKey: 'gaming' }, 'serial'), 'console');
  assert.equal(illustrationFor({ key: 'gaming.controllers', parentKey: 'gaming' }, 'serial'), 'controller');
  assert.equal(illustrationFor({ key: 'computers.desktops' }, 'serial'), 'desktop');
  assert.notEqual(illustrationFor({ key: 'gaming.consoles' }, 'serial'), 'desktop');
});

it('the pictures the owner named each have their own built-in home', () => {
  const expected: Record<string, string> = {
    'phones.smartphones': 'phone',
    'tablets.wifi': 'tablet',
    'computers.laptops': 'laptop',
    'computers.monitors': 'monitor',
    'audio.earbuds': 'earbuds',
    'audio.headphones': 'headphones',
    'wearables.smartwatches': 'smartwatch',
    'audio.speakers': 'speaker',
    'networking.routers': 'router',
    'chargers.wall': 'charger',
    'cables.usbc': 'cable',
    powerbanks: 'powerbank',
    'storage.ssd': 'storage',
    'protection.glass': 'screen_protector',
    cases: 'case',
    other: 'electronics',
  };
  for (const [key, picture] of Object.entries(expected)) assert.equal(illustrationFor({ key }), picture, key);
});

it("a shop's own icon wins over its key and its parent", () => {
  assert.equal(illustrationFor({ key: null, icon: 'tv', parentKey: 'computers' }), 'tv');
  assert.equal(illustrationFor({ key: 'phones', icon: 'sim' }), 'sim');
});

it("a shop's own category with no icon wears its built-in parent's picture", () => {
  assert.equal(illustrationFor({ key: null, icon: null, parentKey: 'gaming', parentIcon: null }, 'serial'), 'console');
  assert.equal(illustrationFor({ key: null, icon: null, parentKey: null, parentIcon: 'printer' }), 'printer');
});

it('falls back to a neutral generic, never a phone or a computer', () => {
  assert.equal(illustrationFor(null, 'serial'), 'electronics');
  assert.equal(illustrationFor(null, 'imei'), 'electronics');
  assert.equal(illustrationFor(undefined, 'quantity'), 'accessory');
  assert.equal(illustrationFor({ key: 'unknown.key', icon: 'hologram' }, 'serial'), 'electronics');
});

it('resolves an id through the app’s category list, parent included', () => {
  const categories = [
    { id: 'g', key: 'gaming', icon: null, parentId: null },
    { id: 'own', key: null, icon: null, parentId: 'g' },
    { id: 'tv', key: null, icon: 'tv', parentId: null },
  ];
  assert.equal(illustrationForCategory('own', categories, 'serial'), 'console');
  assert.equal(illustrationForCategory('tv', categories, 'serial'), 'tv');
  assert.equal(illustrationForCategory('missing', categories, 'quantity'), 'accessory');
  assert.equal(illustrationForCategory(null, undefined, 'serial'), 'electronics');
});

it('reads the nested category the inventory endpoints send', () => {
  assert.equal(illustrationForNested({ key: 'gaming.consoles', icon: null, parent: { key: 'gaming', icon: null } }, 'serial'), 'console');
  assert.equal(illustrationForNested({ key: null, icon: null, parent: { key: 'audio', icon: null } }), 'headphones');
  assert.equal(illustrationForNested(null, 'serial'), 'electronics');
});

it('a sale wears the picture its lines share, or the generic when they differ', () => {
  const consoleLine = { categoryVisual: { key: 'gaming.consoles' }, trackingType: 'serial' };
  const caseLine = { categoryVisual: { key: 'cases' }, trackingType: 'quantity' };
  assert.equal(illustrationForLines([consoleLine, consoleLine]), 'console');
  assert.equal(illustrationForLines([consoleLine, caseLine]), 'electronics');
  assert.equal(illustrationForLines([consoleLine, { ...caseLine, voided: true }]), 'console');
});

it('names every picture in English, French and Arabic', () => {
  for (const [language, catalogue] of [['en', en], ['fr', fr], ['ar', ar]] as const) {
    const names = catalogue as unknown as Record<string, string>;
    for (const picture of CATEGORY_ILLUSTRATIONS) {
      const name = names[`category.icon.${picture}`];
      assert.ok(name && name.trim().length > 0, `${language}: category.icon.${picture}`);
      if (language === 'ar') assert.match(name, /[؀-ۿ]/, `ar: category.icon.${picture}`);
    }
  }
});
