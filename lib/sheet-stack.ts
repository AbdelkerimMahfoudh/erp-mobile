import { create } from 'zustand';

/**
 * Which bottom sheets are open, in order.
 *
 * Exists for one reason: a dialog raised while a sheet is open must be drawn
 * INSIDE that sheet's own modal, not as a second native modal on top of it. On
 * iOS a second `Modal` presented over a first is not reliably shown, and a
 * confirmation nobody can see is a promise that never resolves — the button
 * spins forever. So the root dialog host yields while any sheet is open, and
 * the top-most sheet renders the dialog itself.
 */
interface SheetStack {
  ids: string[];
  push: (id: string) => void;
  remove: (id: string) => void;
}

export const useSheetStack = create<SheetStack>((set) => ({
  ids: [],
  push: (id) => set((s) => ({ ids: [...s.ids.filter((x) => x !== id), id] })),
  remove: (id) => set((s) => ({ ids: s.ids.filter((x) => x !== id) })),
}));

/** Is this sheet the one on top — the one that should draw a dialog? */
export function isTopSheet(ids: readonly string[], id: string): boolean {
  return ids.length > 0 && ids[ids.length - 1] === id;
}
