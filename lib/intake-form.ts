/**
 * The category decides the product form (D223, the owner's device test of 2026-10-28).
 *
 * Before a category is chosen there is no Brand, no Model, no catalogue
 * request and no phone field: the category is what says how the item is
 * counted and what is worth asking. After it is chosen:
 *
 * - the tracking mode starts from the category's suggestion, and only the modes
 *   it allows are offered (a scanned IMEI, serial or product barcode narrows
 *   them further, because the scan already says what the code is);
 * - the manufacturer catalogue is offered only for a phone category — every row
 *   in it is a phone, so Apple under Laptops, Tablets or Audio never means an
 *   iPhone; anything else is typed by hand;
 * - only the category's own attributes are shown: storage and colour for a
 *   phone, processor and RAM for a laptop, power and connector for a charger.
 *
 * Changing the category clears everything that belonged to the previous one —
 * brand, model, storage, colour and the other attributes, and the mode — so no
 * hidden phone data travels with a cable.
 *
 * Pure, so it is proved without a screen (`node lib/intake-form.test.ts`).
 */

export type TrackingMode = 'imei' | 'serial' | 'quantity';

export const ALL_MODES: readonly TrackingMode[] = ['imei', 'serial', 'quantity'];

export interface FormAttribute {
  key: string;
  label: string;
  type: 'text' | 'number' | 'enum' | 'measurement';
  unit?: string;
  options?: string[];
}

export interface FormCategory {
  id: string;
  key?: string | null;
  parentId?: string | null;
  defaultTrackingType: TrackingMode;
  /** From the server (D223): the modes this category allows. Absent from an older server. */
  allowedTrackingTypes?: readonly TrackingMode[];
  attributeSchema?: readonly FormAttribute[] | null;
}

/** Mirrors the server's `DEVICE_CATALOGUE_CATEGORY_ROOT`: the curated catalogue holds phones only. */
export const DEVICE_CATALOGUE_ROOT = 'phones';

/** The built-in key a category answers to: its own, or its parent's for a shop subcategory. */
export function builtinKeyOf(category: FormCategory, all: readonly FormCategory[]): string | null {
  if (category.key) return category.key;
  const parent = category.parentId ? all.find((c) => c.id === category.parentId) : undefined;
  return parent?.key ?? null;
}

export function catalogueCovers(builtinKey: string | null | undefined): boolean {
  if (!builtinKey) return false;
  return builtinKey === DEVICE_CATALOGUE_ROOT || builtinKey.startsWith(`${DEVICE_CATALOGUE_ROOT}.`);
}

/**
 * What a scanned code allows: an IMEI is one phone, a serial one device, and a
 * product barcode names a model — so a single scanned item by its barcode is
 * counted. Nothing scanned: no restriction.
 */
export function restrictionForScan(kind: 'imei' | 'serial' | 'barcode' | null): readonly TrackingMode[] | null {
  if (kind === 'imei') return ['imei'];
  if (kind === 'serial') return ['serial'];
  if (kind === 'barcode') return ['quantity'];
  return null;
}

/** The modes offered for this category, narrowed by the scan when there is one. */
export function modesFor(category: FormCategory, restriction: readonly TrackingMode[] | null): TrackingMode[] {
  const allowed = category.allowedTrackingTypes ?? ALL_MODES;
  return allowed.filter((m) => !restriction || restriction.includes(m));
}

/** A category the scan can go into: it allows at least one mode the code fits. */
export function categoryFits(category: FormCategory, restriction: readonly TrackingMode[] | null): boolean {
  return modesFor(category, restriction).length > 0;
}

/** Where the mode starts: the category's suggestion when it is offered, else the first that is. */
export function startingMode(category: FormCategory, restriction: readonly TrackingMode[] | null): TrackingMode | null {
  const modes = modesFor(category, restriction);
  if (modes.length === 0) return null;
  return modes.includes(category.defaultTrackingType) ? category.defaultTrackingType : modes[0];
}

/** Which fields the category asks for: the storage/colour selector, and its other attributes. */
export function fieldsFor(category: FormCategory | null): { storage: boolean; colour: boolean; others: FormAttribute[] } {
  const schema = category?.attributeSchema ?? [];
  return {
    storage: schema.some((a) => a.key === 'storage'),
    colour: schema.some((a) => a.key === 'color'),
    others: schema.filter((a) => a.key !== 'storage' && a.key !== 'color'),
  };
}

export interface CategoryScopedValues {
  brand: string;
  model: string;
  variant: string;
  categoryId: string | null;
  trackingType: TrackingMode;
  specifications: Record<string, string>;
}

/**
 * The values after choosing a category: everything that belonged to the
 * previous one is cleared, and the mode starts from the new one.
 */
export function withCategory<V extends CategoryScopedValues>(
  values: V,
  category: FormCategory,
  restriction: readonly TrackingMode[] | null,
): V {
  if (values.categoryId === category.id) return values;
  return {
    ...values,
    categoryId: category.id,
    brand: '',
    model: '',
    variant: '',
    specifications: {},
    trackingType: startingMode(category, restriction) ?? values.trackingType,
  };
}

/**
 * The attribute values to send: only the category's own, only those filled in,
 * numbers as numbers (the server validates them against the same schema).
 */
export function specificationsPayload(
  others: readonly FormAttribute[],
  values: Record<string, string>,
): Record<string, string | number> | undefined {
  const out: Record<string, string | number> = {};
  for (const a of others) {
    const raw = (values[a.key] ?? '').trim();
    if (!raw) continue;
    if (a.type === 'number' || a.type === 'measurement') {
      const n = Number(raw.replace(',', '.'));
      if (Number.isFinite(n)) out[a.key] = n;
    } else {
      out[a.key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
