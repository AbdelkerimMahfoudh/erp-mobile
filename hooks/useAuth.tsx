import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { api, clearSession } from '../lib/api-client';
import { getItem, setItem } from '../lib/storage';
import { TOKEN_KEYS } from '../constants/config';
import { useBranch } from '../lib/branch';
import { usePermissionStore } from '../lib/permissions';
import { clearExports } from '../lib/report-export';
import { useSyncEngine } from '../lib/offline/use-sync';
import {
  clearLegacyCredential,
  deviceMeta,
  loadCredential,
  migrateLegacyCredential,
  rememberStoreId,
  saveCredential,
} from '../lib/device';

import type { AccountChoice, AuthResponse, AuthUser, LoginResult } from '../types/api';
import { isAccountChoice } from '../types/api';
import { credentialNamespace } from '../lib/identifier';

/**
 * The second half of the credential key, now that there is no login to put
 * there. A constant rather than an empty string, so the stored key reads as a
 * deliberate scheme rather than a missing value.
 */
const IDENTIFIER_SCOPE = 'id';

interface AuthContextValue {
  user: AuthUser | null;
  bootstrapping: boolean;
  /**
   * One identifier — a phone number or a personal ID — and a password.
   * No Store ID: the server resolves the shop from the credential.
   *
   * Resolves to `null` on a normal sign-in. When one phone number turns out to
   * belong to a person at more than one shop, it resolves to the choice
   * instead, and the caller finishes with {@link chooseAccount}.
   */
  signIn: (identifier: string, password: string) => Promise<AccountChoice | null>;
  /** Finish a sign-in that needed a shop picked. The password is not asked again. */
  chooseAccount: (choice: AccountChoice, accountRef: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Install a session issued by completing a registration. */
  adoptSession: (tokens: { accessToken: string; refreshToken: string }) => Promise<AuthUser>;
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

  /**
   * The device namespace of the sign-in attempt currently awaiting a shop
   * choice. A ref, not state: it must not cause a render, and it must be gone
   * the moment the attempt is finished or abandoned.
   */
  const pendingNamespace = useRef<string | null>(null);

  const signIn = async (identifier: string, password: string) => {
    /*
     * Device identity (F1 Stage 3 / 3.1 / 3.2, renamespaced in CP3).
     *
     * The credential used to be namespaced by Store ID + login, both known
     * before the request. Neither is now — that is the whole point of the
     * change — so it is namespaced by the identifier the person typed,
     * folded to one form so `4321 0987` and `43210987` are the same device.
     *
     * Somebody who signs in by phone one day and by personal ID the next
     * finds no credential and the server enrols a new device. That is safe:
     * enrolment happens only after the password is verified. It is also far
     * better than presenting a credential belonging to a different key, which
     * the server would fail closed on — locking them out of their own shop.
     *
     * The pre-3.2 login-only credential can no longer be PRESENTED, because
     * presenting it needed a login the client no longer has before
     * authenticating. Those devices simply re-enrol on first sign-in, and the
     * stale key is cleared below once we know who they are.
     *
     * The server FAILS CLOSED on a credential it cannot verify. There is NO
     * client retry: the error propagates untouched and the login screen shows
     * a blocking device-verification state. See CP1.
     */
    const namespace = credentialNamespace(identifier);
    const presented = await loadCredential(namespace, IDENTIFIER_SCOPE);

    const res = await api.post<LoginResult>('/auth/login', {
      identifier: identifier.trim(),
      password,
      deviceCredential: { ...deviceMeta(), ...(presented ?? {}) },
    });

    /*
     * Ambiguous, and the server says so instead of guessing. Nothing is stored
     * and nobody is signed in yet: the caller shows the shops and comes back
     * through `chooseAccount`. The namespace is carried in the closure of that
     * call rather than in state, so a half-finished attempt leaves nothing
     * behind if the screen is abandoned.
     */
    if (isAccountChoice(res)) {
      pendingNamespace.current = namespace;
      return res;
    }

    await establish(res, namespace);
    return null;
  };

  const chooseAccount = async (choice: AccountChoice, accountRef: string) => {
    const namespace = pendingNamespace.current;
    if (!namespace) throw new Error('No sign-in is waiting for a shop to be chosen.');

    const res = await api.post<AuthResponse>('/auth/choose-account', {
      continuationToken: choice.continuationToken,
      accountRef,
      deviceCredential: { ...deviceMeta(), ...((await loadCredential(namespace, IDENTIFIER_SCOPE)) ?? {}) },
    });

    pendingNamespace.current = null;
    await establish(res, namespace);
  };

  /**
   * Everything that happens once the server has issued tokens — shared by the
   * direct sign-in and the shop chooser, so the rarer path cannot drift away
   * from the common one.
   */
  const establish = async (res: AuthResponse, namespace: string) => {
    await setItem(TOKEN_KEYS.ACCESS_TOKEN, res.accessToken);
    await setItem(TOKEN_KEYS.REFRESH_TOKEN, res.refreshToken);
    await setItem(TOKEN_KEYS.USER, JSON.stringify(res.user));

    /*
      Still remembered, but no longer to sign in with — nobody types it now.
      It stays because other surfaces show it as support information, and
      because it keys nothing secret.
    */
    await rememberStoreId(res.user.publicStoreId);

    if (res.device) {
      // Newly enrolled: keep its secret under the identifier namespace, so the
      // next sign-in with the same identifier is recognised.
      await saveCredential(namespace, IDENTIFIER_SCOPE, {
        deviceId: res.device.deviceId,
        deviceSecret: res.device.deviceSecret,
      });
    }

    // Now that the login is known, retire any pre-3.2 key for it. It can never
    // be presented again, and leaving it would be dead credential material.
    await clearLegacyCredential(res.user.login);
    setUser(res.user);
  };

  /**
   * Adopt the session a completed registration returned.
   *
   * Registration ends with an ordinary session — the same kind a password
   * sign-in produces — so the only difference here is where the tokens came
   * from. The password is NOT replayed to obtain them, and is not kept.
   *
   * The user record is then read from `/auth/me` rather than trusted from the
   * completion response, so the identity the app shows is one the server has
   * just confirmed against the stored session.
   */
  const adoptSession = async (tokens: { accessToken: string; refreshToken: string }) => {
    await setItem(TOKEN_KEYS.ACCESS_TOKEN, tokens.accessToken);
    await setItem(TOKEN_KEYS.REFRESH_TOKEN, tokens.refreshToken);

    const me = await api.get<AuthUser>('/auth/me');
    await setItem(TOKEN_KEYS.USER, JSON.stringify(me));
    await rememberStoreId(me.publicStoreId);
    await branch.hydrate();
    setUser(me);
    return me;
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
    /*
     * Any report still in the cache goes too. An exported CSV is the shop's
     * profit and its debts as plain text, and leaving one behind after somebody
     * signs out leaves it for whoever signs in next.
     */
    clearExports();
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

  return <AuthContext.Provider value={{ user, bootstrapping, signIn, chooseAccount, signOut, adoptSession }}>{children}</AuthContext.Provider>;
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
    /*
     * Platform administration is a separate identity: it has its own sign-in
     * and its own session, and never a shop's. The tenant redirects leave it
     * alone in both directions — no shop session is needed to reach it, and
     * holding one does not open it.
     */
    if (segments[0] === 'platform') return;

    if (!user && !inAuth) {
      router.replace('/(auth)/login');
    } else if (user && !branchId && !onSelectBranch) {
      router.replace('/select-branch');
    } else if (user && branchId && (inAuth || onSelectBranch || atRoot)) {
      router.replace('/(tabs)');
    }
  }, [user, bootstrapping, branchId, segments, router]);
}
