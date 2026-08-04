import { create } from 'zustand';
import { TOKEN_KEYS } from '../constants/config';
import { getItem, setItem, deleteItem } from './storage';
import type { UserBranch } from '../types/api';

// Module-level mirror so the API client can read the active branch synchronously
// (it can't call a React hook) when injecting the X-Branch-Id header.
let activeBranchId: string | null = null;
export function getActiveBranchId(): string | null {
  return activeBranchId;
}

interface BranchState {
  branchId: string | null;
  branchName: string | null;
  role: string | null;
  setBranch: (b: UserBranch) => void;
  hydrate: () => Promise<void>;
  clear: () => void;
}

export const useBranch = create<BranchState>((set) => ({
  branchId: null,
  branchName: null,
  role: null,
  setBranch: (b) => {
    activeBranchId = b.id;
    void setItem(TOKEN_KEYS.BRANCH, JSON.stringify(b));
    set({ branchId: b.id, branchName: b.name, role: b.role });
  },
  hydrate: async () => {
    const raw = await getItem(TOKEN_KEYS.BRANCH);
    if (!raw) return;
    try {
      const b = JSON.parse(raw) as UserBranch;
      activeBranchId = b.id;
      set({ branchId: b.id, branchName: b.name, role: b.role });
    } catch {
      /* ignore */
    }
  },
  clear: () => {
    activeBranchId = null;
    void deleteItem(TOKEN_KEYS.BRANCH);
    set({ branchId: null, branchName: null, role: null });
  },
}));
