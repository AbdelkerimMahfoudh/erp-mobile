/**
 * A release build never talks to a development address or in clear text (docs/48 control 19; review MO1-04, MO2-05).
 *
 *   node lib/release-origin.test.ts
 *
 * Two holds on one rule: the running app refuses a release origin that is missing, not https, or a development host
 * (`lib/release-origin.ts`, read by `constants/config.ts`), and every EAS build of a release profile runs the release
 * check as its `eas-build-post-install` hook, so a build made without the origin fails instead of shipping. An EAS
 * build itself cannot be run here: the hook is exercised the way the worker runs it, with its profile in
 * `EAS_BUILD_PROFILE`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { releaseOriginRefusal } from './release-origin.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

it('the running app refuses a missing, clear-text or development origin, and takes an https one', () => {
  assert.equal(releaseOriginRefusal(undefined), 'missing');
  assert.equal(releaseOriginRefusal('  '), 'missing');
  assert.equal(releaseOriginRefusal('http://api.dukan.mr'), 'not_https');
  assert.equal(releaseOriginRefusal('http://localhost:3010'), 'not_https');
  assert.equal(releaseOriginRefusal('https://api.dukan.mr/api/v1'), 'not_https', 'an origin, never a path');
  assert.equal(releaseOriginRefusal('https://localhost:3010'), 'development_host');
  assert.equal(releaseOriginRefusal('https://192.168.1.20'), 'development_host');
  assert.equal(releaseOriginRefusal('https://10.0.2.2:3010'), 'development_host');
  assert.equal(releaseOriginRefusal('https://api.dukan.mr'), null);
  assert.equal(releaseOriginRefusal('https://api.dukan.mr/'), null, 'a trailing slash is the same origin');
  assert.equal(releaseOriginRefusal('https://staging.dukan.mr:8443'), null);
});

it('the config holds a native release to the rule, and never development or the web export', () => {
  const config = readFileSync(new URL('../constants/config.ts', import.meta.url), 'utf8');
  assert.match(config, /!__DEV__ && Platform\.OS !== 'web' \? releaseOriginRefusal\(process\.env\.EXPO_PUBLIC_API_ORIGIN\) : null/);
  assert.match(config, /API_BASE = API_ORIGIN_REFUSAL \? 'https:\/\/[a-z-]+\.invalid' : resolveOrigin\(\)/);
  assert.match(readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8'), /if \(API_ORIGIN_REFUSAL\)/);
});

/** The hook as EAS runs it: `npm run eas-build-post-install` on the worker, with the profile's environment. */
function hook(env: Record<string, string>): { status: number | null; out: string } {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const command: string = pkg.scripts['eas-build-post-install'];
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('EXPO_PUBLIC_') && k !== 'EAS_BUILD_PROFILE'));
  const r = spawnSync('sh', ['-c', command], { cwd: ROOT, env: { ...clean, ...env }, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

it('every EAS build of a release profile runs the release check, and fails without its https origins', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(typeof pkg.scripts['eas-build-post-install'], 'string', 'package.json has the EAS build hook');

  const missing = hook({ EAS_BUILD_PROFILE: 'production' });
  assert.equal(missing.status, 1, missing.out);
  assert.match(missing.out, /EXPO_PUBLIC_API_ORIGIN is not set/);
  assert.equal(hook({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_ORIGIN: 'http://api.dukan.mr' }).status, 1);
  assert.equal(hook({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_API_ORIGIN: 'http://192.168.1.20:3010' }).status, 1);
  // The legal pages' origin is held to the same rule (lib/legal-links.ts): a release cannot be built without it.
  const noLegal = hook({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_ORIGIN: 'https://api.dukan.mr' });
  assert.equal(noLegal.status, 1, noLegal.out);
  assert.match(noLegal.out, /EXPO_PUBLIC_LEGAL_ORIGIN is not set/);
  assert.equal(hook({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_ORIGIN: 'https://api.dukan.mr', EXPO_PUBLIC_LEGAL_ORIGIN: 'http://www.dukan.mr' }).status, 1);
  assert.equal(hook({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_API_ORIGIN: 'https://api.dukan.mr', EXPO_PUBLIC_LEGAL_ORIGIN: 'https://localhost:5173' }).status, 1);
  const sound = hook({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_ORIGIN: 'https://api.dukan.mr', EXPO_PUBLIC_LEGAL_ORIGIN: 'https://www.dukan.mr' });
  assert.equal(sound.status, 0, sound.out);
  // A development build keeps its development defaults: not checked.
  assert.equal(hook({ EAS_BUILD_PROFILE: 'development' }).status, 0);
});

console.log(`release origin: ${passed} passed`);
