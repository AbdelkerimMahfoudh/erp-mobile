/**
 * The Stock visual system stays centralized — without flattening hierarchy.
 *
 *   node lib/design/visual-system.test.ts
 *
 * The owner approved the Stock screen as the reference for the whole app. Type
 * sizes and weights come from `tokens.ts` through the `Text` primitive's
 * variants, colours from the theme, and no screen carries its own.
 *
 * What this rejects is LOCAL values: a raw size, a raw weight, a font family or
 * a raw colour written into a screen or component. What it deliberately allows
 * is everything that keeps hierarchy expressive: any `Text` variant (display,
 * title, heading, body, label, caption and their strong forms), style values
 * that reference a token (`typeScale.title.fontSize`, `colors.intent.danger.fg`),
 * and non-type properties such as `letterSpacing`. The detectors are tested
 * directly against both kinds of code, so the guard can never quietly turn into
 * "every piece of text must be one size".
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

/* ── detectors ───────────────────────────────────────────────────────────── */

/** A size or weight written as a literal rather than taken from a token. */
const RAW_TYPE = /\bfontSize:\s*-?\d|\bfontWeight:\s*['"`]?(?:\d{3}|bold|normal)\b|\blineHeight:\s*\d/;
/** A font family chosen locally. The system font (with the Arabic system font) is the theme's. */
const RAW_FAMILY = /\bfontFamily:/;
/** A colour literal: hex, rgb/rgba/hsl, or a named CSS colour in a colour property. */
const RAW_COLOUR =
  /['"`]#[0-9A-Fa-f]{3,8}['"`]|\b(?:rgba?|hsla?)\(|\b(?:color|backgroundColor|borderColor|tintColor|shadowColor):\s*['"`](?!transparent['"`])[a-z]+['"`]/;
const UTILITY_CLASS = /\bclassName=|contentContainerClassName=/;

const hasRawType = (src: string) => RAW_TYPE.test(withoutComments(src));
const hasRawFamily = (src: string) => RAW_FAMILY.test(withoutComments(src));
const hasRawColour = (src: string) => RAW_COLOUR.test(withoutComments(src));

it('the detectors reject local values', () => {
  for (const bad of [
    "{ fontSize: 14 }",
    "{ fontWeight: '700' }",
    "{ fontWeight: 'bold' }",
    "{ lineHeight: 20 }",
  ]) {
    assert.ok(hasRawType(bad), `should reject ${bad}`);
  }
  assert.ok(hasRawFamily("{ fontFamily: 'Inter' }"));
  for (const bad of ["{ color: '#fff' }", "{ backgroundColor: 'rgba(0,0,0,0.5)' }", "{ borderColor: 'red' }"]) {
    assert.ok(hasRawColour(bad), `should reject ${bad}`);
  }
});

it('the detectors allow tokens, variants and hierarchy', () => {
  for (const ok of [
    '<Text variant="display">',
    '<Text variant="title">',
    '<Text variant="caption" tone="tertiary">',
    '<Text variant="labelStrong">',
    '{ fontSize: typeScale.title.fontSize, lineHeight: typeScale.title.lineHeight, letterSpacing: 2 }',
    '{ ...typeScale.tabLabel, flexShrink: 0 }',
    '{ color: colors.intent.danger.fg }',
    '{ backgroundColor: tone.bg }',
    "{ backgroundColor: 'transparent' }",
    '{ textTransform: "uppercase", letterSpacing: 0.6 }',
    '// fontSize: 14 in a comment explains history',
  ]) {
    assert.ok(!hasRawType(ok) && !hasRawFamily(ok) && !hasRawColour(ok), `should allow ${ok}`);
  }
});

it('the type scale keeps real hierarchy — several distinct sizes and weights', () => {
  const tokens = readFileSync('lib/design/tokens.ts', 'utf8');
  const block = tokens.slice(tokens.indexOf('export const type = {'), tokens.indexOf('} as const;', tokens.indexOf('export const type = {')));
  const sizes = new Set([...block.matchAll(/fontSize: (\d+)/g)].map((m) => m[1]));
  const weights = new Set([...block.matchAll(/fontWeight: '(\d+)'/g)].map((m) => m[1]));
  assert.ok(sizes.size >= 5, `expected at least 5 sizes, got ${[...sizes].join(',')}`);
  assert.ok(weights.size >= 3, `expected at least 3 weights, got ${[...weights].join(',')}`);
  for (const variant of ['display', 'title', 'heading', 'body', 'bodyStrong', 'label', 'labelStrong', 'caption', 'captionStrong', 'tabLabel']) {
    assert.match(block, new RegExp(`\\b${variant}: \\{`), `missing variant ${variant}`);
  }
});

/* ── the app ─────────────────────────────────────────────────────────────── */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

const FILES = [...tsxFiles('app'), ...tsxFiles('components')].map((f) => ({ f, src: readFileSync(f, 'utf8') }));
const offenders = (test: (src: string) => boolean) => FILES.filter(({ src }) => test(src)).map(({ f }) => f);

it('no screen or component sets a raw font size, weight or line height', () => {
  assert.deepEqual(offenders(hasRawType), []);
});

it('no screen or component sets a font family of its own', () => {
  assert.deepEqual(offenders(hasRawFamily), []);
});

it('no screen or component carries a raw colour', () => {
  assert.deepEqual(offenders(hasRawColour), []);
});

it('no screen uses utility classes instead of the shared primitives', () => {
  // Screens only: `Screen` and the legacy `compat` shim forward a className
  // prop for callers; they do not style with one themselves.
  const screens = FILES.filter(({ f }) => f.startsWith(`app${path.sep}`));
  assert.deepEqual(
    screens.filter(({ src }) => UTILITY_CLASS.test(withoutComments(src))).map(({ f }) => f),
    [],
  );
});

it('no screen renders React Native Text directly, bypassing the type scale', () => {
  const direct = FILES.filter(
    ({ f, src }) =>
      !f.endsWith(path.join('ui', 'Text.tsx')) &&
      /import \{[^}]*\bText\b[^}]*\} from 'react-native'/.test(withoutComments(src)),
  ).map(({ f }) => f);
  assert.deepEqual(direct, []);
});

console.log(`visual system: ${passed} passed`);
