/**
 * Which options a selector sheet shows, for a given query.
 *
 * Extracted from `SelectSheet` so the one rule that actually matters can be
 * asserted without a renderer: **an empty query shows everything.** A picker
 * that opens on an empty list and waits to be searched turns a one-tap choice
 * into type-read-tap, and the person using it has to already know what they are
 * looking for — which is exactly what a picker exists to avoid.
 */

export interface SelectFilterOptions<T> {
  items: T[];
  query: string;
  /** Present when the SERVER filters. Then the list is already the answer. */
  serverFiltered: boolean;
  label: (item: T) => string;
  description?: (item: T) => string | undefined;
  identifier?: (item: T) => string | undefined;
}

export function visibleOptions<T>({
  items,
  query,
  serverFiltered,
  label,
  description,
  identifier,
}: SelectFilterOptions<T>): T[] {
  // Server-side search returns pre-filtered items; filtering again locally
  // would hide results the server deliberately matched on fields the client
  // cannot see.
  if (serverFiltered) return items;

  const needle = query.trim().toLowerCase();
  if (!needle) return items;

  return items.filter((item) => {
    const haystack = [label(item), description?.(item), identifier?.(item)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
