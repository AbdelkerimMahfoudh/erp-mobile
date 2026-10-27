/**
 * The name a category is shown by (D223).
 *
 * A built-in category carries a stable `key` and is the same vocabulary in every
 * shop, so it is shown in the reader's language from the catalogue
 * (`category.builtin.<key>`). A shop's own category has no key and is shown by
 * the name the shop gave it. A key this build does not know yet falls back to
 * the server's English name rather than showing a raw key.
 */
export interface LabelledCategory {
  name: string;
  key?: string | null;
}

export function categoryLabel(
  category: LabelledCategory,
  t: (key: string) => string,
  has: (key: string) => boolean,
): string {
  if (category.key) {
    const id = `category.builtin.${category.key}`;
    if (has(id)) return t(id);
  }
  return category.name;
}

/**
 * The built-in categories an IMEI can belong to: devices with a mobile
 * connection. Asked when a new product starts from an IMEI scan, so a cellular
 * tablet or a MiFi router is not filed as a phone by default.
 */
export const CELLULAR_CATEGORY_KEYS = [
  'phones.smartphones',
  'phones.feature',
  'tablets.cellular',
  'wearables.smartwatches',
  'networking.mifi',
] as const;

/**
 * Categories in reading order: each top-level one followed by its
 * subcategories. A subcategory whose parent is not in the list (retired and
 * hidden) still appears, among the top-level ones, rather than vanishing.
 */
export function inTreeOrder<T extends { id: string; parentId?: string | null }>(
  categories: readonly T[],
  label: (c: T) => string,
): { category: T; depth: 0 | 1 }[] {
  const byLabel = (a: T, b: T) => label(a).localeCompare(label(b));
  const ids = new Set(categories.map((c) => c.id));
  const tops = categories.filter((c) => !c.parentId || !ids.has(c.parentId)).sort(byLabel);
  const out: { category: T; depth: 0 | 1 }[] = [];
  for (const top of tops) {
    out.push({ category: top, depth: top.parentId ? 1 : 0 });
    for (const child of categories.filter((c) => c.parentId === top.id).sort(byLabel)) {
      out.push({ category: child, depth: 1 });
    }
  }
  return out;
}
