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

/** Set once the branch is chosen, restored or cleared explicitly: the startup read below never overrides that. */
let settled = false;

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
    settled = true;
    activeBranchId = b.id;
    void setItem(TOKEN_KEYS.BRANCH, JSON.stringify(b));
    set({ branchId: b.id, branchName: b.name, role: b.role });
  },
  hydrate: async () => {
    settled = true;
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
    settled = true;
    activeBranchId = null;
    void deleteItem(TOKEN_KEYS.BRANCH);
    set({ branchId: null, branchName: null, role: null });
  },
}));

/**
 * The branch this device last worked in, read from storage the moment the app starts.
 *
 * A screen opened directly — a web reload, a link from a notification — mounts and asks for its figures
 * before the sign-in bootstrap has restored anything, and a request sent in that instant carried no
 * `X-Branch-Id`: the server, correctly, refused every branch-scoped read once (403, or 400 where the header
 * is required) before the screen recovered. The API client waits for this read before sending anything,
 * so no request leaves without the branch the device already knows.
 *
 * Only with a stored session (a branch without one is left for the next sign-in to choose), and never over
 * a choice made meanwhile: an explicit choice, restore or sign-out always wins.
 */
const restored: Promise<void> = (async () => {
  try {
    const [token, raw] = await Promise.all([getItem(TOKEN_KEYS.ACCESS_TOKEN), getItem(TOKEN_KEYS.BRANCH)]);
    if (!token || !raw || settled) return;
    const b = JSON.parse(raw) as UserBranch;
    activeBranchId = b.id;
    useBranch.setState({ branchId: b.id, branchName: b.name, role: b.role });
  } catch {
    // Nothing stored, or unreadable: the sign-in bootstrap decides, as before.
  }
})();

export function branchRestored(): Promise<void> {
  return restored;
}
