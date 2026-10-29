/**
 * The app's technical identity — the owner's final values (2026-10-13; docs/21 D168 as amended).
 *
 *   node lib/app-identity.test.ts
 *
 * Dukan ERP, developed and operated by TSX-MR: Expo slug `dukan-erp`, URL scheme `dukanerp`, iOS bundle
 * identifier and Android package `mr.tsxmr.dukanerp`. The configuration is resolved the way a build
 * resolves it (`@expo/config`: `app.config.js` over `app.json`) under each EAS profile's environment, and
 * the native files are read the way `expo prebuild` writes them (Expo's own introspection): the
 * home-screen name, the one scheme the phone hands to the app, the package, every system prompt.
 *
 * The previous identifiers (`retailerp`, `phonestore-erp`, `mr.retailerp.app`, "Retail ERP") never
 * reached a store, a production build, push or an update channel, so none of them is kept as an alias.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const requireFromApp = createRequire(new URL('../package.json', import.meta.url));

const IDENTITY = {
  name: 'Dukan ERP',
  slug: 'dukan-erp',
  scheme: 'dukanerp',
  bundleIdentifier: 'mr.tsxmr.dukanerp',
  package: 'mr.tsxmr.dukanerp',
};
/** The EAS project the app is linked to: `@salah_rim/dukan-erp`, created on the owner's decision of 2026-10-29 — Expo
 *  cannot rename the old `phonestore-erp` project's slug (docs/75 §15.3). Replacing this ID is the owner's decision,
 *  never a quiet fix. */
const EAS_PROJECT_ID = '86a08e0d-578d-479f-986d-51706ea99522';
const PREVIOUS = /retailerp|retail[ _-]erp|phonestore-erp|mr\.retailerp/i;

interface ExpoConfig {
  name?: string;
  slug?: string;
  scheme?: string | string[];
  ios?: { bundleIdentifier?: string };
  android?: { package?: string };
  extra?: { eas?: { projectId?: string } };
}
const { getConfig } = requireFromApp('@expo/config') as {
  getConfig: (root: string, options: { skipSDKVersionRequirement: boolean }) => { exp: ExpoConfig };
};

function identityOf(exp: ExpoConfig) {
  return {
    name: exp.name,
    slug: exp.slug,
    scheme: exp.scheme,
    bundleIdentifier: exp.ios?.bundleIdentifier,
    package: exp.android?.package,
  };
}

/** Resolves the configuration with one EAS build profile's environment applied, as `eas build` does. */
function resolvedUnder(profile: string, env: Record<string, string>): ExpoConfig {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, env, { EAS_BUILD_PROFILE: profile });
    return getConfig(ROOT, { skipSDKVersionRequirement: true }).exp;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

describe('the configured identity', () => {
  it('app.json declares the final identity', () => {
    const { expo } = JSON.parse(read('app.json')) as { expo: ExpoConfig };
    assert.deepEqual(identityOf(expo), IDENTITY);
  });

  it('the EAS project link is kept as it was — replacing it is the owner’s decision', () => {
    const { expo } = JSON.parse(read('app.json')) as { expo: ExpoConfig };
    assert.equal(expo.extra?.eas?.projectId, EAS_PROJECT_ID);
  });

  it('every EAS build profile resolves the same identity', () => {
    const eas = JSON.parse(read('eas.json')) as { build: Record<string, { env?: Record<string, string> }> };
    const profiles = Object.keys(eas.build);
    assert.deepEqual(profiles.sort(), ['development', 'preview', 'production']);
    for (const profile of profiles) {
      const exp = resolvedUnder(profile, eas.build[profile].env ?? {});
      assert.deepEqual(identityOf(exp), IDENTITY, `profile ${profile}`);
      assert.equal(exp.extra?.eas?.projectId, EAS_PROJECT_ID, `profile ${profile}`);
    }
  });

  it('no build profile overrides an identifier', () => {
    assert.doesNotMatch(read('eas.json'), /applicationId|bundleIdentifier|"package"|APP_VARIANT|"scheme"/);
  });

  it('no previous identifier remains in the configuration', () => {
    for (const file of ['app.json', 'app.config.js', 'eas.json', 'package.json']) {
      assert.doesNotMatch(read(file), PREVIOUS, file);
    }
  });
});

describe('the native projects a build generates (Expo introspection, as `expo prebuild` writes them)', async () => {
  const { getPrebuildConfigAsync } = requireFromApp('@expo/prebuild-config') as {
    getPrebuildConfigAsync: (root: string, o: { platforms: string[] }) => Promise<{ exp: Record<string, unknown> }>;
  };
  const { compileModsAsync } = requireFromApp('@expo/config-plugins/build/plugins/mod-compiler.js') as {
    compileModsAsync: (exp: Record<string, unknown>, o: Record<string, unknown>) => Promise<unknown>;
  };
  const { exp } = await getPrebuildConfigAsync(ROOT, { platforms: ['ios', 'android'] });
  await compileModsAsync(exp, { projectRoot: ROOT, introspect: true, platforms: ['ios', 'android'], assertMissingModProviders: false });
  type Xml = { $?: Record<string, string>; _?: string } & Record<string, Xml[] | undefined>;
  const results = (exp._internal as { modResults: { ios: Record<string, Record<string, unknown>>; android: Record<string, Xml> } }).modResults;
  const plist = results.ios.infoPlist as Record<string, unknown> & { CFBundleURLTypes?: { CFBundleURLSchemes: string[] }[] };
  const manifest = (results.android.manifest as unknown as { manifest: Xml }).manifest;

  it('iOS: the home-screen name and the URL schemes the phone hands to the app', () => {
    assert.equal(plist.CFBundleDisplayName, 'Dukan ERP');
    const schemes = (plist.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes);
    assert.deepEqual(schemes, ['dukanerp', 'mr.tsxmr.dukanerp']);
  });

  it('iOS: every system prompt names Dukan ERP, never a placeholder or a previous name', () => {
    const prompts = Object.entries(plist).filter(([key]) => /UsageDescription$/.test(key));
    assert.ok(prompts.length > 0);
    for (const [key, text] of prompts) {
      assert.match(String(text), /^Dukan ERP /, key);
      assert.doesNotMatch(String(text), /\$\(PRODUCT_NAME\)|PRODUCT_NAME/, key);
      assert.doesNotMatch(String(text), PREVIOUS, key);
    }
  });

  it('Android: the package, the app name, and one scheme opening the app', () => {
    assert.equal(manifest.$?.package, 'mr.tsxmr.dukanerp');
    const strings = (results.android.strings as unknown as { resources: { string: Xml[] } }).resources.string;
    assert.equal(strings.find((s) => s.$?.name === 'app_name')?._, 'Dukan ERP');
    const activities = (manifest.application?.[0].activity ?? []) as Xml[];
    const schemes = activities
      .flatMap((a) => a['intent-filter'] ?? [])
      .filter((f) => (f.action ?? []).some((a) => a.$?.['android:name'] === 'android.intent.action.VIEW'))
      .flatMap((f) => (f.data ?? []).map((d) => d.$?.['android:scheme']))
      .filter(Boolean);
    assert.deepEqual(schemes, ['dukanerp']);
  });

  it('no previous identifier reaches a generated native file', () => {
    assert.doesNotMatch(JSON.stringify(results), PREVIOUS);
  });
});
