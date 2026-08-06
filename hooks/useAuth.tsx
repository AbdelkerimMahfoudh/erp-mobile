import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { api, clearSession } from '../lib/api-client';
import { getItem, setItem } from '../lib/storage';
import { TOKEN_KEYS } from '../constants/config';
import { useBranch } from '../lib/branch';
import { usePermissionStore } from '../lib/permissions';
import { clearCredential, deviceMeta, loadCredential, saveCredential } from '../lib/device';
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
          await adoptLegacyDevice(me.login);
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
    /*
     * Device identity (F1 Stage 3).
     *
     * A returning installation presents the credential it was issued, so the
     * server recognises the same device instead of enrolling a new one every
     * time. The credential is stored under the LOGIN because that is the only
     * identity known before the server has authenticated anyone.
     *
     * With no credential — a first sign-in, a reinstall, cleared storage, a
     * different phone — the server enrolls this installation and returns a
     * secret exactly once, which we keep. That is a new device by design.
     */
    const existing = await loadCredential(login);
    const res = await api.post<AuthResponse>('/auth/login', {
      login,
      password,
      deviceCredential: { ...deviceMeta(), ...(existing ?? {}) },
    });
    await setItem(TOKEN_KEYS.ACCESS_TOKEN, res.accessToken);
    await setItem(TOKEN_KEYS.REFRESH_TOKEN, res.refreshToken);
    await setItem(TOKEN_KEYS.USER, JSON.stringify(res.user));

    if (res.device) {
      await saveCredential(login, {
        deviceId: res.device.deviceId,
        deviceSecret: res.device.deviceSecret,
      });
    }
    setUser(res.user);
  };

  const signOut = async () => {
    try {
      const refreshToken = await getItem(TOKEN_KEYS.REFRESH_TOKEN);
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } catch {
      /* ignore */
    }
    // Forget this installation's device credential. The server keeps the
    // device row and its history — revocation is a server-side act — but this
    // installation stops being able to prove it is that device, and the logout
    // already told the server to require OTP re-verification here later.
    if (user) await clearCredential(user.login);
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

  /**
   * Re-resolve permissions when the app comes back to the foreground.
   *
   * A role can change while the app is open — an Owner promotes someone, or a
   * migration reshapes roles. The server always enforces the current truth, so
   * a stale client cannot grant anything it should not; but it can show the
   * wrong screen set until the next branch switch, which reads as the app being
   * broken. Refreshing on resume keeps what is shown honest.
   */
  useEffect(() => {
    if (!user || !branchId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void usePermissionStore.getState().refresh(branchId);
      }
    });
    return () => sub.remove();
  }, [user, branchId]);

  useProtectedRoute(user, bootstrapping, branch.branchId);

  return <AuthContext.Provider value={{ user, bootstrapping, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * One-time legacy adoption for a session created before device identity existed.
 *
 * Those sessions are still valid and must stay that way — invalidating them
 * would push every signed-in user through an OTP flow that does not exist yet.
 * So on the first launch of the updated app, the still-valid session binds once
 * to a **legacy-trusted** device and we keep the credential it returns.
 *
 * Best-effort by design: if it fails — offline, server busy — the session keeps
 * working exactly as before and the next launch tries again. Losing the network
 * must never cost anyone their session.
 */
async function adoptLegacyDevice(login: string): Promise<void> {
  try {
    if (await loadCredential(login)) return; // already has one
    const res = await api.post<{ deviceId: string; deviceSecret?: string }>('/devices/adopt', deviceMeta());
    if (res.deviceSecret) {
      await saveCredential(login, { deviceId: res.deviceId, deviceSecret: res.deviceSecret });
    }
  } catch {
    /* offline or transient — the session is untouched; try again next launch */
  }
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
