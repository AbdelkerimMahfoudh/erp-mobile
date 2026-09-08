/**
 * The bundled Storage and Colour baseline, and the drift that would make it a lie.
 *
 *   node lib/device-attributes-fallback.test.ts
 *
 * ## Why a bundled list exists at all
 *
 * A real iPhone showed both choosers with a search box, no options, and "The
 * list could not be loaded." The endpoint was fine — a stale backend process
 * was 404-ing a route added seven commits after `brands`/`models`, so Brand and
 * Model worked while Storage and Colour did not.
 *
 * But the deeper problem outlived that process: when the request failed, both
 * lists came back EMPTY and the shopkeeper was pushed into typing. This
 * baseline is the floor under that failure.
 *
 * ## The risk it introduces, and the test that contains it
 *
 * Two lists that drift apart silently are worse than one that is occasionally
 * stale, because nobody knows which is right. So the first test here reads the
 * SERVER's own list and fails the moment either side moves.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FALLBACK_STORAGE_OPTIONS,
  FALLBACK_COLOUR_OPTIONS,
  FALLBACK_VARIANT_SEPARATOR,
  fallbackAttributes,
} from './device-attributes-fallback.ts';

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

const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The server's list, parsed out of its TypeScript rather than duplicated here. */
function serverOptions(constName: string): { key: string; label: string }[] {
  const src = source('../backend/src/catalog/device-attributes.ts');
  const start = src.indexOf(`export const ${constName}`);
  assert.ok(start > 0, `${constName} not found in the backend source`);
  const block = src.slice(start, src.indexOf('];', start));
  return [...block.matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)'\s*\}/g)].map((m) => ({
    key: m[1],
    label: m[2],
  }));
}

// ── drift ──────────────────────────────────────────────────────────────────

it('the bundled STORAGE list matches the server exactly', () => {
  assert.deepEqual(
    FALLBACK_STORAGE_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
    serverOptions('STORAGE_OPTIONS'),
  );
});

it('the bundled COLOUR list matches the server exactly', () => {
  assert.deepEqual(
    FALLBACK_COLOUR_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
    serverOptions('COLOUR_OPTIONS'),
  );
});

it('the separator matches the server', () => {
  const src = source('../backend/src/catalog/device-attributes.ts');
  const m = /export const VARIANT_SEPARATOR = '([^']*)'/.exec(src);
  assert.ok(m, 'the server separator could not be read');
  assert.equal(FALLBACK_VARIANT_SEPARATOR, m![1]);
});

// ── the product decision, as data ──────────────────────────────────────────

it('carries every capacity the decision requires', () => {
  const labels = FALLBACK_STORAGE_OPTIONS.map((o) => o.label);
  for (const required of [
    '8 GB', '16 GB', '32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB', '2 TB',
  ]) {
    assert.ok(labels.includes(required), `missing storage ${required}`);
  }
});

it('carries every colour the decision requires', () => {
  const keys = FALLBACK_COLOUR_OPTIONS.map((o) => o.key);
  // `grey` is spelled `gray` canonically; the parser maps one to the other.
  for (const required of [
    'black', 'white', 'gray', 'silver', 'gold', 'blue', 'green',
    'red', 'pink', 'purple', 'yellow', 'orange', 'brown', 'beige',
  ]) {
    assert.ok(keys.includes(required), `missing colour ${required}`);
  }
});

it('keeps a manual escape in both lists, exactly once', () => {
  for (const list of [FALLBACK_STORAGE_OPTIONS, FALLBACK_COLOUR_OPTIONS]) {
    const others = list.filter((o) => o.key === 'other');
    assert.equal(others.length, 1, 'exactly one Other row');
    // And it is last, so it never sits between real choices.
    assert.equal(list[list.length - 1].key, 'other');
  }
});

it('has no duplicate keys or labels after normalisation', () => {
  for (const list of [FALLBACK_STORAGE_OPTIONS, FALLBACK_COLOUR_OPTIONS]) {
    const keys = list.map((o) => o.key.trim().toLowerCase());
    const labels = list.map((o) => o.label.trim().toLowerCase().replace(/\s+/g, ' '));
    assert.equal(new Set(keys).size, keys.length, 'duplicate key');
    assert.equal(new Set(labels).size, labels.length, 'duplicate label');
  }
});

it('hands out a copy, so a caller cannot mutate the baseline', () => {
  const a = fallbackAttributes();
  a.storage.push({ key: 'junk', label: 'Junk' });
  a.colour.length = 0;

  const b = fallbackAttributes();
  assert.equal(b.storage.length, FALLBACK_STORAGE_OPTIONS.length);
  assert.equal(b.colour.length, FALLBACK_COLOUR_OPTIONS.length);
});

it('is shaped exactly like the server payload, so no caller needs a branch', () => {
  const a = fallbackAttributes();
  assert.deepEqual(Object.keys(a).sort(), ['colour', 'describes', 'separator', 'storage']);
  assert.deepEqual(a.describes, ['storage', 'colour']);
});

// ── where it is used, and where it must NOT be ─────────────────────────────

it('is reached only after the request fails AND the cache misses', () => {
  const client = source('lib/device-catalogue.ts');
  const body = client.slice(client.indexOf('export async function fetchAttributes'));

  // Server first.
  assert.ok(
    body.indexOf("origin: 'live'") < body.indexOf('fallbackAttributes()'),
    'the live path comes first',
  );
  // Then the cache.
  assert.ok(
    body.indexOf("origin: 'cached'") < body.indexOf('fallbackAttributes()'),
    'the cached path comes before the bundled floor',
  );
  // And it is inside the catch, not the success path.
  assert.ok(body.indexOf('} catch {') < body.indexOf('fallbackAttributes()'));
});

it('reports its own origin, so a failure never reads as success', () => {
  const client = source('lib/device-catalogue.ts');
  assert.match(client, /origin: 'fallback'/);
  assert.match(
    client,
    /export type CatalogueOrigin =[^;]*'fallback'/,
    'fallback is a first-class origin',
  );
});

it('does NOT bundle brands or models — only these two lists', () => {
  /*
   * Comments stripped first. The header explains WHY this file exists, and
   * that explanation names the iPhone the defect was found on — searching the
   * whole file would flag the prose that justifies the rule as a breach of it.
   * What matters is the data.
   */
  const bundled = withoutComments(source('lib/device-attributes-fallback.ts'));
  assert.ok(!/Samsung|Xiaomi|iPhone|Galaxy/i.test(bundled), 'no device names may be bundled');

  const client = source('lib/device-catalogue.ts');
  const brandsBody = client.slice(
    client.indexOf('async function fetchOrCache'),
    client.indexOf('export function fetchBrands'),
  );
  assert.ok(!brandsBody.includes('fallback'), 'brands and models keep the strict no-bundle rule');
});

it('claims nothing about a specific model', () => {
  const bundled = withoutComments(source('lib/device-attributes-fallback.ts'));
  const select = withoutComments(source('components/catalog/VariantSelect.tsx'));
  // The baseline is generic. Nothing may present it as model-specific.
  assert.ok(!/modelSpecific|forModel|officialColour/i.test(bundled + select));
});

// ── the screen ─────────────────────────────────────────────────────────────

it('shows the options with a non-blocking warning, not the error state', () => {
  const select = source('components/catalog/VariantSelect.tsx');
  // Rendered under `ready`, so the chooser lists real options.
  assert.match(select, /status === 'ready' && origin === 'fallback'/);
  assert.match(select, /catalog\.select\.fallback/);
  // With a retry beside it.
  const block = select.slice(select.indexOf("origin === 'fallback'"));
  assert.match(block.slice(0, 400), /action\.retry/);
});

it('never presents the bundled list as the blocking failure state', () => {
  /*
   * Comments stripped: the error branch's own commentary uses the word
   * "fallback" in prose ("manual entry is a fallback, not the answer"), which
   * has nothing to do with the bundled baseline. Only the code matters.
   */
  const select = withoutComments(source('components/catalog/VariantSelect.tsx'));
  const errorBlock = select.slice(
    select.indexOf("if (status === 'error')"),
    select.indexOf('if (options.length === 0)'),
  );
  assert.ok(!errorBlock.includes('fallback'), 'the error branch is untouched by the baseline');
});

it('the warning is translated in all three languages', () => {
  for (const lang of ['en', 'ar', 'fr']) {
    const dict = source(`lib/i18n/${lang}.ts`);
    assert.match(dict, /'catalog\.select\.fallback':/, `${lang} is missing the key`);
  }
});

console.log(`storage/colour fallback: ${passed} passed`);
