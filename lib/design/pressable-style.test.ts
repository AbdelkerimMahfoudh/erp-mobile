/**
 * No function as a Pressable's style — the rule a white pill on a phone taught us.
 *
 *   node lib/design/pressable-style.test.ts
 *
 * `style={({ pressed }) => [...]}` is Pressable's own API, and in a browser it
 * works. On the phone it does not: NativeWind wraps the core components and its
 * interop drops a function style whole. The Closing history header lost its
 * purple fill that way and showed a white pill with a purple count on it.
 * TypeScript, lint and the web build were all happy, so this source check is
 * the only gate that fails before somebody is holding the phone.
 *
 * The fix is `usePressed()` (components/ui/use-pressed.ts) and a plain style
 * array. In a list the hook lives in the row component, one per row, never in
 * the `map` callback.
 *
 * The JSX is read with the TypeScript parser, so an array, an object or a
 * ternary never matches — only a function handed to `style` on an element whose
 * tag ends in `Pressable`.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');

/** The line of every function handed to a pressable's `style`. */
function functionStyles(source: string): number[] {
  const sf = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /Pressable$/.test(node.tagName.getText(sf))) {
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== 'style') continue;
        const value = a.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
        if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
          lines.push(sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

const FILES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];

it('no Pressable is given a function as its style', () => {
  const offenders: string[] = [];
  for (const file of FILES) {
    for (const line of functionStyles(readFileSync(file, 'utf8'))) offenders.push(`${rel(file)}:${line}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `native drops a function style — use usePressed() and a plain style array:\n  ${offenders.join('\n  ')}`,
  );
});

it('the check catches every function form and nothing else', () => {
  const caught = (jsx: string) => functionStyles(`const x = (${jsx});`).length > 0;

  assert.ok(caught('<Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} />'));
  assert.ok(caught('<Pressable\n  onPress={go}\n  style={({ pressed }) =>\n    [styles.row]\n  }\n>\n  <Text />\n</Pressable>'));
  assert.ok(caught('<AnimatedPressable style={(state) => styles.row} />'));
  assert.ok(caught('<Pressable style={function (state) { return styles.row; }} />'));

  assert.ok(!caught('<Pressable onPress={() => go()} {...pressHandlers} style={[styles.row, pressed ? styles.pressed : null]} />'));
  assert.ok(!caught('<Pressable style={{ opacity: pressed ? 0.6 : 1 }} />'));
  assert.ok(!caught('<Pressable style={pressed ? styles.pressed : styles.row} />'));
  assert.ok(!caught('<Pressable style={styles.row} />'));
  assert.ok(!caught('<View style={[styles.row, { flex: 1 }]} />'));
});

console.log(`pressable style: ${passed} passed, scanned ${FILES.length} files`);
