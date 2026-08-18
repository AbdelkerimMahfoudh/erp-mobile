import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { api, clearSession } from '../lib/api-client';
import { getItem, setItem } from '../lib/storage';
import { TOKEN_KEYS } from '../constants/config';
import { useBranch } from '../lib/branch';
import { usePermissionStore } from '../lib/permissions';
import { useSyncEngine } from '../lib/offline/use-sync';
import {
  clearLegacyCredential,
  deviceMeta,
  loadCredential,
  loadLegacyCredential,
  migrateLegacyCredential,
  rememberStoreId,
  saveCredential,
} from '../lib/device';
import type { AuthResponse, AuthUser } from '../types/api';

interface AuthContextValue {
  user: AuthUser | null;
  bootstrapping: boolean;
  signIn: (storeAccountId: string, login: string, password: string) => Promise<void>;
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
          await onRestoredSession(me);
        }
      } catch {
        await clearSession();
      } finally {
        setBootstrapping(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (storeAccountId: string, login: string, password: string) => {
    /*
     * Device identity (F1 Stage 3 / 3.1 / 3.2).
     *
     * The credential is namespaced by Store ID + login now that the Store
     * Account ID is known before login. We present the company-scoped
     * credential; if there is none but a pre-3.2 login-only credential exists,
     * we present THAT — and if the server recognises it for this company, we
     * migrate it into the scoped key. If neither exists, no credential is sent
     * and the server enrolls a new device.
     *
     * The server FAILS CLOSED on a credential it cannot verify. There is NO
     * client retry: the error propagates untouched (the credential is kept) and
     * the login screen shows a blocking device-verification state. See CP1.
     */
    const typedStoreId = storeAccountId;
    let presented = await loadCredential(typedStoreId, login);
    let fromLegacy = false;
    if (!presented) {
      const legacy = await loadLegacyCredential(login);
      if (legacy) {
        presented = legacy;
        fromLegacy = true;
      }
    }

    const res = await api.post<AuthResponse>('/auth/login', {
      storeAccountId,
      login,
      password,
      deviceCredential: { ...deviceMeta(), ...(presented ?? {}) },
    });

    await setItem(TOKEN_KEYS.ACCESS_TOKEN, res.accessToken);
    await setItem(TOKEN_KEYS.REFRESH_TOKEN, res.refreshToken);
    await setItem(TOKEN_KEYS.USER, JSON.stringify(res.user));

    // Key everything by the SERVER's canonical Store ID, so login-save and
    // restore-load always agree. Remembering it is fine — it is not a secret.
    const storeId = res.user.publicStoreId;
    await rememberStoreId(storeId);

    if (res.device) {
      // Newly enrolled device: keep its secret under the scoped key.
      await saveCredential(storeId, login, {
        deviceId: res.device.deviceId,
        deviceSecret: res.device.deviceSecret,
      });
    } else if (fromLegacy && presented) {
      // The server recognised the legacy pair for THIS company — migrate it into
      // the scoped key, then drop the ambiguous login-only key.
      await saveCredential(storeId, login, presented);
      await clearLegacyCredential(login);
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
    // Remove SESSION material only (access + refresh). The device credential is
    // deliberately KEPT: logout told the server to set `reverifyRequired` on
    // THIS device, and that flag only means something if the next sign-in
    // presents the same device to re-verify (Stage 4). Clearing it here would
    // abandon the device and make the flag vestigial. The credential is not a
    // session — it proves "same phone", not "signed in" — and it is keyed per
    // login, so it is useless to anyone who cannot also enter this login's
    // password. It is forgotten only when the server fails it closed (signIn).
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

  /**
   * The offline queue follows the session (Milestone J).
   *
   * Placed here because the queue's identity IS the session: one file per
   * user, company and branch, so a shared counter phone never shows one
   * employee another's unsent work, and nothing can replay under a company it
   * was not created in.
   */
  useSyncEngine({
    companyId: user?.companyId ?? null,
    branchId: branch.branchId ?? null,
    userId: user?.id ?? null,
  });

  useProtectedRoute(user, bootstrapping, branch.branchId);

  return <AuthContext.Provider value={{ user, bootstrapping, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Restored-session device handling on launch (F1 Stage 3.2). We now know the
 * user's Store ID from `/auth/me`, so:
 *
 *  1. Migrate a pre-3.2 login-only credential into the company-scoped key — a
 *     safe migration because the Store ID comes from the user's OWN session, so
 *     it can never land in another company's namespace (write-before-delete,
 *     one-time, idempotent).
 *  2. If there is still no scoped credential, adopt the device for this
 *     pre-Stage-3 session (bind it once to a legacy-trusted device).
 *
 * Best-effort: if it fails — offline, server busy — the session keeps working
 * and the next launch tries again. Losing the network never costs a session,
 * and none of this asks for OTP or re-verification.
 */
async function onRestoredSession(me: AuthUser): Promise<void> {
  try {
    const storeId = me.publicStoreId;
    await migrateLegacyCredential(storeId, me.login);
    if (await loadCredential(storeId, me.login)) return; // has a scoped credential now
    const res = await api.post<{ deviceId: string; deviceSecret?: string }>('/devices/adopt', deviceMeta());
    if (res.deviceSecret) {
      await saveCredential(storeId, me.login, { deviceId: res.deviceId, deviceSecret: res.deviceSecret });
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
