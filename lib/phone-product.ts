/**
 * Is this product a phone?
 *
 * Asked for one reason: a phone must never be counted as a quantity. "12
 * iPhone 15" with no IMEIs behind them cannot be sold to a named handset,
 * warranted, traced after a theft, or told apart from each other — and the loss
 * is silent and permanent. Every one of those twelve phones stops being a
 * thing and becomes a number.
 *
 * ## Why the brand, and not the category
 *
 * A category carries a `defaultTrackingType`, which is a shop's own default and
 * can be edited by anybody with catalogue rights. It answers "how does this
 * shop usually count things like this", which is a different question, and a
 * shop that set its phone category to `quantity` by accident would get exactly
 * the outcome this prevents.
 *
 * The device catalogue is a catalogue OF PHONES. A brand in it is a phone brand,
 * that fact is server-owned, and it cannot be edited into being wrong from a
 * handset.
 *
 * ## Why this is permissive when it cannot tell
 *
 * With no brand chosen, an unrecognised brand, or no catalogue loaded, the
 * answer is "not a phone" and the form behaves as it always did. The rule only
 * bites where the evidence is positive, because guessing "phone" for an
 * accessory would take quantity tracking away from the things that genuinely
 * need it — chargers, cases, cables — and break stock intake for a whole shop.
 */

/** Just the part of a catalogue brand this needs. */
export interface BrandLike {
  name: string;
}

export function isPhoneBrand(brand: string, brands: readonly BrandLike[]): boolean {
  const b = brand.trim().toLowerCase();
  if (!b) return false;
  return brands.some((k) => k.name.trim().toLowerCase() === b);
}
