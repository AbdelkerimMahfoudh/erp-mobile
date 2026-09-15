/**
 * The design system, as rules rather than as intentions.
 *
 *   node lib/design/design-system.test.ts
 *
 * Everything here was found by auditing all 56 authenticated routes. Each one
 * is a mistake that had actually been made and would be made again, and each is
 * invisible to TypeScript: a raw hex is a valid string, a NativeWind class is a
 * valid prop, an English label in a lookup table is a valid label.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name).split('\\').join('/');
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Authenticated routes only — the sign-in screens are outside this milestone. */
const ROUTES = walk('app').filter((f) => !f.includes('(auth)') && !f.endsWith('_layout.tsx'));

// ── colour ────────────────────────────────────────────────────────────────

it('no authenticated route carries a raw colour', () => {
  /*
   * The point of the token layer: re-anchoring the accent on `#5146D9` had to
   * reach every screen without any screen being edited. One hex in a screen is
   * one screen that silently keeps the old palette — and, worse, keeps a LIGHT
   * colour after dark.
   */
  const offenders = ROUTES.filter((f) => /#[0-9a-fA-F]{6}\b|rgba?\(/.test(strip(readFileSync(f, 'utf8'))));
  assert.deepEqual(offenders, [], `raw colours in:\n  ${offenders.join('\n  ')}`);
});

it('no authenticated route styles itself with NativeWind classes', () => {
  /*
   * Two screens did — Catalog and Analytics — and both had quietly grown their
   * own search box, their own chips and their own row layout, which drifted
   * from the shared ones independently. A class name cannot read a theme.
   */
  const offenders = ROUTES.filter((f) => /className="/.test(strip(readFileSync(f, 'utf8'))));
  assert.deepEqual(offenders, [], `NativeWind styling in:\n  ${offenders.join('\n  ')}`);
});

it('colour classes cannot hide inside lookup tables either', () => {
  /*
   * The one that escaped the className audit: a map of `text-slate-700` values
   * interpolated into a template string. The class never appeared literally in
   * a `className` attribute, and it put a fixed light colour on the figure a
   * shopkeeper reads — 1.7:1 against the dark canvas.
   */
  const utility = /['"`]text-(slate|gray|zinc|neutral|indigo|red|green|amber)-\d{2,3}['"`]/;
  const offenders = [...ROUTES, ...walk('components'), ...walk('lib')].filter((f) =>
    utility.test(strip(readFileSync(f, 'utf8'))),
  );
  assert.deepEqual(offenders, [], `utility colour strings in:\n  ${offenders.join('\n  ')}`);
});

// ── copy ──────────────────────────────────────────────────────────────────

it('tracking modes are translated, not spelled in English', () => {
  /*
   * `trackingLabel` in `lib/theme.ts` is a hardcoded map — IMEI / Serial /
   * Quantity — that never went through i18n, so an Arabic user read "Quantity".
   * The catalog's own keys exist and are used instead.
   */
  const offenders = [...ROUTES, ...walk('components')].filter((f) =>
    /trackingLabel\[/.test(strip(readFileSync(f, 'utf8'))),
  );
  assert.deepEqual(offenders, [], `untranslated tracking labels in:\n  ${offenders.join('\n  ')}`);
});

// ── the selection wash ────────────────────────────────────────────────────

it('selection is expressed through the token, never a literal', () => {
  const all = [...ROUTES, ...walk('components')];
  const offenders = all.filter((f) => /#EEECFC|#5146D9/i.test(strip(readFileSync(f, 'utf8'))));
  // The palette itself is where those values are allowed to exist.
  assert.deepEqual(offenders, [], `approved colours hardcoded outside the palette:\n  ${offenders.join('\n  ')}`);
});

// ── money ─────────────────────────────────────────────────────────────────

it('a screen showing profit shows its sign, not just its colour', () => {
  /*
   * Red text and green text are the same shape. On analytics especially, the
   * direction of a figure has to survive colour blindness and a monochrome
   * screenshot — so anything toned `auto` is also `signed`.
   */
  const s = strip(readFileSync('app/analytics.tsx', 'utf8'));
  const autoToned = s.match(/<MoneyValue[^/]*tone="auto"[^/]*\/>/g) ?? [];
  assert.ok(autoToned.length > 0, 'expected auto-toned money on analytics');
  for (const m of autoToned) {
    assert.match(m, /signed/, `colour-only direction: ${m.replace(/\s+/g, ' ')}`);
  }
});

console.log(`design system: ${passed} passed`);
