import { create } from 'zustand';
import { api, ApiError } from './api-client';
import { useBranch } from './branch';
import { classifyPermissionFailure } from './branch-recovery';
import { toErrorMessage } from './errors';

/**
 * Frontend permission awareness.
 *
 * ⚠️ This is UX, not security. The server is the only authority: every
 * endpoint is guarded by `@RequirePermissions`, and money fields are stripped
 * by the cost-gating interceptor regardless of what the client believes. What
 * this layer buys is honesty — a sales employee should not be shown a profit
 * tile that renders `—`, or a Transfers button that will 403. Hiding what a
 * role cannot use is the difference between "this app is not for that" and
 * "this app is broken".
 *
 * Never use this to protect data. Use it to avoid lying to the user.
 */

/**
 * The 19-permission catalogue, mirroring `prisma/seed-data/permissions.ts`.
 * Kept as a literal union so a typo is a compile error rather than a
 * permanently-false check that silently hides a feature forever.
 */
export const PERMISSIONS = [
  'sale.create',
  'sale.return',
  'cost.view',
  'discount.apply',
  'discount.override',
  'unit.add',
  'unit.transfer',
  'import.run',
  'purchase.manage',
  'supplier.manage',
  'expense.manage',
  'closing.perform',
  'report.view',
  'branch.manage',
  'user.manage',
  'settings.manage',
  'integrations.manage',
  'price.edit',
  'catalog.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

interface PermissionsResponse {
  branchId: string | null;
  permissions: string[];
}

export type PermissionStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PermissionState {
  granted: ReadonlySet<Permission>;
  /** Which branch the current set was resolved for — permissions are per-branch. */
  branchId: string | null;
  status: PermissionStatus;
  error: string | null;
  load: (branchId: string | null) => Promise<void>;
  /** Force a re-resolve even if this branch is already loaded. */
  refresh: (branchId: string | null) => Promise<void>;
  clear: () => void;
}

const EMPTY: ReadonlySet<Permission> = new Set<Permission>();

export const usePermissionStore = create<PermissionState>((set, get) => ({
  granted: EMPTY,
  branchId: null,
  status: 'idle',
  error: null,

  load: async (branchId) => {
    // Roles are assigned per branch, so switching branches must re-resolve.
    // Skip only when the same branch is already loaded.
    const state = get();
    if (state.status === 'loading') return;
    if (state.status === 'ready' && state.branchId === branchId) return;

    // Drop the previous branch's grants before resolving the new ones. Holding
    // them would briefly show a manager their old branch's controls while the
    // request for a branch where they are only an employee is still in flight.
    set({ granted: EMPTY, status: 'loading', error: null });
    try {
      const res = await api.get<PermissionsResponse>('/auth/permissions');
      // Replace the Set wholesale — mutating it in place would not re-render.
      const granted = new Set(res.permissions as Permission[]);
      set({ granted, branchId, status: 'ready', error: null });
    } catch (e) {
      /**
       * A restored session can still be holding a branch the user has since
       * been removed from. The server answers 403 honestly, but retrying with
       * that same branch can only ever 403 again — leaving the tab bar on an
       * error screen whose only button is Retry, with no way out of the app.
       *
       * Dropping the branch is the escape: routing sends a user with no branch
       * to the branch picker, which lists the branches they *do* have.
       */
      if (classifyPermissionFailure(e instanceof ApiError ? e.status : undefined) === 'reselect_branch') {
        useBranch.getState().clear();
        set({ granted: EMPTY, branchId: null, status: 'idle', error: null });
        return;
      }
      // Fail closed: an unresolved permission set grants nothing.
      set({ granted: EMPTY, status: 'error', error: toErrorMessage(e) });
    }
  },

  refresh: async (branchId) => {
    // Deliberately does NOT clear first: a brief empty set would flicker the
    // UI on every resume. The server is the authority either way.
    try {
      const res = await api.get<PermissionsResponse>('/auth/permissions');
      set({ granted: new Set(res.permissions as Permission[]), branchId, status: 'ready', error: null });
    } catch {
      // Keep the last known set; the next load or resume will try again.
    }
  },

  clear: () => set({ granted: EMPTY, branchId: null, status: 'idle', error: null }),
}));

/**
 * Whether the active role has a permission.
 *
 * False until the set has loaded — controls appear as access is confirmed,
 * rather than flashing on screen and vanishing.
 */
export function usePermission(permission: Permission): boolean {
  return usePermissionStore((s) => s.granted.has(permission));
}

/** True when the role has at least one of these. */
export function useAnyPermission(permissions: Permission[]): boolean {
  return usePermissionStore((s) => permissions.some((p) => s.granted.has(p)));
}

/** True only when the role has all of these. */
export function useAllPermissions(permissions: Permission[]): boolean {
  return usePermissionStore((s) => permissions.every((p) => s.granted.has(p)));
}

/**
 * Cost and profit visibility.
 *
 * Its own hook because it is checked constantly and reads better at call
 * sites than a bare string. When false, the server has already stripped
 * `cost`, `margin` and profit fields — so the UI must omit those elements
 * rather than render them empty.
 */
export function useCanViewCost(): boolean {
  return usePermission('cost.view');
}

export function usePermissionStatus(): PermissionStatus {
  return usePermissionStore((s) => s.status);
}

/** Non-reactive read, for imperative code (guards, handlers, navigation). */
export function hasPermission(permission: Permission): boolean {
  return usePermissionStore.getState().granted.has(permission);
}
