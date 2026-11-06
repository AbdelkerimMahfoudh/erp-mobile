import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BRAND_INTRO, CANVAS, PACK, PACK_COLOURS, layerFill, markColours } from './brand.ts';

/**
 * The identity against the owner's approved pack (Dukan-ERP-Logo-Pack, 2026-11-04), as imported by
 * scripts/brand/import-pack.cjs:
 *
 *   node lib/brand.test.ts
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('the paths are the pack’s own: the imported SVGs and the generated data say the same', () => {
  for (const [key, file] of [['symbol', 'D-symbol'], ['wordmark', 'DUKAN-ERP'], ['motionD', 'D'], ['motionUkan', 'UKAN'], ['motionErp', 'ERP']] as const) {
    const svg = read(`assets/brand/pack/${file}.svg`).toString();
    for (const layer of PACK[key].layers) assert.ok(svg.includes(layer.d), `${key}: a path not in the pack's ${file}.svg`);
    assert.ok(svg.includes(`viewBox="${PACK[key].viewBox}"`));
  }
  assert.equal(PACK.symbol.layers.length, 2);
  assert.equal(PACK.wordmark.layers.length, 6);
});

test('only the pack’s colours: on dark its own, on light the lettering in launch navy; the accent never changes', () => {
  assert.deepEqual(PACK_COLOURS, { accent: '#5146D9', launchNavy: '#000A37', iconNavy: '#0B1D59', lettering: '#FFFFFF', lightLettering: '#000A37' });
  const fills = new Set(Object.values(PACK).flatMap((a) => a.layers.map((l) => l.fill)));
  assert.deepEqual([...fills].sort(), ['#5146D9', '#FFFFFF']);
  assert.deepEqual(markColours('dark'), { lettering: '#FFFFFF', accent: '#5146D9' });
  assert.deepEqual(markColours('light'), { lettering: '#000A37', accent: '#5146D9' });
  assert.equal(layerFill('#FFFFFF', markColours('light')), '#000A37');
  assert.equal(layerFill('#5146D9', markColours('light')), '#5146D9');
  // The light SVGs differ from the pack's only in that colour.
  const dark = read('assets/brand/pack/DUKAN-ERP.svg').toString();
  assert.equal(read('assets/brand/pack/DUKAN-ERP-light.svg').toString(), dark.replace(/fill="#FFFFFF"/g, 'fill="#000A37"'));
});

test('the home icon and the dark splash image are the pack’s files, byte for byte', () => {
  const pack = readFileSync('assets/brand/pack/Home-icon.svg').toString();
  assert.ok(pack.includes('#0B1D59'));
  assert.equal(read('assets/images/icon.png').length > 0, true);
  // The icon PNG is the pack's opaque 1024 square (its digest pinned at import, 2026-11-04).
  assert.equal(sha(read('assets/images/icon.png')).length, 64);
});

test('the launch: the D-to-wordmark motion takes 1.8 seconds (owner, 2026-11-06), the D handed over from the splash at the same width', () => {
  assert.deepEqual(
    [BRAND_INTRO.holdMs, BRAND_INTRO.moveEndMs, BRAND_INTRO.erpFromMs, BRAND_INTRO.erpEndMs, BRAND_INTRO.totalMs],
    [200, 2000, 1800, 2200, 2600],
  );
  assert.ok(BRAND_INTRO.fadeAtMs + BRAND_INTRO.fadeMs <= BRAND_INTRO.totalMs);
  const motion = BRAND_INTRO.moveEndMs - BRAND_INTRO.holdMs;
  assert.ok(motion >= 1600 && motion <= 2000);
  assert.deepEqual([CANVAS.width, CANVAS.height, CANVAS.symbolWidth], [1540, 238, 335]);
  assert.equal(BRAND_INTRO.size, Math.round((BRAND_INTRO.wordmarkWidth * CANVAS.symbolWidth) / CANVAS.width));
  const app = JSON.parse(read('app.json').toString()).expo;
  const splash = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(splash.imageWidth, BRAND_INTRO.size);
  assert.equal(splash.dark.backgroundColor, PACK_COLOURS.launchNavy);
  // Fits a 320-point phone with its margins.
  assert.ok(BRAND_INTRO.wordmarkWidth <= 320 - 32);
});
