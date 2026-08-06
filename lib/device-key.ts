/**
 * Device-credential key derivation and legacy migration (F1 Stage 3.2).
 *
 * PURE and dependency-free (no React Native imports) so Node can run the
 * regression guard in `device-key.test.ts` directly. The RN glue — real
 * SecureStore, the API base — lives in `device.ts`.
 *
 * The credential is namespaced by environment + Store Account ID + login, so:
 *  - Company A and Company B (different Store IDs) never share a key, even with
 *    the same `owner` login;
 *  - development / staging / production (different API hosts) never collide;
 *  - contact changes do not affect the key (it uses login, not phone/email).
 */

const KEY_PREFIX = 'erp.device.';

export interface DeviceCredential {
  deviceId: string;
  deviceSecret: string;
}

/** Minimal async key/value surface; SecureStore in prod, a map in tests. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** Environment identity from an API base URL, e.g. `http://localhost:3010` → `localhost_3010`. */
export function apiEnvTokenFromBase(base: string): string {
  return base
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Mirror of the backend `normalizeStoreCode`: canonical uppercase hex. */
export function normalizeStoreId(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** The company-scoped SecureStore key: `erp.device.<env>.<storeId>.<login>`. */
export function deviceCredentialKey(parts: { apiEnv: string; storeId: string; login: string }): string {
  return `${KEY_PREFIX}${parts.apiEnv}.${normalizeStoreId(parts.storeId)}.${normalizeLogin(parts.login)}`;
}

/** The pre-3.2 login-only key, kept only for one-time migration. */
export function legacyCredentialKey(login: string): string {
  return `${KEY_PREFIX}${normalizeLogin(login)}`;
}

export function parseCredential(raw: string | null): DeviceCredential | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as DeviceCredential;
    return p.deviceId && p.deviceSecret ? p : null;
  } catch {
    return null;
  }
}

/**
 * One-time, idempotent migration of a pre-3.2 login-only credential into the
 * company-scoped key, using the Store ID from the user's OWN authenticated
 * session (so it can never land in another company's namespace).
 *
 * Writes the new key FIRST and only deletes the legacy key once the new write is
 * confirmed present — a failed secure write never loses the credential. Returns
 * `true` only when a migration actually happened.
 */
export async function migrateLegacyCredential(
  store: KeyValueStore,
  parts: { apiEnv: string; storeId: string; login: string },
): Promise<boolean> {
  const newKey = deviceCredentialKey(parts);
  if (await store.getItem(newKey)) return false; // already migrated (idempotent)

  const legacyKey = legacyCredentialKey(parts.login);
  const legacyRaw = await store.getItem(legacyKey);
  if (!parseCredential(legacyRaw)) return false; // nothing valid to migrate

  await store.setItem(newKey, legacyRaw as string);
  // Confirm the new write landed BEFORE removing the source.
  if (await store.getItem(newKey)) {
    await store.deleteItem(legacyKey);
    return true;
  }
  return false; // write did not persist → legacy key left untouched
}
