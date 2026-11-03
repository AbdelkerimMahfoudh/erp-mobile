/**
 * The Dukan brand system in the app (the owner's Offset Spiral pack, 2026-11-03), proved without a renderer:
 *
 *   node lib/brand.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BRAND_INTRO, SPIRAL, markColours } from './brand.ts';
import { identity, lightColors, darkColors } from './design/colors.ts';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as { PNG: { sync: { read(b: Buffer): { width: number; height: number; data: Buffer } } } };

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
const read = (p: string) => readFileSync(p, 'utf8');

/** The PNG's colour type from its IHDR: 2 is RGB, 6 is RGBA. */
const colourType = (p: string) => readFileSync(p)[25];

it('the App Store icon is 1024 × 1024, opaque RGB with no alpha channel, and carries no text', () => {
  const file = 'assets/images/icon.png';
  assert.equal(colourType(file), 2, 'RGB, not RGBA');
  const png = PNG.sync.read(readFileSync(file));
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  const svg = read('assets/brand/dukan-app-icon.svg');
  assert.doesNotMatch(svg, /<text/, 'mark only');
});

it('the vector sources keep the three named layers the animation moves', () => {
  for (const f of ['dukan-mark.svg', 'dukan-mark-dark.svg', 'dukan-mark-mono.svg', 'dukan-lockup-light.svg', 'dukan-lockup-dark.svg', 'dukan-app-icon.svg']) {
    const svg = read(`assets/brand/${f}`);
    for (const id of ['spiral-first', 'spiral-second', 'spiral-letter']) assert.match(svg, new RegExp(`id="${id}"`), `${f}: ${id}`);
    // The pack's own geometry, unchanged.
    for (const d of [SPIRAL.first, SPIRAL.second, SPIRAL.letter]) assert.ok(svg.includes(d), `${f}: the pack's path`);
  }
  assert.match(read('assets/brand/dukan-mark-mono.svg'), /currentColor/);
});

it('the mark’s colours are the design tokens, in light and in dark', () => {
  assert.deepEqual(markColours('light'), { first: identity.navy, second: identity.violet, letter: identity.navy });
  assert.deepEqual(markColours('dark'), { first: identity.violet, second: identity.lavender, letter: identity.white });
  // The pack's colours, exactly (DUKAN_BRAND_USAGE_GUIDE §2).
  assert.deepEqual({ ...identity }, { navy: '#1E1B4B', violet: '#7C3AED', lavender: '#A78BFA', white: '#FFFFFF', midnight: '#181735' });
  // Every colour in the shipped SVGs is a token's.
  const tokens = new Set(Object.values(identity).map((c) => c.toUpperCase()));
  for (const f of ['dukan-mark.svg', 'dukan-mark-dark.svg', 'dukan-lockup-light.svg', 'dukan-lockup-dark.svg', 'dukan-app-icon.svg']) {
    for (const hex of read(`assets/brand/${f}`).match(/#[0-9A-Fa-f]{6}/g) ?? []) assert.ok(tokens.has(hex.toUpperCase()), `${f}: ${hex} is not a token`);
  }
});

it('the launch animation is the pack’s three stages in about a second, the D locking last, at the native splash image’s size', () => {
  assert.ok(BRAND_INTRO.totalMs >= 800 && BRAND_INTRO.totalMs <= 1100, `${BRAND_INTRO.totalMs}`);
  assert.ok(BRAND_INTRO.letterAtMs < BRAND_INTRO.arcsMs, 'the D starts while the arcs settle');
  assert.equal(BRAND_INTRO.letterAtMs + BRAND_INTRO.letterMs, BRAND_INTRO.totalMs, 'the D locks last');
  assert.ok(BRAND_INTRO.arcsMs <= BRAND_INTRO.totalMs);
  assert.ok(BRAND_INTRO.arcsOvershootScale > 1 && BRAND_INTRO.letterOvershootScale > 1, 'both pass their size, then settle');
  const app = JSON.parse(read('app.json')).expo;
  const splash = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(splash.imageWidth, BRAND_INTRO.size);
  assert.equal(SPIRAL.viewBox, '24 24 464 464');
});

it('the native splash is static, light and dark, on the app’s own canvas colours — no flash at the hand-over', () => {
  const app = JSON.parse(read('app.json')).expo;
  const splash = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(splash.backgroundColor, lightColors.surface.canvas);
  assert.equal(splash.dark.backgroundColor, darkColors.surface.canvas);
  for (const f of [splash.image, splash.dark.image]) assert.equal(colourType(f.replace('./', '')), 6, `${f}: the mark alone, transparent`);
  assert.match(read('app/_layout.tsx'), /<BrandIntro \/>/);
  assert.match(read('components/brand/DukanMark.tsx'), /const background = colors\.surface\.canvas;/);
});

it('this release is iPhone-only, follows the system appearance, and declares its export compliance', () => {
  const app = JSON.parse(read('app.json')).expo;
  assert.equal(app.ios.supportsTablet, false);
  assert.equal(app.ios.bundleIdentifier, 'mr.tsxmr.dukanerp');
  assert.equal(app.userInterfaceStyle, 'automatic');
  assert.equal(app.ios.config.usesNonExemptEncryption, false);
  assert.equal(app.icon, './assets/images/icon.png');
});

it('no storefront icon or letter tile stands for the brand; operational store icons stay', () => {
  const header = read('components/auth/AuthChrome.tsx');
  assert.doesNotMatch(header, /\bStore\b/);
  assert.match(header, /<DukanMark /);
});

it('the launch overlay never takes a touch while it is up', () => {
  assert.match(read('components/brand/DukanMark.tsx'), /testID="brand-intro" pointerEvents="none"/);
});

it('the mark is never mirrored for Arabic', () => {
  assert.doesNotMatch(read('components/brand/DukanMark.tsx'), /isRTL|scaleX:\s*-1|I18nManager/);
});

console.log(`brand: ${passed} passed`);
