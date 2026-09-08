/**
 * The two vendored React Navigation symbols still resolve.
 *
 *   node lib/navigation/router-internals.test.ts
 *
 * These are internal Expo Router paths. They may move on any SDK bump, and the
 * failure if they do is the dangerous kind: `HeaderShownContext` resolving to a
 * different context object does not throw — it quietly returns the default
 * forever, so `Screen` reserves the status-bar inset twice and the header
 * spacing fix silently reverts on a device.
 *
 * So this asserts the modules exist and export what they claim. A break shows
 * up in a test run rather than in somebody's hand.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const ROOT = join(import.meta.dirname, '..', '..');
const source = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const HEADER_CTX =
  'node_modules/expo-router/build/react-navigation/elements/Header/HeaderShownContext';
const PREVENT_REMOVE =
  'node_modules/expo-router/build/react-navigation/core/usePreventRemove';

it('the vendored HeaderShownContext module is where the shim expects it', () => {
  assert.ok(existsSync(join(ROOT, `${HEADER_CTX}.js`)), `${HEADER_CTX}.js is missing`);
  assert.match(source(`${HEADER_CTX}.d.ts`), /HeaderShownContext/);
});

it('the vendored usePreventRemove module is where the shim expects it', () => {
  assert.ok(existsSync(join(ROOT, `${PREVENT_REMOVE}.js`)), `${PREVENT_REMOVE}.js is missing`);
  assert.match(source(`${PREVENT_REMOVE}.d.ts`), /usePreventRemove/);
});

it('the shim points at those exact paths', () => {
  const shim = source('lib/navigation/router-internals.ts');
  assert.match(
    shim,
    /from 'expo-router\/build\/react-navigation\/elements\/Header\/HeaderShownContext'/,
  );
  assert.match(shim, /from 'expo-router\/build\/react-navigation\/core\/usePreventRemove'/);
});

it('no file imports the standalone @react-navigation packages', () => {
  /*
   * The whole point of the shim. A standalone package is a DIFFERENT module
   * instance, so its context is never filled by Expo Router's provider — the
   * failure is silent, and only visible on a device.
   */
  const withoutComments = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((entry: string) => {
      if (entry === 'node_modules') return [];
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel);
      return /\.tsx?$/.test(entry) ? [rel] : [];
    });

  const offenders = ['app', 'components', 'lib', 'hooks']
    .filter((d) => existsSync(join(ROOT, d)))
    .flatMap(walk)
    .filter((f) => !f.endsWith('.test.ts'))
    .filter((f) => /from '@react-navigation\//.test(withoutComments(source(f))));

  assert.deepEqual(offenders, []);
});

it('they are not declared as dependencies either', () => {
  const pkg = JSON.parse(source('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const declared = Object.keys(all).filter((k) => k.startsWith('@react-navigation/'));
  assert.deepEqual(declared, []);
});

console.log(`router internals: ${passed} passed`);
