/**
 * Regression guard for device-credential namespacing + legacy migration
 * (F1 Stage 3.2). Run directly with Node (type-stripping), no test runner:
 *   node lib/device-key.test.ts
 */
import assert from 'node:assert/strict';
import {
  apiEnvTokenFromBase,
  deviceCredentialKey,
  legacyCredentialKey,
  normalizeStoreId,
  normalizeLogin,
  migrateLegacyCredential,
  type KeyValueStore,
} from './device-key.ts';

let passed = 0;
const it = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`  ok - ${name}`);
  });

/** In-memory store; `dropWrites` simulates a secure-store write that never lands. */
function memStore(seed: Record<string, string> = {}, opts: { dropWrites?: boolean } = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      if (!opts.dropWrites) map.set(k, v);
    },
    deleteItem: async (k) => void map.delete(k),
  };
}

const ENV = apiEnvTokenFromBase('http://localhost:3010');

async function main() {
  await it('env token distinguishes dev / staging / prod hosts', () => {
    assert.equal(apiEnvTokenFromBase('http://localhost:3010'), 'localhost_3010');
    assert.notEqual(apiEnvTokenFromBase('http://localhost:3010'), apiEnvTokenFromBase('https://api.myerp.com'));
    assert.notEqual(apiEnvTokenFromBase('http://10.0.2.2:3010'), apiEnvTokenFromBase('http://localhost:3010'));
  });

  await it('keys differ by Store ID (Company A vs B, same login)', () => {
    const a = deviceCredentialKey({ apiEnv: ENV, storeId: 'F62B8D1EEB', login: 'owner' });
    const b = deviceCredentialKey({ apiEnv: ENV, storeId: 'AAAAAAAAAA', login: 'owner' });
    assert.notEqual(a, b);
  });

  await it('keys differ by login and by environment', () => {
    const base = { apiEnv: ENV, storeId: 'F62B8D1EEB', login: 'owner' };
    assert.notEqual(deviceCredentialKey(base), deviceCredentialKey({ ...base, login: 'seller' }));
    assert.notEqual(
      deviceCredentialKey(base),
      deviceCredentialKey({ ...base, apiEnv: apiEnvTokenFromBase('https://api.myerp.com') }),
    );
  });

  await it('normalization is stable (case, dashes, O/I/L, login case)', () => {
    const canonical = deviceCredentialKey({ apiEnv: ENV, storeId: 'F62B8D1EEB', login: 'owner' });
    assert.equal(deviceCredentialKey({ apiEnv: ENV, storeId: ' f62b8-d1eeb ', login: 'OWNER' }), canonical);
    // O->0, I/L->1 tolerance (codes never contain O/I/L).
    assert.equal(normalizeStoreId('0O1IL'), '00111');
    assert.equal(normalizeLogin('  Owner '), 'owner');
  });

  await it('legacy migration copies to the scoped key, then removes the old key, once', async () => {
    const cred = JSON.stringify({ deviceId: 'dev-1', deviceSecret: 'sec-1' });
    const store = memStore({ [legacyCredentialKey('owner')]: cred });
    const parts = { apiEnv: ENV, storeId: 'F62B8D1EEB', login: 'owner' };

    assert.equal(await migrateLegacyCredential(store, parts), true);
    assert.equal(store.map.get(deviceCredentialKey(parts)), cred); // scoped key written
    assert.equal(store.map.has(legacyCredentialKey('owner')), false); // legacy removed

    // Idempotent: a second run does nothing.
    assert.equal(await migrateLegacyCredential(store, parts), false);
  });

  await it('a FAILED scoped write never deletes the legacy credential', async () => {
    const cred = JSON.stringify({ deviceId: 'dev-1', deviceSecret: 'sec-1' });
    const store = memStore({ [legacyCredentialKey('owner')]: cred }, { dropWrites: true });
    const parts = { apiEnv: ENV, storeId: 'F62B8D1EEB', login: 'owner' };

    assert.equal(await migrateLegacyCredential(store, parts), false);
    assert.equal(store.map.get(legacyCredentialKey('owner')), cred); // still there
  });

  await it('migration never touches another company: a different Store ID gets no credential', async () => {
    const cred = JSON.stringify({ deviceId: 'dev-1', deviceSecret: 'sec-1' });
    const store = memStore({ [legacyCredentialKey('owner')]: cred });
    // Company B migrates for ITS store id; company A's scoped key stays empty.
    await migrateLegacyCredential(store, { apiEnv: ENV, storeId: 'BBBBBBBBBB', login: 'owner' });
    assert.equal(store.map.has(deviceCredentialKey({ apiEnv: ENV, storeId: 'AAAAAAAAAA', login: 'owner' })), false);
  });

  console.log(`\ndevice-key: ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
