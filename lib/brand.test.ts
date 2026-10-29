/**
 * The Dukan brand system in the app (the owner's brand pack, 2026-10-29), proved without a renderer:
 *
 *   node lib/brand.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BRAND_INTRO, LEDGER, markColours } from './brand.ts';
import { lightColors, darkColors } from './design/colors.ts';

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
    for (const id of ['ledger-left', 'ledger-right', 'interlock-highlight']) assert.match(svg, new RegExp(`id="${id}"`), `${f}: ${id}`);
  }
  assert.match(read('assets/brand/dukan-mark-mono.svg'), /currentColor/);
});

it('the mark’s colours are the design tokens, in light and in dark', () => {
  assert.deepEqual(markColours('light'), { left: lightColors.text.primary, right: lightColors.brand[600], highlight: lightColors.brand[300] });
  assert.deepEqual(markColours('dark'), { left: darkColors.text.primary, right: darkColors.brand[400], highlight: darkColors.brand[300] });
  assert.equal(lightColors.brand[600], '#5146D9');
  assert.equal(lightColors.text.primary, '#172033');
  // Every colour in the shipped SVGs is a token's.
  const tokens = new Set([lightColors.text.primary, lightColors.brand[600], lightColors.brand[700], lightColors.brand[300], darkColors.text.primary, darkColors.brand[400], '#F7F8FB'].map((c) => c.toUpperCase()));
  for (const f of ['dukan-mark.svg', 'dukan-mark-dark.svg', 'dukan-lockup-light.svg', 'dukan-lockup-dark.svg', 'dukan-app-icon.svg']) {
    for (const hex of read(`assets/brand/${f}`).match(/#[0-9A-Fa-f]{6}/g) ?? []) assert.ok(tokens.has(hex.toUpperCase()), `${f}: ${hex} is not a token`);
  }
});

it('the launch animation is 800–1100 ms, the connection drawn last, and the same size as the native splash image', () => {
  assert.ok(BRAND_INTRO.totalMs >= 800 && BRAND_INTRO.totalMs <= 1100, `${BRAND_INTRO.totalMs}`);
  assert.ok(BRAND_INTRO.drawAtMs >= BRAND_INTRO.enterMs, 'the connection draws after the halves arrive');
  assert.equal(BRAND_INTRO.drawAtMs + BRAND_INTRO.drawMs, BRAND_INTRO.totalMs);
  assert.ok(BRAND_INTRO.rightLagMs + BRAND_INTRO.enterMs + BRAND_INTRO.settleMs <= BRAND_INTRO.totalMs);
  assert.ok(BRAND_INTRO.overshootUnits > 0 && BRAND_INTRO.overshootUnits < BRAND_INTRO.enterUnits / 4, 'a slight overshoot');
  const app = JSON.parse(read('app.json')).expo;
  const splash = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(splash.imageWidth, BRAND_INTRO.size);
  assert.equal(LEDGER.viewBox, '96 96 832 832');
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
