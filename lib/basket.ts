import { create } from 'zustand';

/**
 * What Stock hands to the one current sale (D227), and what the sale tells Stock back for its badge. The basket itself stays
 * the Sell screen's draft, which is per person and store and goes with sign-out; nothing here is stored or reserved, and
 * the server decides at Charge. Holds only product references and shop-facing labels.
 */
export type BasketPick =
  | { kind: 'unit'; identifier: string }
  | { kind: 'quantity'; productId: string; label: string; variant: string | null; price: number };

interface BasketState {
  count: number;
  total: number;
  picks: BasketPick[];
  queue: (picks: BasketPick[]) => void;
  take: () => BasketPick[];
  setSummary: (count: number, total: number) => void;
  reset: () => void;
}

export const useBasket = create<BasketState>((set, get) => ({
  count: 0,
  total: 0,
  picks: [],
  queue: (picks) => set((s) => ({ picks: [...s.picks, ...picks] })),
  take: () => {
    const { picks } = get();
    set({ picks: [] });
    return picks;
  },
  setSummary: (count, total) => set({ count, total }),
  reset: () => set({ count: 0, total: 0, picks: [] }),
}));

interface Identified {
  key: string;
  kind: string;
  identifier?: string;
  productId?: string;
  quantity: number;
}

const same = (a: Identified, b: Identified) =>
  a.kind === b.kind && (a.kind === 'unit' ? a.identifier === b.identifier : a.productId === b.productId);

/**
 * A draft restored after Stock has already added to the sale: both kept. A device appears once; a counted product's
 * quantities add up, so restoring can never lose what was just chosen.
 */
export function mergeLines<T extends Identified>(restored: readonly T[], current: readonly T[]): T[] {
  const merged = [...restored];
  for (const line of current) {
    const at = merged.findIndex((m) => same(m, line));
    if (at < 0) merged.push(line);
    else if (line.kind !== 'unit') merged[at] = { ...merged[at]!, quantity: merged[at]!.quantity + line.quantity };
  }
  return merged;
}
