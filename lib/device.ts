import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE } from '../constants/config';
import { getItem, setItem, deleteItem } from './storage';
import {
  apiEnvTokenFromBase,
  deviceCredentialKey,
  legacyCredentialKey,
  migrateLegacyCredential as migrateLegacy,
  normalizeStoreId,
  parseCredential,
  type DeviceCredential,
  type KeyValueStore,
} from './device-key';

/**
 * The device's half of its identity (F1 Stage 3 / 3.2).
 *
 * The credential is issued by the SERVER — this file never generates a secret —
 * and lives only in SecureStore. Since Stage 3.2 it is namespaced by
 * environment + Store Account ID + login (see `device-key.ts`), so two companies
 * that both have an `owner` never share a credential and dev/staging/prod cannot
 * collide. The key derivation and the one-time legacy migration are the pure,
 * tested part; this module is only the SecureStore + config glue.
 */

export type { DeviceCredential };

/** A non-secret convenience: remember the last Store ID typed on this device. */
const LAST_STORE_ID_KEY = 'erp.lastStoreId';

const store: KeyValueStore = { getItem, setItem, deleteItem };
const apiEnv = () => apiEnvTokenFromBase(API_BASE);
const keyFor = (storeId: string, login: string) => deviceCredentialKey({ apiEnv: apiEnv(), storeId, login });

export async function loadCredential(storeId: string, login: string): Promise<DeviceCredential | null> {
  return parseCredential(await getItem(keyFor(storeId, login)));
}

export async function saveCredential(storeId: string, login: string, cred: DeviceCredential): Promise<void> {
  await setItem(keyFor(storeId, login), JSON.stringify(cred));
}

export async function clearCredential(storeId: string, login: string): Promise<void> {
  await deleteItem(keyFor(storeId, login));
}

/** The pre-3.2 login-only credential, read only during migration. */
export async function loadLegacyCredential(login: string): Promise<DeviceCredential | null> {
  return parseCredential(await getItem(legacyCredentialKey(login)));
}

export async function clearLegacyCredential(login: string): Promise<void> {
  await deleteItem(legacyCredentialKey(login));
}

/**
 * One-time, idempotent migration of a pre-3.2 login-only credential into the
 * company-scoped key, using the Store ID from the user's OWN session. Writes the
 * new key before deleting the old one; a failed write keeps the old credential.
 */
export function migrateLegacyCredential(storeId: string, login: string): Promise<boolean> {
  return migrateLegacy(store, { apiEnv: apiEnv(), storeId, login });
}

/** Remember the last Store ID (NOT a secret) for convenience next launch. */
export async function rememberStoreId(storeId: string): Promise<void> {
  await setItem(LAST_STORE_ID_KEY, normalizeStoreId(storeId));
}

export async function getRememberedStoreId(): Promise<string | null> {
  return getItem(LAST_STORE_ID_KEY);
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
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
  };
}
