import { create } from 'zustand';
import type { BatchState, Correction, ParseResult } from './file-receiving';

/**
 * The batch being reviewed, held outside the screen.
 *
 * A hundred phones are parsed once and then corrected, filtered and confirmed
 * across several renders; keeping them in a store means the review can be left
 * and come back to (a Create product detour, for instance) without re-uploading
 * the file. It is cleared deliberately — after a successful receipt, or when the
 * person cancels — and never on its own.
 *
 * It holds no draft of the SCANNED delivery: `receive.preparation` is a
 * separate key, so starting a file batch never disturbs a part-built delivery.
 */

interface FileBatchStore {
  batch: BatchState | null;
  /** Set when a file has been read and the review may open. */
  start: (parsed: ParseResult) => void;
  /** Put back a batch saved as a draft, corrections and exclusions included. */
  restore: (batch: BatchState) => void;
  correct: (key: string, correction: Correction) => void;
  /** An explicit bulk edit. Returns how many phones it actually changed. */
  correctMany: (keys: readonly string[], correction: Correction) => number;
  setExcluded: (key: string, excluded: boolean) => void;
  excludeMany: (keys: readonly string[], excluded: boolean) => void;
  /** Accept a row — reviewed and waved through its advisory flag. */
  setAcknowledged: (key: string, acknowledged: boolean) => void;
  clear: () => void;
}

export const useFileBatch = create<FileBatchStore>((set, get) => ({
  batch: null,
  start: (parsed) => set({ batch: { parsed, corrections: {}, excluded: [], acknowledged: [] } }),
  // An older draft may predate acknowledgement; default it so the review opens.
  restore: (batch) => set({ batch: { ...batch, acknowledged: batch.acknowledged ?? [] } }),
  correct: (key, correction) =>
    set((s) =>
      s.batch
        ? {
            batch: {
              ...s.batch,
              corrections: { ...s.batch.corrections, [key]: { ...s.batch.corrections[key], ...correction } },
            },
          }
        : s,
    ),
  correctMany: (keys, correction) => {
    const batch = get().batch;
    if (!batch || keys.length === 0) return 0;
    const corrections = { ...batch.corrections };
    for (const key of keys) corrections[key] = { ...corrections[key], ...correction };
    set({ batch: { ...batch, corrections } });
    return keys.length;
  },
  setExcluded: (key, excluded) =>
    set((s) => {
      if (!s.batch) return s;
      const next = s.batch.excluded.filter((k) => k !== key);
      if (excluded) next.push(key);
      return { batch: { ...s.batch, excluded: next } };
    }),
  excludeMany: (keys, excluded) =>
    set((s) => {
      if (!s.batch) return s;
      const set2 = new Set(s.batch.excluded);
      for (const k of keys) {
        if (excluded) set2.add(k);
        else set2.delete(k);
      }
      return { batch: { ...s.batch, excluded: [...set2] } };
    }),
  setAcknowledged: (key, acknowledged) =>
    set((s) => {
      if (!s.batch) return s;
      const next = (s.batch.acknowledged ?? []).filter((k) => k !== key);
      if (acknowledged) next.push(key);
      return { batch: { ...s.batch, acknowledged: next } };
    }),
  clear: () => set({ batch: null }),
}));
