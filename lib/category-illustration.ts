/**
 * Which picture a product wears (D225, the owner's TestFlight feedback of 2026-10-29).
 *
 * A PlayStation 5 under Gaming consoles was drawn as a desktop computer, because the Stock row only knew
 * it was serial-tracked. The picture now comes from what the product IS — its category — through one
 * mapping that Stock, Receive, Sale, search, product details and reports all read:
 *
 *  1. a shop's own category wears the icon its creator chose (`product_categories.icon`);
 *  2. a built-in category wears the picture of its stable key;
 *  3. a category of neither kind wears its built-in parent's picture (a shop's "Refurbished phones" under
 *     Phones is still a phone);
 *  4. anything else is a neutral generic — electronics, or an accessory for counted stock — never an
 *     unrelated phone or computer.
 *
 * The unit is the category, not the model: no artwork per device, nothing to maintain per release. The
 * names are the server's closed list (`src/categories/category-icons.ts`); a name this build does not know
 * falls through to the next rule rather than drawing nothing.
 *
 *   node lib/category-illustration.test.ts
 */

export const CATEGORY_ILLUSTRATIONS = [
  'phone',
  'tablet',
  'laptop',
  'desktop',
  'monitor',
  'console',
  'controller',
  'tv',
  'earbuds',
  'headphones',
  'smartwatch',
  'speaker',
  'camera',
  'router',
  'charger',
  'cable',
  'powerbank',
  'storage',
  'sim',
  'screen_protector',
  'case',
  'printer',
  'electronics',
  'accessory',
] as const;

export type CategoryIllustration = (typeof CATEGORY_ILLUSTRATIONS)[number];

const KNOWN: ReadonlySet<string> = new Set(CATEGORY_ILLUSTRATIONS);

export function isCategoryIllustration(value: unknown): value is CategoryIllustration {
  return typeof value === 'string' && KNOWN.has(value);
}

/** Every built-in category's picture, by its stable key (D223, `src/catalog/default-categories.ts`). */
export const BUILTIN_ILLUSTRATIONS: Readonly<Record<string, CategoryIllustration>> = {
  phones: 'phone',
  'phones.smartphones': 'phone',
  'phones.feature': 'phone',
  tablets: 'tablet',
  'tablets.cellular': 'tablet',
  'tablets.wifi': 'tablet',
  computers: 'laptop',
  'computers.laptops': 'laptop',
  'computers.desktops': 'desktop',
  'computers.monitors': 'monitor',
  wearables: 'smartwatch',
  'wearables.smartwatches': 'smartwatch',
  'wearables.bands': 'smartwatch',
  audio: 'headphones',
  'audio.earbuds': 'earbuds',
  'audio.headphones': 'headphones',
  'audio.headsets': 'headphones',
  'audio.speakers': 'speaker',
  chargers: 'charger',
  'chargers.wall': 'charger',
  'chargers.car': 'charger',
  'chargers.wireless': 'charger',
  'chargers.adapters': 'charger',
  cables: 'cable',
  'cables.usbc': 'cable',
  'cables.lightning': 'cable',
  'cables.microusb': 'cable',
  'cables.hdmi': 'cable',
  'cables.other': 'cable',
  powerbanks: 'powerbank',
  cases: 'case',
  protection: 'screen_protector',
  'protection.glass': 'screen_protector',
  'protection.films': 'screen_protector',
  'protection.privacy': 'screen_protector',
  'protection.camera': 'screen_protector',
  pcaccessories: 'accessory',
  'pcaccessories.mice': 'accessory',
  'pcaccessories.keyboards': 'accessory',
  'pcaccessories.stands': 'accessory',
  'pcaccessories.webcams': 'camera',
  storage: 'storage',
  'storage.memorycards': 'storage',
  'storage.usb': 'storage',
  'storage.ssd': 'storage',
  'storage.hdd': 'storage',
  networking: 'router',
  'networking.routers': 'router',
  'networking.mifi': 'router',
  'networking.repeaters': 'router',
  'networking.accessories': 'router',
  gaming: 'console',
  'gaming.consoles': 'console',
  'gaming.controllers': 'controller',
  'gaming.accessories': 'controller',
  parts: 'electronics',
  'parts.screens': 'electronics',
  'parts.batteries': 'electronics',
  'parts.ports': 'electronics',
  'parts.cameras': 'camera',
  other: 'electronics',
};

/** What the server sends with a row that shows a product (`categoryVisual`). */
export interface CategoryVisualInput {
  key?: string | null;
  icon?: string | null;
  parentKey?: string | null;
  parentIcon?: string | null;
}

/**
 * The one resolver. `trackingType` only chooses between the two generics, never a specific device:
 * counted stock with no category is an accessory, anything else is electronics.
 */
export function illustrationFor(
  visual: CategoryVisualInput | null | undefined,
  trackingType?: string | null,
): CategoryIllustration {
  if (visual) {
    if (isCategoryIllustration(visual.icon)) return visual.icon;
    if (visual.key && BUILTIN_ILLUSTRATIONS[visual.key]) return BUILTIN_ILLUSTRATIONS[visual.key];
    if (isCategoryIllustration(visual.parentIcon)) return visual.parentIcon;
    if (visual.parentKey && BUILTIN_ILLUSTRATIONS[visual.parentKey]) return BUILTIN_ILLUSTRATIONS[visual.parentKey];
  }
  return trackingType === 'quantity' ? 'accessory' : 'electronics';
}

/** A category from the app's own `/categories` list, resolved the same way through its parent. */
export function illustrationForCategory(
  categoryId: string | null | undefined,
  categories: readonly { id: string; key?: string | null; icon?: string | null; parentId?: string | null }[] | undefined,
  trackingType?: string | null,
): CategoryIllustration {
  const found = categoryId ? categories?.find((c) => c.id === categoryId) : undefined;
  if (!found) return illustrationFor(null, trackingType);
  const parent = found.parentId ? categories?.find((c) => c.id === found.parentId) : undefined;
  return illustrationFor(
    { key: found.key, icon: found.icon, parentKey: parent?.key ?? null, parentIcon: parent?.icon ?? null },
    trackingType,
  );
}

/** A product's category as the inventory reads send it (`product.category`), nested rather than flat. */
export interface NestedCategory {
  key?: string | null;
  icon?: string | null;
  parent?: { key?: string | null; icon?: string | null } | null;
}

export function illustrationForNested(category: NestedCategory | null | undefined, trackingType?: string | null): CategoryIllustration {
  return illustrationFor(
    category ? { key: category.key, icon: category.icon, parentKey: category.parent?.key, parentIcon: category.parent?.icon } : null,
    trackingType,
  );
}

/**
 * The picture for a whole sale: the one its lines share, or the generic when they differ (a phone and its
 * case are one sale, but neither is the sale). Voided lines do not count.
 */
export function illustrationForLines(
  lines: readonly { categoryVisual?: CategoryVisualInput | null; trackingType?: string | null; voided?: boolean }[],
): CategoryIllustration {
  const live = lines.filter((l) => !l.voided);
  const each = new Set(live.map((l) => illustrationFor(l.categoryVisual ?? null, l.trackingType ?? null)));
  if (each.size === 1) return [...each][0];
  return 'electronics';
}
