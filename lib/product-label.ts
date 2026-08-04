import type { InventoryProduct } from '../types/api';

/**
 * Naming an exact variant.
 *
 * Two rows both reading "Apple iPhone 15" are not the same thing if one is
 * 128GB black and the other 256GB blue. Serialized rows can be told apart by
 * their identifier, but an aggregated quantity row has none — so the
 * distinguishing attributes have to be visible or the count is ambiguous.
 *
 * Attributes come from the product's category-configured `specifications`,
 * which is deliberately open-ended: categories define their own fields, so
 * nothing here may hardcode "storage" or "colour".
 */

/** Values that identify a variant rather than describe it in prose. */
const MAX_ATTRIBUTES = 3;

export function productTitle(product: InventoryProduct | null, fallback = ''): string {
  if (!product) return fallback;
  return [product.brand, product.model].filter(Boolean).join(' ') || fallback;
}

/**
 * The short attribute list shown under the title, e.g. `256GB · Black`.
 *
 * Capped, because this is a glanceable list row rather than a spec sheet, and
 * ordered as the category defined them — the first fields a category declares
 * are the ones it considers identifying.
 */
export function variantAttributes(product: InventoryProduct | null): string[] {
  if (!product) return [];

  const attributes: string[] = [];
  if (product.variant) attributes.push(product.variant);

  const specs = product.specifications;
  if (specs && typeof specs === 'object') {
    for (const value of Object.values(specs)) {
      if (attributes.length >= MAX_ATTRIBUTES) break;
      if (value === null || value === undefined || value === '') continue;
      // Objects and arrays are structured detail, not a glanceable label.
      if (typeof value === 'object') continue;
      const text = String(value);
      // A spec repeating the variant string adds nothing.
      if (attributes.includes(text)) continue;
      attributes.push(text);
    }
  }

  return attributes.slice(0, MAX_ATTRIBUTES);
}

/** `256GB · Black`, or empty when the product has nothing distinguishing. */
export function variantSummary(product: InventoryProduct | null): string {
  return variantAttributes(product).join(' · ');
}

/**
 * Everything a row should be searchable by, lower-cased.
 *
 * Includes the identifier and barcode so an employee holding a device can find
 * it by typing the last few digits — faster than scrolling, and the common
 * case when a screen is cracked and the barcode will not scan.
 */
export function searchHaystack(
  product: InventoryProduct | null,
  ...extras: (string | null | undefined)[]
): string {
  return [
    productTitle(product),
    ...variantAttributes(product),
    product?.barcode,
    ...extras,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
