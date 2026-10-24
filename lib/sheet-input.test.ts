/**
 * Typing in a sheet on the web (2026-10-24).
 *
 *   node lib/sheet-input.test.ts
 *
 * In a phone's browser, the fields of Add an account and New team member — and of every sheet — could not be typed
 * into: react-native-web draws a modal through a React portal, React delivered the tap to the screen behind as well, and
 * that screen's blank-space handler dismissed the keyboard, blurring the field the tap had just focused. The cure is at
 * the modal's edge (`ModalBoundary`), so it holds for every modal the app draws, not for two screens. Reproduced and
 * proven in a real browser by `ops/verify-browser-input` (Chromium and WebKit).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { coveredByKeyboard, WEB_KEYBOARD_MIN } from './web-keyboard.ts';

const ROOT = new URL('..', import.meta.url).pathname;
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
const SOURCES = [...files('app'), ...files('components')];
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const code = (f: string) =>
  read(f)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('every modal stops a tap at its edge', () => {
  it('each Modal that draws content wraps it in ModalBoundary, first thing inside', () => {
    const offending: string[] = [];
    let modals = 0;
    for (const f of SOURCES) {
      // The raw source: a comment stripper can be fooled by a "/*" inside a string. Only the comments directly after the
      // tag are skipped.
      const src = read(f);
      for (const m of src.matchAll(/<Modal\b[^>]*?(\/?)>/g)) {
        if (m[1] === '/') continue; // a self-closing modal draws nothing (iOS's hidden dismissal)
        modals++;
        const next = src.slice((m.index ?? 0) + m[0].length).replace(/^(\s|\{\s*\/\*[\s\S]*?\*\/\s*\})*/, '');
        if (!next.startsWith('<ModalBoundary')) offending.push(`${relative(ROOT, join(ROOT, f))}: ${next.slice(0, 40)}`);
      }
    }
    assert.ok(modals >= 3, `found ${modals} modals — the scan must not pass by scanning nothing`);
    assert.deepEqual(offending, []);
  });

  it('the boundary stops only the click, and only on the web', () => {
    const src = code('components/overlay/ModalBoundary.tsx');
    assert.match(src, /Platform\.OS === 'web' \? STOP_AT_EDGE : null/);
    assert.match(src, /onClick: \(event[\s\S]{0,60}=> event\.stopPropagation\(\)/);
    assert.doesNotMatch(src, /onKey(Down|Up)|onPointer|onTouch/, 'key events keep travelling: react-native-web closes on Escape at the document');
  });
});

describe('every sheet form stays reachable with the keyboard up', () => {
  it('a sheet holding a field scrolls — by the sheet’s `scroll`, or by its own scrolling container', () => {
    const offending: string[] = [];
    for (const f of SOURCES) {
      const src = code(f);
      if (!/<BottomSheet\b/.test(src) || !/<(TextField|MoneyField|SearchInput)\b/.test(src)) continue;
      const own = /<(ScrollView|FlatList|SectionList)\b/.test(src);
      for (const m of src.matchAll(/<BottomSheet\b[^>]*>/g)) if (!own && !/\bscroll\b/.test(m[0])) offending.push(f);
    }
    assert.deepEqual([...new Set(offending)], []);
  });

  it('the scrolling sheet lets a tap reach a field or a choice while the keyboard is up', () => {
    const src = code('components/overlay/BottomSheet.tsx');
    assert.match(src, /keyboardShouldPersistTaps="handled"/);
  });

  it('the drag gesture covers the handle and header only, never the fields', () => {
    const src = code('components/overlay/BottomSheet.tsx');
    const detector = src.slice(src.indexOf('<GestureDetector'), src.indexOf('</GestureDetector>'));
    assert.ok(detector.length > 0);
    assert.doesNotMatch(detector, /\{children\}/);
  });
});

describe('the keyboard in a phone’s browser', () => {
  it('is what the visual viewport no longer shows of the window', () => {
    assert.equal(coveredByKeyboard(844, { height: 844, offsetTop: 0 }), 0);
    assert.equal(coveredByKeyboard(844, { height: 508, offsetTop: 0 }), 336);
    // Safari scrolls the visual viewport down as well: what lies above it is not covered by the keyboard.
    assert.equal(coveredByKeyboard(844, { height: 508, offsetTop: 40 }), 296);
  });

  it('a toolbar appearing or hiding is not a keyboard', () => {
    assert.equal(coveredByKeyboard(844, { height: 844 - (WEB_KEYBOARD_MIN - 1), offsetTop: 0 }), 0);
    assert.equal(coveredByKeyboard(844, { height: 900, offsetTop: 0 }), 0);
  });
});
