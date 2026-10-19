/**
 * What a screen reader hears in the browser build (found driving the web export, 2026-10-19).
 *
 * React Native Web 0.21 reads the flat `aria-*` props and ignores the `accessibilityState` object, so a checkbox, a
 * tab or a disclosure announced its state on a phone and nothing in a browser. React Native maps the same `aria-*`
 * props natively, so every state is given both ways. And `AccessibilityInfo.sendAccessibilityEvent` does not exist
 * on the web: calling it threw, so it is reached only through `lib/accessibility-focus.ts`.
 *
 * Run directly with Node (type-stripping):
 *   node lib/web-accessibility.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const files = [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'components')), ...sources(join(ROOT, 'lib'))];

it('every checked, selected or expanded state is also given as its aria- prop', () => {
  const missing: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('accessibilityState=')) return;
      const near = lines.slice(i, i + 4).join('\n');
      for (const key of ['checked', 'selected', 'expanded']) {
        if (new RegExp(`\\b${key}\\b`).test(line) && !near.includes(`aria-${key}=`)) missing.push(`${relative(ROOT, file)}:${i + 1} ${key}`);
      }
    });
  }
  assert.deepEqual(missing, []);
});

it('the screen reader is moved only through the web-safe helper', () => {
  const direct = files.filter((f) => !f.endsWith('lib/accessibility-focus.ts') && readFileSync(f, 'utf8').includes('sendAccessibilityEvent'));
  assert.deepEqual(direct.map((f) => relative(ROOT, f)), []);
});

console.log('\n' + passed + ' passed');
