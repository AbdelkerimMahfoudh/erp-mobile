/**
 * The Stock visual system stays centralized.
 *
 *   node lib/design/visual-system.test.ts
 *
 * The owner approved the Stock screen as the reference for the whole app: type
 * sizes and weights come from `tokens.ts` through the `Text` primitive, colours
 * from the theme, and no screen carries its own. This fails the moment a screen
 * or component writes a raw size, a raw weight, a raw colour or a utility class.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

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

const withoutComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

const FILES = [...tsxFiles('app'), ...tsxFiles('components')].map((f) => ({ f, src: withoutComments(readFileSync(f, 'utf8')) }));

function offenders(pattern: RegExp): string[] {
  return FILES.filter(({ src }) => pattern.test(src)).map(({ f }) => f);
}

it('no screen or component sets a raw font size or weight', () => {
  assert.deepEqual(offenders(/fontSize:\s*\d|fontWeight:\s*['"]\d/), []);
});

it('no screen or component sets a font family of its own', () => {
  assert.deepEqual(offenders(/fontFamily:/), []);
});

it('no screen or component carries a raw colour', () => {
  assert.deepEqual(offenders(/['"]#[0-9A-Fa-f]{3,8}['"]|rgba?\(/), []);
});

it('no screen uses utility classes instead of the shared primitives', () => {
  // Screens only: `Screen` and the legacy `compat` shim forward a className
  // prop for callers; they do not style with one themselves.
  const screens = FILES.filter(({ f }) => f.startsWith(`app${path.sep}`));
  assert.deepEqual(
    screens.filter(({ src }) => /\bclassName=|contentContainerClassName=/.test(src)).map(({ f }) => f),
    [],
  );
});

it('no screen renders React Native Text directly, bypassing the type scale', () => {
  const direct = FILES.filter(
    ({ f, src }) => !f.endsWith(path.join('ui', 'Text.tsx')) && /import \{[^}]*\bText\b[^}]*\} from 'react-native'/.test(src),
  ).map(({ f }) => f);
  assert.deepEqual(direct, []);
});

it('the type scale names the weights the primitives need', () => {
  const tokens = readFileSync('lib/design/tokens.ts', 'utf8');
  for (const variant of ['labelStrong', 'captionStrong', 'tabLabel']) {
    assert.match(tokens, new RegExp(`\\b${variant}: \\{ fontSize: \\d+, lineHeight: \\d+, fontWeight: '\\d00' \\}`));
  }
});

console.log(`visual system: ${passed} passed`);
