/**
 * No surface inside a surface — the card-in-card guard.
 *
 *   node lib/design/no-nested-surfaces.test.ts
 *
 * The binding rule: one visible bordered surface per logical section. A bordered
 * or elevated card must never sit inside another. The offence reads as a box
 * drawn inside a box — two edges, two radii, two shadows around one idea — and
 * it had crept back into a dozen screens because nothing failed when it did.
 *
 * A "surface" here is a component that draws its OWN border/box:
 *
 *   Card (card | outlined | accent | warning) · RowGroup · StatTile ·
 *   Toggle (unless `flat`) · ListRow (unless `flat`)
 *
 * Deliberately NOT surfaces, so they are allowed inside one:
 *   - Card `plain` / `sunken` — no border, just a tint or nothing.
 *   - a `flat` ListRow or Toggle — the container owns the edge; that is the
 *     whole point of the flag.
 *   - InlineNotice — a tinted message attached to content, not a card; the rule
 *     is about cards and rows, and a warning belongs beside what it warns about.
 *   - dialogs and bottom sheets — a sheet is the surface, its content is not
 *     nested inside a card on the page.
 *
 * This is a same-file structural check on the TypeScript AST — the honest,
 * deterministic reading of the JSX, not a regex guessing at nesting.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const SURFACE_TAGS = new Set(['Card', 'RowGroup', 'StatTile', 'Toggle', 'ListRow']);

/** Files where a nested surface is a deliberate exception, each with a reason. */
const ALLOW: Record<string, string> = {
  // (none — the rule holds everywhere today)
};

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.expo' || name === 'dist') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function attrText(el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, sf: ts.SourceFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of el.attributes.properties) {
    if (ts.isJsxAttribute(a)) {
      const name = a.name.getText(sf);
      out[name] = a.initializer ? a.initializer.getText(sf) : 'true';
    }
  }
  return out;
}

/** Whether a JSX element draws its own bordered surface. */
function isSurface(tag: string, attrs: Record<string, string>): boolean {
  if (!SURFACE_TAGS.has(tag)) return false;
  if ((tag === 'ListRow' || tag === 'Toggle') && 'flat' in attrs) return false;
  if (tag === 'Card') {
    const v = attrs.variant ?? '';
    if (/plain|sunken/.test(v)) return false;
  }
  return true;
}

const files = walk('app', []).concat(walk('components', []));
const findings: string[] = [];

for (const file of files) {
  const rel = file.split(/[\\/]/).join('/');
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const visit = (node: ts.Node, ancestors: { tag: string; line: number }[]): void => {
    let next = ancestors;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const el = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = el.tagName.getText(sf);
      const attrs = attrText(el, sf);
      if (isSurface(tag, attrs)) {
        const line = sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1;
        if (ancestors.length > 0 && !ALLOW[rel]) {
          const parent = ancestors[ancestors.length - 1];
          findings.push(`${rel}:${line}  <${tag}> inside <${parent.tag}> (line ${parent.line})`);
        }
        next = ancestors.concat([{ tag, line }]);
      }
    }
    ts.forEachChild(node, (c) => visit(c, next));
  };
  visit(sf, []);
}

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
};

it('no bordered surface is nested inside another', () => {
  assert.deepEqual(
    findings,
    [],
    `card-in-card found (make the inner row/toggle \`flat\`, or the outer \`plain\`):\n  ${findings.join('\n  ')}`,
  );
});

it('every allowlisted exception still exists', () => {
  for (const rel of Object.keys(ALLOW)) {
    assert.ok(files.some((f) => f.split(/[\\/]/).join('/') === rel), `ALLOW lists a file that is gone: ${rel}`);
  }
});

console.log(`no-nested-surfaces: ${passed} passed, scanned ${files.length} files`);
