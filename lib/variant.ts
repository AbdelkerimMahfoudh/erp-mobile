/**
 * Turning `products.variant` into two selections, and back.
 *
 * ## What `variant` means here, audited rather than assumed
 *
 * `schema.prisma` says it outright: *"`products.variant` already carries
 * storage and colour"*, and the catalog service calls a product row "the
 * exact-variant identity". So `variant` is **storage and colour in one free-text
 * box** — not a market, not a region, and not a place to repeat `Pro`, `Plus`
 * or `Ultra`, which belong to the model name and arrive from the model
 * selector.
 *
 * That is why the form has two selectors and not three. A market/region
 * selector would be a new fact about a phone that nothing in the schema, the
 * API or any shop's data has ever recorded, and it would add a fourth term to
 * the `(company, brand, model, variant)` unique key — one more product row per
 * market, for a distinction nobody has made.
 *
 * ## The lists are not here
 *
 * The capacities and colours come from `/device-catalogue/attributes`. This
 * module holds only the behaviour — which is not data, and cannot drift.
 *
 * ## The promise
 *
 * **No value a shop ever typed is lost.** A product saved when this was a text
 * box opens with its old value visible and editable; anything the lists do not
 * recognise comes back as `Other` with the original text intact. The one thing
 * that is deliberately rewritten is a known synonym — `Grey` becomes `Gray`,
 * `128GB` becomes `128 GB` — because one spelling per value is the entire
 * reason the selectors exist.
 */
import type { AttributeOption } from './device-catalogue.ts';

export const OTHER_KEY = 'other';

export interface VariantParts {
  storageKey: string | null;
  storageCustom: string;
  colourKey: string | null;
  colourCustom: string;
}

export const EMPTY_VARIANT: VariantParts = {
  storageKey: null,
  storageCustom: '',
  colourKey: null,
  colourCustom: '',
};

/** `128GB`, `128 gb`, `128 Go`, `128g` and bare `128` all mean one option. */
function matchStorage(text: string, options: AttributeOption[]): AttributeOption | null {
  const t = text.trim().toLowerCase();
  const exact = options.find((o) => o.label.toLowerCase() === t && o.key !== OTHER_KEY);
  if (exact) return exact;
  const m = /^(\d+)\s*(gb|go|g|tb|to|t)?$/.exec(t);
  if (!m) return null;
  const unit = m[2] ?? 'gb';
  const key = `${m[1]}${unit.startsWith('t') ? 'tb' : 'gb'}`;
  return options.find((o) => o.key === key) ?? null;
}

function matchColour(text: string, options: AttributeOption[]): AttributeOption | null {
  const t = text.trim().toLowerCase();
  const exact = options.find((o) => o.label.toLowerCase() === t && o.key !== OTHER_KEY);
  if (exact) return exact;
  const norm = t.replace(/[^a-z]+/g, '_');
  const key = norm === 'grey' ? 'gray' : norm;
  return options.find((o) => o.key === key && o.key !== OTHER_KEY) ?? null;
}

/**
 * Read a stored value back into selections.
 *
 * With no lists loaded — no signal, no cache — everything lands in `Other` with
 * the text intact. That is the correct outcome rather than a degraded one: the
 * value is still shown, still editable, and still saved unchanged.
 */
export function parseVariant(
  variant: string | null | undefined,
  storage: AttributeOption[],
  colour: AttributeOption[],
  separator = ' · ',
): VariantParts {
  const raw = (variant ?? '').trim();
  if (!raw) return { ...EMPTY_VARIANT };

  const pieces = raw
    .split(/[·,/|]|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const parts: VariantParts = { ...EMPTY_VARIANT };
  const unmatched: string[] = [];

  for (const piece of pieces) {
    const s = matchStorage(piece, storage);
    if (s && !parts.storageKey) {
      parts.storageKey = s.key;
      continue;
    }
    const c = matchColour(piece, colour);
    if (c && !parts.colourKey) {
      parts.colourKey = c.key;
      continue;
    }
    unmatched.push(piece);
  }

  // Kept, never dropped. Whatever it is, somebody wrote it on purpose.
  if (unmatched.length) {
    if (!parts.colourKey) {
      parts.colourKey = OTHER_KEY;
      parts.colourCustom = unmatched.join(separator);
    } else {
      parts.storageKey = parts.storageKey ?? OTHER_KEY;
      parts.storageCustom = parts.storageCustom || unmatched.join(separator);
    }
  }

  return parts;
}

function labelFor(options: AttributeOption[], key: string | null, custom: string): string | null {
  if (!key) return null;
  if (key === OTHER_KEY) return custom.trim() || null;
  return options.find((o) => o.key === key)?.label ?? null;
}

/**
 * Compose the selections back into the single string the column holds.
 *
 * Storage first, then colour — a fixed order, so two shops entering the same
 * handset produce the same string and land on the same product row. That is
 * the whole point: the same phone must not become two products because one
 * person wrote the colour first.
 */
export function composeVariant(
  parts: VariantParts,
  storage: AttributeOption[],
  colour: AttributeOption[],
  separator = ' · ',
): string {
  return [
    labelFor(storage, parts.storageKey, parts.storageCustom),
    labelFor(colour, parts.colourKey, parts.colourCustom),
  ]
    .filter((p): p is string => Boolean(p))
    .join(separator);
}
