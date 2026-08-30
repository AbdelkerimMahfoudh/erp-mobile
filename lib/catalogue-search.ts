/**
 * How a catalogue search matches, and nothing else.
 *
 * Pure and free of any `react-native` or `expo` import, so it runs under plain
 * Node — the same separation `durable-storage-rules.ts` and `draft-schema.ts`
 * already use. Validation you cannot run is validation nobody runs.
 *
 * The rule is duplicated from the server on purpose and pinned by test.
 * Filtering a CACHED list happens on the device with no server to ask, and a
 * client that matched differently would show one set of results online and
 * another offline — the kind of difference nobody reports as a bug and
 * everybody works around.
 */

/**
 * Lower-cased, accents folded, punctuation dropped, and a space inserted where
 * letters meet digits.
 *
 * That last rule is the one that matters: `Reno13`, `Galaxy S25` and `Note 14`
 * are all current manufacturer spellings, and nobody typing into a search box
 * should have to remember which.
 */
export function normaliseSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** An empty query matches everything, so an empty box hides nothing. */
export function matches(haystack: string, query: string): boolean {
  const q = normaliseSearch(query);
  return q.length === 0 || normaliseSearch(haystack).includes(q);
}

/** The key of the catalogue row that means "not in this list". */
export const OTHER_BRAND_KEY = 'other';
