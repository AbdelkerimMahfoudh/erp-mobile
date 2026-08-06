import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getItem, setItem, deleteItem } from './storage';

/**
 * The device's half of its identity.
 *
 * The credential is **issued by the server** — this file never generates a
 * secret, which is why device identity needed no new crypto dependency. All the
 * client does is keep what it was given, in the same secure storage the tokens
 * use, and hand it back at the next login.
 *
 * Scoped per user: two people signing in on one handset get two device records
 * on the server, and each keeps its own credential here. Neither can present
 * the other's, and nothing on this device correlates them.
 *
 * Losing this credential — a reinstall, cleared storage, a different phone — is
 * simply a new device. That is the intended behaviour, not a failure: the
 * server enrolls a fresh record and the old one keeps its own history.
 */

const KEY_PREFIX = 'erp.device.';

export interface DeviceCredential {
  deviceId: string;
  deviceSecret: string;
}

/**
 * Keyed by LOGIN, because the login is the only identity known before the server
 * has authenticated anyone, and a returning installation must present its
 * credential in that very same request.
 *
 * ⚠️ **Known limitation — login is company-ambiguous.** The database guarantees
 * login uniqueness only within a company (`@@unique([companyId, login])`), so on
 * one installation used across companies (two `owner`s, account switching), this
 * key collides. Since Stage 3.1 the server FAILS CLOSED on a credential it
 * cannot verify, so presenting company A's credential while signing into company
 * B is rejected rather than silently mis-enrolled — and `signIn` recovers by
 * forgetting the stale entry and enrolling fresh. That prevents a lock-out but
 * still thrashes device records for colliding logins.
 *
 * A collision-free key is **not possible here without an auth-contract change**,
 * because no company/store identifier is known before login. The required change
 * is recorded in docs/23 (Stage 3.1): the login request must carry a stable,
 * public company/store identifier (or the server must issue a recoverable
 * account namespace), after which the key becomes `env + companyKey + login`.
 * Until then this key is deliberately left as-is rather than replaced with a
 * different ambiguous scheme.
 *
 * Isolation never rests on this key: the server checks that the device row
 * belongs to the authenticated user, so a tampered or colliding local entry is
 * rejected there, not trusted here.
 *
 * **Login rename (future):** renaming a login changes this key, which would
 * orphan the stored credential and enroll a new device on the next sign-in. When
 * a rename endpoint is built it must re-key this entry from the old login to the
 * new one (a local `getItem(old) → setItem(new) → deleteItem(old)`), or the
 * client must accept the re-enrollment as an intentional new device.
 */
const keyFor = (login: string) => `${KEY_PREFIX}${login.trim().toLowerCase()}`;

export async function loadCredential(login: string): Promise<DeviceCredential | null> {
  const raw = await getItem(keyFor(login));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeviceCredential;
    return parsed.deviceId && parsed.deviceSecret ? parsed : null;
  } catch {
    // Corrupt entry: treat as absent. The next login enrolls a new device,
    // which is safe — worst case the user sees one stale row they can revoke.
    return null;
  }
}

export async function saveCredential(login: string, cred: DeviceCredential): Promise<void> {
  await setItem(keyFor(login), JSON.stringify(cred));
}

/**
 * Forget this device's credential locally.
 *
 * Used on sign-out. The server keeps its device record and its history — that
 * is the point of revocation being a server-side act — but this installation
 * stops being able to prove it is that device, so the next sign-in is a fresh
 * decision.
 */
export async function clearCredential(login: string): Promise<void> {
  await deleteItem(keyFor(login));
}

/**
 * Untrusted display metadata, sent so the user can tell their phones apart in
 * the device list. Deliberately nothing identifying: no IMEI, no serial, no
 * advertising id — only what the OS already tells any app about itself.
 */
export function deviceMeta(): { label: string; platform: string; appVersion: string } {
  const platform = Platform.OS;
  return {
    label: platform === 'web' ? 'Web browser' : `${platform} device`,
    platform,
    // From expo-constants, which is already a dependency. `expo-application`
    // would give a richer build number, but adding a package for a display
    // string is not a trade CLAUDE.md's approval rule is meant to wave through.
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
  };
}
