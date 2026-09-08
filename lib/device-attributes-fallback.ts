/**
 * The offline-safe baseline for Storage and Colour.
 *
 * ## Why this file exists at all
 *
 * The rule everywhere else in this app is that **the client holds no catalogue
 * of its own** — brands and models come from the server so they can be
 * corrected without shipping a release. That rule was applied to storage and
 * colour too, and it produced a failure nobody wanted: when the attributes
 * request failed, both lists came back empty and the shopkeeper was pushed
 * into typing. On a real iPhone that read as "the app is broken", and receiving
 * stock is exactly the moment somebody is standing at a counter with a handset
 * in their hand and no patience.
 *
 * So this is a deliberate, narrow exception, and its scope is the whole point:
 *
 *  - the **server stays authoritative**. When the request succeeds, the server's
 *    lists are used and this file is not consulted;
 *  - this is used **only when the request genuinely fails** — not when the
 *    server returns an empty list, which is a different thing and stays
 *    different on screen;
 *  - it is a *floor*, not a copy of the catalogue. Storage capacities and basic
 *    colour names are the two things in the whole catalogue that do not change:
 *    brands appear, models appear every autumn, but 128 GB and "Black" are
 *    fixed. That stability is what makes bundling these safe when bundling
 *    models would not be.
 *
 * ## Keeping it honest
 *
 * `device-attributes-fallback.test.ts` compares this list against the server's
 * own `backend/src/catalog/device-attributes.ts` and fails when either side
 * moves. Two lists that drift apart silently would be worse than one list that
 * is occasionally stale, because nobody would know which was right.
 *
 * Deliberately dependency-free, so nothing here can fail to load at the moment
 * the network already has.
 */

export interface FallbackAttributeOption {
  /** Stable and canonical — matches the server's `key` exactly. */
  key: string;
  /** What is shown. Matches the server's `label` exactly. */
  label: string;
}

/**
 * Capacities, smallest first.
 *
 * The small end is not legacy padding: 4–32 GB is where the cheap Android stock
 * in this market sits, and a list starting at 64 GB would send half of it to
 * `Other`.
 */
export const FALLBACK_STORAGE_OPTIONS: readonly FallbackAttributeOption[] = [
  { key: '4gb', label: '4 GB' },
  { key: '8gb', label: '8 GB' },
  { key: '16gb', label: '16 GB' },
  { key: '32gb', label: '32 GB' },
  { key: '64gb', label: '64 GB' },
  { key: '128gb', label: '128 GB' },
  { key: '256gb', label: '256 GB' },
  { key: '512gb', label: '512 GB' },
  { key: '1tb', label: '1 TB' },
  { key: '2tb', label: '2 TB' },
  { key: 'other', label: 'Other' },
];

/**
 * Colours as a shopkeeper says them, not as a manufacturer markets them.
 *
 * "Deep Purple" and "Sierra Blue" are marketing names for purple and blue.
 * Nobody at a counter uses them, and putting them here would file one phone
 * under three names. A shop that needs the marketing name types it into
 * `Other`.
 */
export const FALLBACK_COLOUR_OPTIONS: readonly FallbackAttributeOption[] = [
  { key: 'black', label: 'Black' },
  { key: 'white', label: 'White' },
  { key: 'gray', label: 'Gray' },
  { key: 'silver', label: 'Silver' },
  { key: 'gold', label: 'Gold' },
  { key: 'rose_gold', label: 'Rose Gold' },
  { key: 'blue', label: 'Blue' },
  { key: 'green', label: 'Green' },
  { key: 'red', label: 'Red' },
  { key: 'purple', label: 'Purple' },
  { key: 'pink', label: 'Pink' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'orange', label: 'Orange' },
  { key: 'brown', label: 'Brown' },
  { key: 'beige', label: 'Beige' },
  { key: 'other', label: 'Other' },
];

/** What separates storage from colour inside the stored string. */
export const FALLBACK_VARIANT_SEPARATOR = ' · ';

/**
 * The whole baseline, shaped exactly like the server's `attributes` payload so
 * the caller needs no branch for "this came from the bundle".
 *
 * `describes` is carried for the same reason the server carries it: a client
 * that assumed `variant` meant "region" would quietly create a product row per
 * market.
 */
export function fallbackAttributes(): {
  storage: FallbackAttributeOption[];
  colour: FallbackAttributeOption[];
  describes: string[];
  separator: string;
} {
  return {
    // Copied, not shared: a caller that sorted or spliced the result must not
    // be able to mutate the baseline for everybody else.
    storage: FALLBACK_STORAGE_OPTIONS.map((o) => ({ ...o })),
    colour: FALLBACK_COLOUR_OPTIONS.map((o) => ({ ...o })),
    describes: ['storage', 'colour'],
    separator: FALLBACK_VARIANT_SEPARATOR,
  };
}
