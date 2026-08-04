import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { api, clearSession } from '../lib/api-client';
import { getItem, setItem } from '../lib/storage';
import { TOKEN_KEYS } from '../constants/config';
import { useBranch } from '../lib/branch';
import { usePermissionStore } from '../lib/permissions';
import type { AuthResponse, AuthUser } from '../types/api';

interface AuthContextValue {
  user: AuthUser | null;
  bootstrapping: boolean;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const branch = useBranch();

  useEffect(() => {
    (async () => {
      try {
        const token = await getItem(TOKEN_KEYS.ACCESS_TOKEN);
        if (token) {
          const me = await api.get<AuthUser>('/auth/me');
          setUser(me);
          await branch.hydrate();
        }
      } catch {
        await clearSession();
      } finally {
        setBootstrapping(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (login: string, password: string) => {
    const res = await api.post<AuthResponse>('/auth/login', { login, password });
    await setItem(TOKEN_KEYS.ACCESS_TOKEN, res.accessToken);
    await setItem(TOKEN_KEYS.REFRESH_TOKEN, res.refreshToken);
    await setItem(TOKEN_KEYS.USER, JSON.stringify(res.user));
    setUser(res.user);
  };

  const signOut = async () => {
    try {
      const refreshToken = await getItem(TOKEN_KEYS.REFRESH_TOKEN);
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } catch {
      /* ignore */
    }
    await clearSession();
    branch.clear();
    usePermissionStore.getState().clear();
    setUser(null);
  };

  /**
   * Resolve permissions once a user and a branch are both known.
   *
   * Roles are assigned per branch, so this re-runs on every branch switch —
   * a manager of one branch may be an employee in another. The store skips
   * redundant loads itself.
   */
  const branchId = branch.branchId;
  useEffect(() => {
    if (!user || !branchId) {
      // No branch selected (signed out, or switching) — grant nothing.
      usePermissionStore.getState().clear();
      return;
    }
    void usePermissionStore.getState().load(branchId);
  }, [user, branchId]);

  useProtectedRoute(user, bootstrapping, branch.branchId);

  return <AuthContext.Provider value={{ user, bootstrapping, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Redirect based on auth + branch state: login → select-branch → tabs. */
function useProtectedRoute(user: AuthUser | null, bootstrapping: boolean, branchId: string | null) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (bootstrapping) return;
    const inAuth = segments[0] === '(auth)';
    const onSelectBranch = segments[0] === 'select-branch';
    /**
     * `app/index.tsx` is only a splash while auth bootstraps. Nothing renders
     * past it, so a session restored at the root — reopening the app, or a
     * cold web load — would sit on that spinner forever unless we move on.
     */
    const atRoot = segments[0] === undefined;

    // The design-system gallery renders without a session so components can be
    // reviewed without a login. It is a development route only.
    if (segments[0] === 'dev') return;

    if (!user && !inAuth) {
      router.replace('/(auth)/login');
    } else if (user && !branchId && !onSelectBranch) {
      router.replace('/select-branch');
    } else if (user && branchId && (inAuth || onSelectBranch || atRoot)) {
      router.replace('/(tabs)');
    }
  }, [user, bootstrapping, branchId, segments, router]);
}
