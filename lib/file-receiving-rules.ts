
/**
 * Receiving a delivery from a file.
 *
 * The server reads the file and says what is in it; **nothing is received until
 * the person confirms**, and confirmation goes through the ordinary
 * `POST /purchases` — the same paid-in-full, atomic, idempotent path a scanned
 * delivery uses. This module holds the parsed batch, the corrections made to
 * it, and the rules that decide what may be confirmed.
 *
 * Two values are kept apart on purpose: what the file said (`extracted`) and
 * what a person changed (`corrections`). A bulk edit never overwrites the
 * original, and the review can always show both.
 */

export type EntryProblem =
  | 'imei1_missing'
  | 'imei1_invalid'
  | 'imei1_rounded'
  | 'imei2_invalid'
  | 'imei2_same_as_imei1'
  | 'imei2_rounded'
  | 'model_missing'
  | 'cost_missing'
  | 'cost_invalid'
  | 'duplicate_in_file'
  | 'duplicate_in_stock'
  | 'product_unknown'
  | 'product_ambiguous'
  | 'formula_value';

export interface SourceRef {
  sheet: string | null;
  row: number | null;
  page: number | null;
}

export interface Extracted {
  reference: string | null;
  category: string | null;
  brand: string | null;
  model: string | null;
  storage: string | null;
  colour: string | null;
  condition: string | null;
  imei1: string | null;
  imei2: string | null;
  serial: string | null;
  cost: number | null;
  currency: string | null;
}

export interface FileEntry {
  key: string;
  source: SourceRef;
  extracted: Extracted;
  problems: EntryProblem[];
}

export interface CatalogueProduct {
  id: string;
  brand: string;
  model: string;
  variant: string | null;
  trackingType: 'imei' | 'serial' | 'quantity';
}

export interface SheetSummary {
  name: string;
  rows: number;
  columns: { index: number; heading: string; field: string | null }[];
  missing: string[];
  selected: boolean;
  looksExplanatory: boolean;
}

export interface ParseResult {
  source: 'xlsx' | 'pdf';
  filename: string;
  sheets: SheetSummary[];
  entries: FileEntry[];
  matches: Record<string, { productId: string | null; candidates: CatalogueProduct[]; exact: boolean }>;
  counts: { phones: number; ready: number; needsAttention: number; excluded: number; selectedCost: number };
  imageOnlyPages: number[];
  pages: number | null;
}

/** A person's change to one phone. Only the fields they actually touched. */
export interface Correction {
  productId?: string;
  cost?: number;
  imei2?: string | null;
}

export interface BatchState {
  parsed: ParseResult;
  corrections: Record<string, Correction>;
  excluded: string[];
}

// ── what the review shows ───────────────────────────────────────────────────

export type EntryState = 'ready' | 'needs_attention' | 'excluded';

/** Problems a correction has answered are no longer problems. */
export function remainingProblems(entry: FileEntry, correction: Correction | undefined): EntryProblem[] {
  return entry.problems.filter((p) => {
    if (correction?.productId && (p === 'product_unknown' || p === 'product_ambiguous')) return false;
    if (correction?.cost !== undefined && (p === 'cost_missing' || p === 'cost_invalid')) return false;
    if (correction?.imei2 !== undefined && (p === 'imei2_invalid' || p === 'imei2_same_as_imei1' || p === 'imei2_rounded')) {
      return false;
    }
    return true;
  });
}

export function entryState(batch: BatchState, entry: FileEntry): EntryState {
  if (batch.excluded.includes(entry.key)) return 'excluded';
  return remainingProblems(entry, batch.corrections[entry.key]).length === 0 ? 'ready' : 'needs_attention';
}

export function effectiveCost(batch: BatchState, entry: FileEntry): number | null {
  return batch.corrections[entry.key]?.cost ?? entry.extracted.cost;
}

export function effectiveProductId(batch: BatchState, entry: FileEntry): string | null {
  return batch.corrections[entry.key]?.productId ?? batch.parsed.matches[entry.key]?.productId ?? null;
}

export function effectiveImei2(batch: BatchState, entry: FileEntry): string | null {
  const correction = batch.corrections[entry.key];
  return correction && 'imei2' in correction ? correction.imei2 ?? null : entry.extracted.imei2;
}

export interface BatchCounts {
  phones: number;
  ready: number;
  needsAttention: number;
  excluded: number;
  selectedCost: number;
}

export function batchCounts(batch: BatchState): BatchCounts {
  let ready = 0;
  let needsAttention = 0;
  let excluded = 0;
  let selectedCost = 0;
  for (const entry of batch.parsed.entries) {
    const state = entryState(batch, entry);
    if (state === 'excluded') excluded += 1;
    else if (state === 'ready') {
      ready += 1;
      selectedCost += effectiveCost(batch, entry) ?? 0;
    } else needsAttention += 1;
  }
  return {
    phones: batch.parsed.entries.length,
    ready,
    needsAttention,
    excluded,
    selectedCost: Math.round(selectedCost * 100) / 100,
  };
}

/** Nothing may be confirmed while a phone is neither fixed nor excluded. */
export function canConfirm(batch: BatchState): boolean {
  const counts = batchCounts(batch);
  return counts.needsAttention === 0 && counts.ready > 0;
}

export interface EntryGroup {
  key: string;
  category: string | null;
  label: string;
  variant: string | null;
  entries: FileEntry[];
}

/** Grouped by category, product and exact variant — how a delivery is read. */
export function groupEntries(batch: BatchState): EntryGroup[] {
  const groups = new Map<string, EntryGroup>();
  for (const entry of batch.parsed.entries) {
    const e = entry.extracted;
    const label = [e.brand, e.model].filter(Boolean).join(' ') || e.reference || '—';
    const variant = [e.storage ? `${e.storage} GB` : null, e.colour].filter(Boolean).join(' · ') || null;
    const key = `${e.category ?? ''}|${label}|${variant ?? ''}`;
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { key, category: e.category, label, variant, entries: [entry] });
  }
  return [...groups.values()];
}

// ── confirming ──────────────────────────────────────────────────────────────

export interface PurchaseItem {
  productId: string;
  unitCost: number;
  units: { identifier: string; imeiSecondary?: string }[];
}

/**
 * The phones to receive, as `POST /purchases` takes them.
 *
 * One item per product AND cost: the endpoint prices a whole item, so two
 * phones of the same model bought at different prices are two items — folding
 * them together would receive one of them at the other's cost.
 */
export function purchaseItems(batch: BatchState): PurchaseItem[] {
  const items = new Map<string, PurchaseItem>();
  for (const entry of batch.parsed.entries) {
    if (entryState(batch, entry) !== 'ready') continue;
    const productId = effectiveProductId(batch, entry);
    const cost = effectiveCost(batch, entry);
    const identifier = entry.extracted.imei1 ?? entry.extracted.serial;
    if (!productId || cost === null || !identifier) continue;
    const key = `${productId}@${cost}`;
    const unit = { identifier, ...(effectiveImei2(batch, entry) ? { imeiSecondary: effectiveImei2(batch, entry) as string } : {}) };
    const item = items.get(key);
    if (item) item.units.push(unit);
    else items.set(key, { productId, unitCost: cost, units: [unit] });
  }
  return [...items.values()];
}

/**
 * A key bound to what is being received.
 *
 * The same batch retried after a timeout replays and returns the same receipt;
 * a batch someone edited hashes differently, so the server's own fingerprint
 * check refuses to answer with the earlier one.
 */
export function batchFingerprint(items: PurchaseItem[], payment: { method: string; receivingAccountId: string | null }): string {
  const canonical = JSON.stringify({
    payment,
    items: items
      .map((i) => ({
        productId: i.productId,
        unitCost: i.unitCost,
        units: [...i.units].map((u) => `${u.identifier}:${u.imeiSecondary ?? ''}`).sort(),
      }))
      .sort((a, b) => (a.productId + a.unitCost).localeCompare(b.productId + b.unitCost)),
  });
  // FNV-1a, enough to notice a changed payload; the server hashes the real one.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    h1 = Math.imul(h1 ^ canonical.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + canonical.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const seed = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex((h1 + h2) >>> 0);
  // Shaped as a UUID so it satisfies the endpoint's `clientUuid` contract.
  return [seed.slice(0, 8), seed.slice(8, 12), '4' + seed.slice(13, 16), '8' + seed.slice(17, 20), seed.slice(20, 32)].join('-');
}

// ── saying what actually went wrong ─────────────────────────────────────────

/**
 * Which message to show when reading the file fails.
 *
 * Every failure used to arrive as one sentence — "That file could not be read"
 * — which pointed at the workbook even when the workbook was fine. It hid a
 * backend that had not been restarted and was answering 404 to an endpoint it
 * did not yet have: the phone said the file was bad, and the file was perfect.
 *
 * `status` is the HTTP status, or `null` when the request never arrived at all.
 */
/** The messages this mapping can choose between. */
export type FileFailureKey =
  | 'fileReceive.error.offline'
  | 'fileReceive.error.endpointMissing'
  | 'fileReceive.error.unauthorized'
  | 'fileReceive.error.forbidden'
  | 'fileReceive.error.noBranch'
  | 'fileReceive.error.tooLarge'
  | 'fileReceive.error.empty'
  | 'fileReceive.error.unsupported'
  | 'fileReceive.error.corrupt'
  | 'fileReceive.error.noSheet'
  | 'fileReceive.error.pdfImageOnly'
  | 'fileReceive.error.server'
  | 'fileReceive.failed';

export function parseFailureKey(status: number | null, code?: string | null): FileFailureKey {
  if (status === null || status === 0 || code === 'offline') return 'fileReceive.error.offline';
  switch (code) {
    case 'file_missing':
      return 'fileReceive.error.empty';
    case 'file_empty':
      return 'fileReceive.error.noSheet';
    case 'file_too_large':
      return 'fileReceive.error.tooLarge';
    case 'file_type_unsupported':
      return 'fileReceive.error.unsupported';
    case 'file_unreadable':
      return 'fileReceive.error.corrupt';
    case 'pdf_image_only':
      return 'fileReceive.error.pdfImageOnly';
    case 'pdf_no_table':
      return 'fileReceive.error.noSheet';
    default:
      break;
  }
  if (status === 401) return 'fileReceive.error.unauthorized';
  if (status === 403) return 'fileReceive.error.forbidden';
  if (status === 404) return 'fileReceive.error.endpointMissing';
  if (status === 413) return 'fileReceive.error.tooLarge';
  if (status === 400 || status === 422) return 'fileReceive.error.unsupported';
  if (status >= 500) return 'fileReceive.error.server';
  return 'fileReceive.failed';
}
