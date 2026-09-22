import {
  canAccept,
  effectiveCost,
  effectiveImei2,
  entryState,
  groupSummary,
  remainingProblems,
  type BatchState,
  type EntryGroup,
  type EntryProblem,
  type EntryState,
  type GroupSummary,
  type SourceRef,
} from './file-receiving-rules.ts';

/**
 * The review list, flattened.
 *
 * A hundred rows in ten groups used to be ten cards, each mapping its own rows
 * inside itself. Every correction rebuilt every card, and the open card was a
 * column of rows the list could not virtualize because they were one item.
 *
 * Here the list is ONE sequence of records — a header per group, then the rows
 * of the single open group, and nothing for a closed one — so the virtualized
 * list sees each row as its own item and mounts only what is on screen. Every
 * record carries the primitives its row needs (state, cost, problems), computed
 * once here per change rather than inside each row on every render, so a
 * memoised row re-renders only when its own values changed.
 */

export type ReviewFilter = 'all' | EntryState;

export interface GroupRowData {
  type: 'group';
  /** The list key: `g:` + the group key, so it can never collide with a row. */
  key: string;
  groupKey: string;
  label: string;
  variant: string | null;
  summary: GroupSummary;
  /** How many of the group's rows the filter shows. */
  shown: number;
  open: boolean;
}

export interface EntryRowData {
  type: 'entry';
  key: string;
  groupKey: string;
  entryKey: string;
  source: SourceRef;
  /** IMEI 1 or the serial, as the file gave it; null when the row has neither. */
  identifier: string | null;
  /** Which kind of identifier that is, so the row can label it honestly. */
  identifierKind: 'imei' | 'serial' | null;
  imei2: string | null;
  cost: number | null;
  extractedCost: number | null;
  corrected: boolean;
  state: EntryState;
  problems: EntryProblem[];
  acceptable: boolean;
}

export type ReviewRowData = GroupRowData | EntryRowData;

/** Every group's summary, once per change, keyed by group. */
export function groupSummaries(batch: BatchState, groups: readonly EntryGroup[]): Map<string, GroupSummary> {
  return new Map(groups.map((group) => [group.key, groupSummary(batch, group)]));
}

export function entryRow(batch: BatchState, groupKey: string, entry: EntryGroup['entries'][number]): EntryRowData {
  const correction = batch.corrections[entry.key];
  return {
    type: 'entry',
    key: `e:${entry.key}`,
    groupKey,
    entryKey: entry.key,
    source: entry.source,
    identifier: entry.extracted.imei1 ?? entry.extracted.serial,
    identifierKind: entry.extracted.imei1 ? 'imei' : entry.extracted.serial ? 'serial' : null,
    imei2: effectiveImei2(batch, entry),
    cost: effectiveCost(batch, entry),
    extractedCost: entry.extracted.cost,
    corrected: Boolean(correction),
    state: entryState(batch, entry),
    problems: remainingProblems(entry, correction),
    acceptable: canAccept(batch, entry),
  };
}

/**
 * The records the list renders: one header per group the filter shows, and the
 * rows of the open group only. A group with nothing to show under the filter is
 * left out entirely; a closed group contributes exactly one record however many
 * rows it holds.
 */
export function reviewRows(
  batch: BatchState,
  groups: readonly EntryGroup[],
  summaries: ReadonlyMap<string, GroupSummary>,
  openKey: string | null,
  filter: ReviewFilter,
): ReviewRowData[] {
  const rows: ReviewRowData[] = [];
  for (const group of groups) {
    const summary = summaries.get(group.key) ?? groupSummary(batch, group);
    const shown = filter === 'all' ? group.entries : group.entries.filter((e) => entryState(batch, e) === filter);
    if (filter !== 'all' && shown.length === 0) continue;
    const open = openKey === group.key;
    rows.push({
      type: 'group',
      key: `g:${group.key}`,
      groupKey: group.key,
      label: group.label,
      variant: group.variant,
      summary,
      shown: shown.length,
      open,
    });
    if (open) for (const entry of shown) rows.push(entryRow(batch, group.key, entry));
  }
  return rows;
}

/** Only ever the one group — opening another closes this one. */
export function toggleOpenGroup(current: string | null, key: string): string | null {
  return current === key ? null : key;
}
