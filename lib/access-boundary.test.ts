/**
 * The App Store boundary of the customer app (docs/21, 2026-10-05; docs/68).
 *
 *   node lib/access-boundary.test.ts
 *
 * Business access is acquired, paid, renewed and administered on a separate
 * website. The customer app only reads the server's business-access state and
 * shows it in neutral words. These keep it that way — in the source and in all
 * three catalogues: no platform console, no website or payment link, no price
 * for the app's own access, no purchase or renewal wording, no payment
 * instruction for us. A shop's OWN payment channels (cash, Bankily, the accounts
 * it configures to receive its customers' money) are the shop's business, not
 * ours, and are deliberately left alone.
 *
 * Two owner decisions of 2026-10-13 amend it, narrowly. A business account is
 * created in the app again — on the app's own `auth/register` routes, never the
 * platform's, and in words that name no price, no payment and no website. And
 * the app may SAY what the server knows about the one 7-day free trial —
 * eligible and not started, running until its end, ended — in its own keys
 * only (`trialSetup.*`, `access.state.trial_*`, `access.trial.*`), while it can
 * DO nothing about it: no claim, no resend or send, no link or token, no
 * website, no QR code, no web view, no browser, no price and no payment
 * instruction. The trial is started on the website alone; resending its
 * instructions happens there, after the Owner signs in, or through support.
 * The owner's decision of 2026-10-15 adds the stores and staff seats an Owner
 * may request during a trial: the app prices, sells and activates neither.
 *
 * What a word or a route is, is `scripts/boundary-rules.cjs`'s — the list the
 * bundle audit (`scripts/audit-bundle.js`) holds the shipped bundles to, so the
 * source and what ships are judged alike: words after their spelling is
 * normalized, in each language's own verbs; routes decoded and in any case.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import ts from 'typescript';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';
import { BACK_PARENTS, TABS } from './navigation/back.ts';
import { ACCESS_CLOSED, ACCESS_STATUS, APP_HOME, LOGIN, SELECT_BRANCH } from './navigation/entry.ts';
import { internalRoute } from './navigation/internal-route.ts';
import { HUBS, allDestinations, tabRouteOf } from './navigation/registry.ts';

const rules = createRequire(import.meta.url)('../scripts/boundary-rules.cjs');
const ROOT = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), 'utf8');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.expo' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const SOURCES = ['app', 'lib', 'hooks', 'components', 'constants'].flatMap((d) => walk(new URL(d, ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const code = (f: string) => strip(readFileSync(f, 'utf8'));
const relative = (f: string) => f.slice(new URL('.', ROOT).pathname.length);

/**
 * Every key of a catalogue with its value, in the catalogue's order — read from the catalogue itself, so a value
 * written in any form (on several lines, joined with `+`) is the value checked.
 */
const CATALOGUES: Record<string, Record<string, string>> = { en, fr, ar };
const entries = (lang: string): [string, string][] => Object.entries(CATALOGUES[lang]);
const LANGS = ['en', 'fr', 'ar'];

/** A source file's syntax tree, parsed once for every check that reads it. */
const trees = new Map<string, ts.SourceFile>();
function treeOf(file: string): ts.SourceFile {
  if (!trees.has(file)) trees.set(file, ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  return trees.get(file)!;
}
/** Every node of a tree, depth first — gathered once per tree. */
const nodeLists = new Map<ts.SourceFile, ts.Node[]>();
function nodesOf(tree: ts.SourceFile): ts.Node[] {
  let out = nodeLists.get(tree);
  if (!out) {
    const nodes: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      nodes.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    nodeLists.set(tree, (out = nodes));
  }
  return out;
}
/** Every declaration in a file, by the name it binds: a variable, a parameter, a destructured name, a function, a class or an import. */
const declarationIndex = new Map<ts.SourceFile, Map<string, ts.Node[]>>();
function declarationsOf(name: string, tree: ts.SourceFile): ts.Node[] {
  let index = declarationIndex.get(tree);
  if (!index) {
    index = new Map();
    for (const n of nodesOf(tree)) {
      const declares = ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n);
      if (declares && n.name !== undefined && ts.isIdentifier(n.name)) index.set(n.name.text, [...(index.get(n.name.text) ?? []), n]);
    }
    declarationIndex.set(tree, index);
  }
  return index.get(name) ?? [];
}

/**
 * The text a source file holds, however it is written: every string literal, every template (an interpolation read
 * as the number a placeholder becomes), every run of JSX text, and literals joined with `+` read as the one string
 * they make. `module` marks a module's name — an import, never words on a screen.
 */
function textsOf(file: string): { text: string; module: boolean }[] {
  const source = treeOf(file);
  const out: { text: string; module: boolean }[] = [];
  const joined = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => `7${span.literal.text}`).join('');
    if (ts.isParenthesizedExpression(node)) return joined(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const [left, right] = [joined(node.left), joined(node.right)];
      return left === null && right === null ? null : `${left ?? '7'}${right ?? '7'}`;
    }
    return null;
  };
  const isModuleName = (node: ts.Node): boolean => {
    const parent = node.parent;
    return (
      ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) ||
      ts.isExternalModuleReference(parent) ||
      (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) ||
      (ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(parent.expression) && parent.expression.text === 'require')))
    );
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push({ text: node.text, module: isModuleName(node) });
    else if (ts.isTemplateExpression(node)) out.push({ text: joined(node)!, module: false });
    else if (ts.isJsxText(node) && node.text.trim()) out.push({ text: node.text, module: false });
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const text = joined(node);
      if (text !== null) out.push({ text, module: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}
/** The app's own source, the catalogues aside: they are read key by key, against the keys a word belongs to. */
const CODE_SOURCES = SOURCES.filter((f) => !/[\\/]lib[\\/]i18n[\\/](en|fr|ar)\.ts$/.test(f));

/** A value with what does not change it taken away: `as`, `!`, `satisfies`, a type assertion, parentheses. */
function bare(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
  return n;
}
/** What every `const` of that name in a file starts as — nothing when the name is ever bound another way. */
function constantsNamed(name: string, tree: ts.SourceFile): ts.Expression[] {
  const values: ts.Expression[] = [];
  for (const node of declarationsOf(name, tree)) {
    if (!(ts.isVariableDeclaration(node) && node.initializer && (node.parent.flags & ts.NodeFlags.Const) !== 0)) return [];
    values.push(node.initializer);
  }
  return values;
}

/**
 * The browser guard (`lib/navigation/no-browser.ts`): the one module that names `Linking` or `openURL`, to make every
 * `openURL` refuse, and that reaches `window.open`, to let a new tab open only for a `blob:` page.
 */
const GUARD = 'lib/navigation/no-browser.ts';

/**
 * A path of the app's own: `/`, and no host after it (`//host`, `/\host`) — nor a `.` or `..` segment, which a
 * router's resolution could turn into one (`/..//host`).
 */
const PATH = /^\/(?![/\\])(?!(?:[^?#]*[/\\])?\.\.?(?:[/\\?#]|$))/;
/** A path whose first segment is written out, so a template may go on after it. */
const SEGMENT = new RegExp(`${PATH.source}[^/\\\\]`);
/** A first segment written out: something, neither a `/` nor a `.` or `..` of its own. */
const FIRST_SEGMENT = /^(?!\.\.?(?:[/\\?#]|$))[^/\\]/;
/**
 * The route registries a navigation may read, each by the module it must be imported from and checked below to hold
 * only the app's own paths: the tabs and the back parents, the sign-in guard's routes, a tab hub's tab — and a
 * server's link once `internalRoute` has kept it.
 */
const REGISTRIES: Record<string, string> = {
  TABS: 'navigation/back',
  backTarget: 'navigation/back',
  LOGIN: 'navigation/entry',
  SELECT_BRANCH: 'navigation/entry',
  ACCESS_CLOSED: 'navigation/entry',
  ACCESS_STATUS: 'navigation/entry',
  APP_HOME: 'navigation/entry',
  entryRoute: 'navigation/entry',
  tabRouteOf: 'navigation/registry',
  internalRoute: 'navigation/internal-route',
};
/** Where the app's own modules are, as an import resolves them. */
const LIB = new URL('lib', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1');
/**
 * The module a name is imported from, as itself — a module of the app's own by the path it resolves to, a package by
 * its name — when nothing else in the file is bound to that name; otherwise null.
 */
function importedModule(name: string, tree: ts.SourceFile): string | null {
  const [declaration, ...others] = declarationsOf(name, tree);
  if (!declaration || others.length > 0 || !ts.isImportSpecifier(declaration) || (declaration.propertyName ?? declaration.name).text !== name) return null;
  const statement = declaration.parent.parent.parent;
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return null;
  const module = statement.moduleSpecifier.text;
  return module.startsWith('.') ? join(dirname(tree.fileName), module).replace(/\.tsx?$/, '') : module;
}
/** Whether a name is a registry's own: imported, as itself, from its registry's module, and bound to nothing else in the file. */
const fromRegistry = (name: string, tree: ts.SourceFile): boolean => Object.hasOwn(REGISTRIES, name) && importedModule(name, tree) === join(LIB, REGISTRIES[name]);
/** The first segments a value can be, when each is written out: `type === 'consignment' ? 'consignments' : 'loans'`. */
function segmentsOf(node: ts.Expression): string[] | null {
  const n = bare(node);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
  if (!ts.isConditionalExpression(n)) return null;
  const [yes, no] = [segmentsOf(n.whenTrue), segmentsOf(n.whenFalse)];
  return yes && no ? [...yes, ...no] : null;
}

/** The registry's lists of destinations (`lib/navigation/registry.ts`), and the lookup of the hub whose children one lists. */
const LISTS = ['allDestinations', 'hubById', 'moneyRows', 'visibleChildren', 'visibleGroups'];
/** What hands each item of a list to a callback. */
const ITERATORS = ['map', 'flatMap', 'find', 'filter', 'forEach', 'some', 'every'];
/**
 * Whether a value holds only what the registry lists, or nothing: one of its lists or one of its hubs (a hub's
 * children only for a hub it holds), an item found in such a list, a name holding one — or a choice between them.
 */
function listing(node: ts.Expression, tree: ts.SourceFile, depth: number): boolean {
  const n = bare(node);
  if (n.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(n) && n.text === 'undefined')) return true;
  if (ts.isConditionalExpression(n)) return listing(n.whenTrue, tree, depth) && listing(n.whenFalse, tree, depth);
  if (ts.isIdentifier(n)) return listed(n.text, tree, depth + 1);
  if (!ts.isCallExpression(n)) return false;
  const callee = n.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'find' && listing(callee.expression, tree, depth);
  if (!ts.isIdentifier(callee) || !LISTS.includes(callee.text) || importedModule(callee.text, tree) !== join(LIB, 'navigation/registry')) return false;
  return callee.text !== 'visibleChildren' || (n.arguments[0] !== undefined && listing(n.arguments[0], tree, depth));
}
/**
 * Whether a name holds only what the registry lists: each of its declarations is a `const` given such a value
 * (`const children = visibleChildren(hub, …)`, `const expenses = actions.find(…)`), or the item — whole, or a field
 * of it — that such a list hands its callback (`children.map((child) => …)`, `groups.map(({ destinations }) => …)`).
 */
function listed(name: string, tree: ts.SourceFile, depth = 0): boolean {
  const declarations = declarationsOf(name, tree);
  return (
    depth < 6 &&
    declarations.length > 0 &&
    declarations.every((declaration) => {
      if (ts.isVariableDeclaration(declaration)) return (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && declaration.initializer !== undefined && listing(declaration.initializer, tree, depth);
      let parameter: ts.Node = declaration;
      while (ts.isBindingElement(parameter)) parameter = parameter.parent.parent;
      if (!ts.isParameter(parameter)) return false;
      const callback = parameter.parent;
      const call = callback.parent;
      return (
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        callback.parameters[0] === parameter &&
        ts.isCallExpression(call) &&
        call.arguments[0] === callback &&
        ts.isPropertyAccessExpression(call.expression) &&
        ITERATORS.includes(call.expression.name.text) &&
        listing(call.expression.expression, tree, depth)
      );
    })
  );
}
/** A destination's route, read from what the registry lists: `child.route`. */
function listedRoute(node: ts.Expression, tree: ts.SourceFile): boolean {
  const n = bare(node);
  return ts.isPropertyAccessExpression(n) && n.name.text === 'route' && ts.isIdentifier(n.expression) && listed(n.expression.text, tree);
}
/**
 * Whether a navigation target can only be a screen of the app's own: a path written out (a literal or a template that
 * starts with `/` and its first segment), an object whose `pathname` is one and nothing spread over it, a `const` or a
 * choice between such, a route a registry holds — read from its registry, never from a value the app was given — or a
 * destination's route from the registry's lists.
 */
function leadsInside(node: ts.Expression, tree: ts.SourceFile): boolean {
  const n = bare(node);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return PATH.test(n.text);
  if (ts.isTemplateExpression(n)) {
    const [first] = n.templateSpans;
    if (n.head.text === '/') return segmentsOf(first.expression)?.every((segment) => FIRST_SEGMENT.test(segment + first.literal.text)) ?? false;
    if (n.head.text === '') return first.literal.text.startsWith('/') && listedRoute(first.expression, tree);
    return SEGMENT.test(n.head.text);
  }
  if (ts.isConditionalExpression(n)) return leadsInside(n.whenTrue, tree) && leadsInside(n.whenFalse, tree);
  if (ts.isObjectLiteralExpression(n)) {
    const pathname = n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && nameOf(p.name) === 'pathname');
    return pathname !== undefined && !n.properties.some(ts.isSpreadAssignment) && leadsInside(pathname.initializer, tree);
  }
  if (ts.isIdentifier(n)) {
    const values = constantsNamed(n.text, tree);
    return values.length > 0 ? values.every((value) => leadsInside(value, tree)) : fromRegistry(n.text, tree);
  }
  if (ts.isPropertyAccessExpression(n)) return listedRoute(n, tree) || (ts.isIdentifier(n.expression) && n.expression.text === 'TABS' && fromRegistry('TABS', tree));
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && fromRegistry(n.expression.text, tree);
}
/** A property's name as written: `href`, `'href'`, `['href']`; null when it is computed. */
function nameOf(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression) ? name.expression.text : null;
}
/**
 * Every name a property can have: as written, or — computed — each string the `const` it is computed from can hold
 * (`const KEY = 'href'; { [KEY]: … }`); null when a name cannot be read.
 */
function keyNamesOf(name: ts.PropertyName, tree: ts.SourceFile): string[] | null {
  const written = nameOf(name);
  if (written !== null) return [written];
  if (!ts.isComputedPropertyName(name)) return null;
  const n = bare(name.expression);
  if (!ts.isIdentifier(n)) return segmentsOf(n);
  const values = constantsNamed(n.text, tree).map(segmentsOf);
  return values.length > 0 && values.every((v) => v !== null) ? values.flat() as string[] : null;
}

/** What expo-router gives that can lead anywhere: its router, the hook that hands it out, and its two components. */
const NAVIGATORS = ['router', 'useRouter', 'Link', 'Redirect'];
/** A router's ways to go somewhere — each held to where it goes — and its ways to stay or only go back. */
const GOES = ['push', 'replace', 'navigate', 'dismissTo', 'prefetch'];
const STAYS = ['back', 'canGoBack', 'canDismiss', 'dismiss', 'dismissAll', 'setParams'];
/** The hooks that take a list of what they depend on: a router may be named there, to be compared, never called. */
const DEPENDENT_HOOKS = ['useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useCallback', 'useMemo', 'useImperativeHandle'];
/**
 * The two paths inside expo-router the app imports, each for one name that goes nowhere — whether a header is shown,
 * and a hook that keeps a screen from being left with unsaved work — in `lib/navigation/router-internals.ts` alone.
 */
const ROUTER_INTERNALS: Record<string, string> = {
  'expo-router/build/react-navigation/elements/Header/HeaderShownContext': 'HeaderShownContext',
  'expo-router/build/react-navigation/core/usePreventRemove': 'usePreventRemove',
};
/**
 * The browser export's page shell (`app/+html.tsx`, 2026-10-24) imports Expo's scroll-style reset from
 * `expo-router/html`, by that one name, there alone: it renders a `<style>` and leads nowhere.
 */
const HTML_SHELL = { file: 'app/+html.tsx', module: 'expo-router/html', name: 'ScrollViewStyleReset', tags: ['html', 'head', 'meta', 'script', 'style', 'body'] };
/** The module a node imports or re-exports — by `import`, `export … from`, `import … = require`, `require()` or `import()` — or null. */
function moduleOf(node: ts.Node): string | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) return node.moduleReference.expression.text;
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
    const [first] = node.arguments;
    return first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
  }
  return null;
}
/** An identifier read as a value in code — not a declaration, a property's name or a type. */
function isReference(node: ts.Identifier): boolean {
  if (!isValueUse(node)) return false;
  for (let p: ts.Node = node.parent; !ts.isSourceFile(p); p = p.parent) if (ts.isTypeNode(p)) return false;
  return true;
}
/**
 * Every place a source could lead outside the app — each found where it is written:
 * - expo-router reached other than by name: as a namespace or a default, a navigator under another name, `require`,
 *   `import()`, a re-export, or a path inside the package (but the two pinned internals);
 * - a router — `router`, or a `const` given `useRouter()` — used any way but calling one of its own methods on the
 *   spot (destructured, aliased, handed on, read by a computed name, bound again), unless only named among a hook's
 *   dependencies; and a `push`, `replace`, `navigate`, `dismissTo` or `prefetch` whose target is not provably the
 *   app's own;
 * - `useRouter()` anywhere but as a `const`'s value;
 * - `<Link>` or `<Redirect>` anywhere but as an element, given spread props or an `href` not provably the app's own;
 * - any other element given an `href`, `hrefAttrs` or a data detector (text whose links the phone opens by itself,
 *   past the browser guard), a refresh (`httpEquiv`) or a form's address (`formAction`); and any object given an
 *   `href` that is not one of the app's own paths, or any of those others — by its name, or by a `const` it is
 *   computed from;
 * - a page's own element (`<a>`, `<form>`, `<meta>`, `<object>`, `<embed>`, `<iframe>`, `<base>` — any lowercase tag,
 *   the `action` of a form among its props): the app draws with React Native's components, and on the web such an
 *   element can point the page anywhere, send it, refresh it or show another page inside it. Nor is an element made
 *   by hand (`createElement`, the JSX runtime's `jsx`), or given props spread from what cannot be read for its names;
 * - a registry, or what it lists, written to: assigned, deleted, given to `Object.assign` and the like, or changed in
 *   place by an array's own methods (`push`, `splice`, `sort`, … — called on it, or through `call` and `apply`).
 */
function leadsOutside(file: string): string[] {
  const tree = treeOf(file);
  const rel = relative(file);
  const nodes = nodesOf(tree);
  const found = new Set<ts.Node>();

  const navigators = new Set<string>();
  for (const node of nodes) {
    const module = moduleOf(node);
    if (module === null || !/^expo-router(?:\/|$)/.test(module)) continue;
    if (module === HTML_SHELL.module && rel === HTML_SHELL.file) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const only = clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map((e) => e.name.text) : [];
      if (!(only.length === 1 && only[0] === HTML_SHELL.name)) found.add(node);
      continue;
    }
    if (module !== 'expo-router') {
      const internal = Object.hasOwn(ROUTER_INTERNALS, module) ? ROUTER_INTERNALS[module] : null;
      const names = ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => [(e.propertyName ?? e.name).text, e.name.text]) : [];
      if (!(rel === 'lib/navigation/router-internals.ts' && names.length === 1 && names[0][0] === internal && names[0][1] === internal)) found.add(node);
      continue;
    }
    const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      found.add(node);
      continue;
    }
    for (const e of clause.namedBindings.elements) {
      const imported = (e.propertyName ?? e.name).text;
      if (!NAVIGATORS.includes(imported)) continue;
      if (imported === e.name.text) navigators.add(imported);
      else found.add(e);
    }
  }

  // The routers: `router` itself, and each `const` given `useRouter()` — and nothing else of their names in the file.
  const routers = new Set(navigators.has('router') ? ['router'] : []);
  const fromHook = (n: ts.Node): boolean =>
    ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && (n.parent.flags & ts.NodeFlags.Const) !== 0 && n.initializer !== undefined && ts.isCallExpression(n.initializer) && n.initializer.arguments.length === 0 && ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === 'useRouter';
  for (const node of nodes) {
    if (!ts.isIdentifier(node) || node.text !== 'useRouter' || !navigators.has('useRouter') || !isReference(node)) continue;
    const declaration = node.parent.parent;
    if (ts.isCallExpression(node.parent) && node.parent.expression === node && fromHook(declaration) && (declaration as ts.VariableDeclaration).initializer === node.parent) routers.add(((declaration as ts.VariableDeclaration).name as ts.Identifier).text);
    else found.add(node.parent);
  }
  for (const name of routers) for (const declaration of declarationsOf(name, tree)) if (!fromHook(declaration) && !ts.isImportSpecifier(declaration)) found.add(declaration);

  for (const node of nodes) {
    if (ts.isIdentifier(node) && isReference(node) && routers.has(node.text)) {
      // A router is used one way: a method of its own, called on the spot — or named among a hook's dependencies.
      const access = node.parent;
      const call = access.parent;
      const method = ts.isPropertyAccessExpression(access) && access.expression === node && ts.isCallExpression(call) && call.expression === access ? access.name.text : null;
      if (method !== null && STAYS.includes(method)) continue;
      if (method !== null && GOES.includes(method)) {
        const [target] = (call as ts.CallExpression).arguments;
        if (target === undefined || ts.isSpreadElement(target) || !leadsInside(target, tree)) found.add(call);
        continue;
      }
      const hook = ts.isArrayLiteralExpression(access) && ts.isCallExpression(call) && call.arguments[call.arguments.length - 1] === access ? call.expression : null;
      if (hook && DEPENDENT_HOOKS.includes(ts.isPropertyAccessExpression(hook) ? hook.name.text : hook.getText(tree))) continue;
      found.add(method !== null ? call : access);
    } else if (ts.isIdentifier(node) && isReference(node) && (node.text === 'Link' || node.text === 'Redirect') && navigators.has(node.text)) {
      // Link and Redirect are elements, never values, and their props are written out — never spread.
      const element = node.parent;
      if (!((ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) || ts.isJsxClosingElement(element)) && element.tagName === node)) found.add(element);
      else if (!ts.isJsxClosingElement(element) && element.attributes.properties.some(ts.isJsxSpreadAttribute)) found.add(element);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(tree);
      const tag = node.parent.parent.tagName.getText(tree);
      const value = node.initializer && (ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer);
      const link = (tag === 'Link' || tag === 'Redirect') && navigators.has(tag);
      if (LEAVING_PROPS.includes(name) || (name === 'href' && !(link && value && leadsInside(value, tree)))) found.add(node);
    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const names = keyNamesOf(node.name, tree) ?? [];
      const value = ts.isPropertyAssignment(node) ? node.initializer : node.name;
      const none = (v: ts.Expression): boolean => {
        const b = bare(v);
        return b.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(b) && b.text === 'undefined') || (ts.isConditionalExpression(b) && none(b.whenTrue) && none(b.whenFalse));
      };
      if (names.some((name) => LEAVING_PROPS.includes(name)) || (names.includes('href') && !none(value) && !leadsInside(value, tree))) found.add(node);
    } else if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && intrinsic(node.tagName)) {
      // The page shell is a document: its own html, head, meta, script, style and body, and no link among them.
      const shellTag = rel === HTML_SHELL.file && ts.isIdentifier(node.tagName) && HTML_SHELL.tags.includes(node.tagName.text);
      if (!shellTag) found.add(node);
    } else if (ts.isJsxSpreadAttribute(node) && !readableProps(node.expression, tree)) {
      found.add(node);
    } else if (ts.isCallExpression(node) && madeByHand(node, tree)) {
      found.add(node);
    } else {
      // What the registry holds is read, never written.
      const target = writtenTo(node, tree);
      if (target === undefined) continue;
      let root = bare(target);
      while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = bare(root.expression);
      const module = ts.isIdentifier(root) ? importedModule(root.text, tree) : null;
      const registry = ts.isIdentifier(root) ? (module !== null && module.startsWith(join(LIB, 'navigation') + sep)) || listed(root.text, tree) : ts.isCallExpression(root) && listing(root, tree, 0);
      if (registry) found.add(node);
    }
  }
  return [...found].map((node) => `${rel}: ${node.getText(tree)}`);
}

/** The props that point an element somewhere, refresh the page or send a form — whatever element is given them. */
const LEAVING_PROPS = ['hrefAttrs', 'dataDetectorType', 'dataDetectorTypes', 'httpEquiv', 'formAction'];
/** A tag of the page's own: lowercase (`a`, `form`, `meta`), custom (`my-element`) or namespaced (`svg:a`) — never one of the app's components. */
const intrinsic = (tag: ts.JsxTagNameExpression): boolean => (ts.isIdentifier(tag) && /^[a-z]|-/.test(tag.text)) || ts.isJsxNamespacedName(tag);
/** What makes an element from a tag or a component without JSX: React's `createElement`, the JSX runtime's `jsx`. */
const ELEMENT_MAKERS = ['createElement', 'createElementNS', 'createFactory', 'jsx', 'jsxs', 'jsxDEV'];
/** An element made by hand — by React or the JSX runtime, not a document's (`browserUses` holds those): the app writes its elements as JSX. */
function madeByHand(call: ts.CallExpression, tree: ts.SourceFile): boolean {
  const callee = bare(call.expression);
  if (ts.isIdentifier(callee)) return ELEMENT_MAKERS.includes(callee.text);
  return ts.isPropertyAccessExpression(callee) && ELEMENT_MAKERS.includes(callee.name.text) && !windowish(callee.expression, tree);
}
/**
 * Whether props spread into an element can be read for the names they carry: an object written out whose every key is
 * a name it can read (`keyNamesOf`), a `const` holding one, nothing, a choice between them, or what the element's own
 * caller gave it — a parameter, a field of one, what a hook hands back — whose names are checked where they are written.
 */
function readableProps(node: ts.Expression, tree: ts.SourceFile, depth = 0): boolean {
  const n = bare(node);
  if (depth > 5) return false;
  if (n.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(n) && n.text === 'undefined')) return true;
  if (ts.isObjectLiteralExpression(n)) return n.properties.every((p) => (ts.isSpreadAssignment(p) ? readableProps(p.expression, tree, depth + 1) : keyNamesOf(p.name!, tree) !== null));
  if (ts.isConditionalExpression(n)) return readableProps(n.whenTrue, tree, depth + 1) && readableProps(n.whenFalse, tree, depth + 1);
  if (ts.isIdentifier(n)) return constantsNamed(n.text, tree).every((value) => readableProps(value, tree, depth + 1));
  return ts.isPropertyAccessExpression(n);
}
/** An array's own methods that change it in place. */
const MUTATORS = ['push', 'unshift', 'splice', 'fill', 'copyWithin', 'sort', 'reverse', 'pop', 'shift'];
/**
 * What a node writes to, if anything: what it assigns or deletes, what it gives `Object.assign` and the like, and the
 * array it changes in place — `list.push(…)`, `Array.prototype.splice.call(list, …)`, `Reflect.apply(push, list, …)`.
 */
function writtenTo(node: ts.Node, tree: ts.SourceFile): ts.Expression | undefined {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && !ts.isIdentifier(bare(node.left))) return node.left;
  if (ts.isDeleteExpression(node)) return node.expression;
  if (!ts.isCallExpression(node)) return undefined;
  const callee = bare(node.expression);
  const text = callee.getText(tree);
  if (/^(?:Object|Reflect)\.(?:assign|defineProperty|defineProperties|set|setPrototypeOf|deleteProperty)$/.test(text)) return node.arguments[0];
  if (text === 'Reflect.apply') return node.arguments[1];
  const method = (e: ts.Expression): string | null => (ts.isPropertyAccessExpression(e) ? e.name.text : ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression) ? e.argumentExpression.text : null);
  const called = method(callee);
  if (called !== null && MUTATORS.includes(called)) return (callee as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
  if ((called === 'call' || called === 'apply') && MUTATORS.includes(method(bare((callee as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression)) ?? '')) return node.arguments[0];
  return undefined;
}

/** The names a page's window goes by — and its document, from which the window is one property away. */
const WINDOWISH = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames', 'document']);
/** Whether an expression is the page's window or document, by name, by a property that leads to it, or by a `const` given one. */
function windowish(node: ts.Expression, tree: ts.SourceFile): boolean {
  const n = bare(node);
  if (ts.isIdentifier(n)) return WINDOWISH.has(n.text) || constantsNamed(n.text, tree).some((value) => windowish(value, tree));
  if (ts.isPropertyAccessExpression(n)) return WINDOWISH.has(n.name.text) || n.name.text === 'defaultView' || n.name.text === 'ownerDocument';
  return false;
}
/** A declaration that only says a global exists (`declare const navigation`): the name is still the page's own. */
const ambient = (node: ts.Node): boolean => (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Ambient) !== 0;
/** What a page's markup is written through — so a link or a refresh can be planted in it. */
const MARKUP = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createContextualFragment', 'srcdoc'];
/** What, called on an element, points it somewhere or sends a form. */
const POINTS = ['setAttribute', 'setAttributeNS', 'submit', 'requestSubmit'];
/**
 * Every way a source reaches for a page's own browser: opening a window (by name, by a computed name, or the page's
 * own global `open`), reading or writing its location (by name, through a window or a document, destructured), the
 * page's navigation (`window.navigation` or the global), `defaultView`, writing a document or a page's markup, making
 * an element other than a download link, pointing an element somewhere (an `href` assigned, `setAttribute`) or
 * sending a form.
 */
function browserUses(file: string): string[] {
  const tree = treeOf(file);
  const out: string[] = [];
  const member = (node: ts.Node): { object: ts.Expression; name: string } | null =>
    ts.isPropertyAccessExpression(node) ? { object: node.expression, name: node.name.text } : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? { object: node.expression, name: node.argumentExpression.text } : null;
  for (const node of nodesOf(tree)) {
    const m = member(node);
    const called = ts.isCallExpression(node) ? member(node.expression) : null;
    if (m && (m.name === 'open' || m.name === 'location') && windowish(m.object, tree)) {
      const read = m.name === 'location' && member(node.parent)?.name === 'hostname' && !(ts.isBinaryExpression(node.parent.parent) && node.parent.parent.left === node.parent);
      out.push(read ? `reads ${node.parent.getText(tree)}` : node.getText(tree));
    } else if (m && (m.name === 'defaultView' || MARKUP.includes(m.name) || (['navigation', 'write', 'writeln'].includes(m.name) && windowish(m.object, tree)))) out.push(node.getText(tree));
    else if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression) && windowish(node.expression, tree)) out.push(node.getText(tree));
    else if (called && POINTS.includes(called.name)) out.push(node.getText(tree));
    else if (called && called.name === 'createElement' && windowish(called.object, tree) && !(ts.isCallExpression(node) && node.arguments[0] !== undefined && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === 'a')) out.push(node.getText(tree));
    else if (called && called.name === 'createElementNS' && windowish(called.object, tree)) out.push(node.getText(tree));
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && member(node.left)?.name === 'href') out.push(`assigns ${node.left.getText(tree)}`);
    else if (ts.isObjectBindingPattern(node) && ts.isVariableDeclaration(node.parent) && node.parent.initializer && windowish(node.parent.initializer, tree)) {
      for (const e of node.elements) if (['open', 'location', 'navigation'].includes((e.propertyName ?? e.name).getText(tree))) out.push(`destructures ${e.getText(tree)}`);
    } else if (ts.isIdentifier(node) && node.text === 'location' && !constantsNamed('location', tree).length && isValueUse(node)) out.push('location');
    else if (ts.isIdentifier(node) && (node.text === 'open' || node.text === 'navigation') && isValueUse(node) && !declarationsOf(node.text, tree).some((d) => !ambient(d))) out.push(`the page's own ${node.text}`);
  }
  return out.map((use) => `${relative(file)}: ${use}`);
}
/** An identifier used as a value — not a member's or a key's name, a declaration, an import or a label; a shorthand property is one. */
function isValueUse(node: ts.Identifier): boolean {
  const p = node.parent;
  const named = ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p);
  const declared = ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isBindingElement(p);
  return !(
    (named && p.name === node) ||
    (declared && p.name === node) ||
    (ts.isBindingElement(p) && p.propertyName === node) ||
    ts.isImportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    ts.isJsxAttribute(p) ||
    ts.isLabeledStatement(p) ||
    ts.isBreakOrContinueStatement(p)
  );
}
/** A query that carries the setup link's `t`: `new URLSearchParams({ t })`, `[['t', …]]`, or a `const` given one; `.set('t', …)`, `.append('t', …)`. */
function tokenQueries(file: string): string[] {
  const tree = treeOf(file);
  const out: string[] = [];
  const carries = (e: ts.Expression): boolean => {
    const n = bare(e);
    if (ts.isObjectLiteralExpression(n)) return n.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && nameOf(p.name) === 't');
    if (ts.isArrayLiteralExpression(n)) return n.elements.some((pair) => ts.isArrayLiteralExpression(pair) && pair.elements[0] !== undefined && ts.isStringLiteralLike(pair.elements[0]) && pair.elements[0].text === 't');
    return ts.isIdentifier(n) && constantsNamed(n.text, tree).some(carries);
  };
  for (const node of nodesOf(tree)) {
    if (!(ts.isCallExpression(node) || ts.isNewExpression(node)) || !node.arguments?.length) continue;
    const callee = node.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) ? callee.argumentExpression.text : null;
    const [first] = node.arguments;
    if ((name === 'URLSearchParams' && carries(first)) || ((name === 'set' || name === 'append') && ts.isStringLiteralLike(first) && first.text === 't')) out.push(`${relative(file)}: ${node.getText(tree)}`);
  }
  return out;
}

/**
 * What a source names, wherever it is written, that opens a browser or a web view, draws a QR code, or reaches past the
 * browser guard: a web view or a browser library, a QR component, an iframe; React Native's native modules, through
 * which `openURL` could be called without its JavaScript; a data detector, through which a phone opens a link in text
 * by itself; a page written to leave — in any string, template or joined string, markup that refreshes the page, links
 * it, sends it, shows another page inside it or runs a script of its own (`rules.WRITTEN_WAY_OUT`, `<script>`, a
 * `javascript:` address) — such as the report's own page could carry; and — but in the guard — `openURL` in any form
 * (called, destructured, on a namespace) and `Linking` at all: the app's deep links are expo-router's, and nothing of
 * its own needs React Native's Linking or expo-linking.
 */
function browserNames(file: string): string[] {
  const text = strip(treeOf(file).text);
  const names = [...text.matchAll(/WebView|WebBrowser\.|openBrowserAsync|openAuthSessionAsync|<QRCode\b|<iframe\b|\bNativeModules\b|\bTurboModuleRegistry\b|\brequireNative\w*|\bdataDetectorTypes?\b|http-equiv|<a\s[^>]*\bhref\b/gi)].map(([name]) => name);
  if (relative(file) !== GUARD) names.push(...[...text.matchAll(/openURL|\bLinking\b|expo-linking/g)].map(([name]) => name));
  for (const { text: written, module } of textsOf(file)) if (!module && MARKUP_WAY_OUT.test(written)) names.push(`a page written to leave: ${written.slice(0, 120)}`);
  return names.map((name) => `${relative(file)}: ${name}`);
}
/** Markup that leaves the page (`rules.WRITTEN_WAY_OUT`, which the bundle audit holds too) — or runs a script, which no page the app writes does. */
const MARKUP_WAY_OUT = new RegExp(`${rules.WRITTEN_WAY_OUT.source}|<script\\b|javascript:`, 'i');

/** The only keys that may name the free trial, and the trial's words (`scripts/boundary-rules.cjs`, shared with the bundle audit). */
const { TRIAL_KEY, TRIAL_WORDS } = rules;
/**
 * What a source's own text says about the trial, outside the catalogues: a claim or a resend in any wording, or the
 * trial named other than by the names the code knows it by (`rules.TRIAL_NAME`: a whole key, its read-only route, its
 * query key, its card's test id) — words a screen could show.
 */
function trialWording(file: string): string[] {
  const offending: string[] = [];
  for (const { text, module } of textsOf(file)) {
    const words = rules.normalizeWords(text);
    for (const [name, pattern] of rules.TRIAL_ACTIONS as [string, RegExp][]) if (pattern.test(words)) offending.push(`${relative(file)} (${name}): ${text}`);
    if (!module && TRIAL_WORDS.test(words) && !rules.TRIAL_NAME.test(text)) offending.push(`${relative(file)} names the trial: ${text}`);
  }
  return offending;
}

/**
 * The third-party packages the app's source may import — and does. A new one
 * is a decision, not a convenience: a QR encoder, a web view or a browser is
 * exactly what the app must not carry, and it would arrive as an import.
 */
const PACKAGES = [
  '@tanstack/react-query', 'date-fns', 'expo-camera', 'expo-clipboard', 'expo-constants', 'expo-document-picker', 'expo-file-system',
  'expo-haptics', 'expo-image', 'expo-image-picker', 'expo-localization', 'expo-print', 'expo-router', 'expo-secure-store', 'expo-sharing',
  'expo-splash-screen', 'expo-status-bar', 'lucide-react-native', 'react', 'react-native', 'react-native-gesture-handler',
  'react-native-reanimated', 'react-native-safe-area-context', 'react-native-svg', 'zustand',
];
/** The third-party packages a module imports — `@scope/name` or `name`, without the path inside it. */
function packagesOf(source: string): string[] {
  const specs = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
  return specs.filter((s) => !/^(\.|\/|@\/)/.test(s)).map((s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]));
}

/**
 * The trial's words, exactly as the owner approved them (SPEC §10; "being sent", shared contract C1; instructions sent
 * on a day and no longer working, or sent and the latest lost, C17), in all three languages. A new key in these
 * families, a changed sentence or a missing one fails here first.
 */
const TRIAL_COPY: Record<string, Record<string, string>> = {
  en: {
    'access.state.trial_available': 'Not started',
    'access.state.trial_active': 'Free trial',
    'access.state.trial_expired': 'Free trial ended',
    'access.trial.ends': 'Ends {date}',
    'access.trial.active': 'Free trial: active, ends {date}',
    'access.trial.ended': 'The free trial ended on {date}. You can still read and export everything.',
    'trialSetup.title': 'Your business is eligible for a 7-day free trial',
    'trialSetup.notStarted': 'Your trial has not started yet.',
    'trialSetup.status': 'Trial status: Available',
    'trialSetup.status.label': 'Trial status: Available, not started',
    'trialSetup.duration': 'Duration after activation: {durationDays} days',
    'trialSetup.startsAfterClaim': 'Starts only after you claim it',
    'trialSetup.contact': 'Verified contact: {masked}',
    'trialSetup.delivery.sent': 'We sent the instructions for completing your business setup to your verified contact.',
    'trialSetup.delivery.sent.whatsapp': 'We sent the instructions for completing your business setup by WhatsApp to {masked} on {date}.',
    'trialSetup.delivery.sent.email': 'We sent the instructions for completing your business setup by email to {masked} on {date}.',
    'trialSetup.delivery.sending': 'We are sending the instructions for completing your business setup to your verified contact.',
    'trialSetup.delivery.waiting.phone': 'The instructions will be sent automatically once your WhatsApp number is verified.',
    'trialSetup.delivery.waiting.email': 'The instructions will be sent automatically once your email address is verified.',
    'trialSetup.delivery.failed': 'The setup instructions could not be sent. Your trial has not started. Please contact Dukan ERP support.',
    'trialSetup.delivery.not_sent': 'The setup instructions have not been sent. Your trial has not started. Please contact Dukan ERP support.',
    'trialSetup.delivery.not_sent.latest': 'The setup instructions were sent to your verified contact on {date}, but the latest ones have not been sent. Your trial has not started. Please contact Dukan ERP support.',
  },
  fr: {
    'access.state.trial_available': 'Pas encore commencé',
    'access.state.trial_active': 'Essai gratuit',
    'access.state.trial_expired': 'Essai gratuit terminé',
    'access.trial.ends': 'Se termine le {date}',
    'access.trial.active': 'Essai gratuit : actif, se termine le {date}',
    'access.trial.ended': 'L’essai gratuit s’est terminé le {date}. Vous pouvez encore tout consulter et tout exporter.',
    'trialSetup.title': 'Votre commerce peut bénéficier d’un essai gratuit de 7 jours',
    'trialSetup.notStarted': 'Votre essai n’a pas encore commencé.',
    'trialSetup.status': 'Statut de l’essai : disponible',
    'trialSetup.status.label': 'Statut de l’essai : disponible, pas encore commencé',
    'trialSetup.duration': 'Durée après activation : {durationDays} jours',
    'trialSetup.startsAfterClaim': 'Ne commence qu’après votre demande',
    'trialSetup.contact': 'Contact vérifié : {masked}',
    'trialSetup.delivery.sent': 'Nous avons envoyé les instructions pour finaliser la configuration de votre commerce à votre contact vérifié.',
    'trialSetup.delivery.sent.whatsapp': 'Nous avons envoyé les instructions pour finaliser la configuration de votre commerce par WhatsApp au {masked} le {date}.',
    'trialSetup.delivery.sent.email': 'Nous avons envoyé les instructions pour finaliser la configuration de votre commerce par e-mail à {masked} le {date}.',
    'trialSetup.delivery.sending': 'Nous envoyons les instructions pour finaliser la configuration de votre commerce à votre contact vérifié.',
    'trialSetup.delivery.waiting.phone': 'Les instructions seront envoyées automatiquement dès que votre numéro WhatsApp sera vérifié.',
    'trialSetup.delivery.waiting.email': 'Les instructions seront envoyées automatiquement dès que votre adresse e-mail sera vérifiée.',
    'trialSetup.delivery.failed': 'Les instructions de configuration n’ont pas pu être envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
    'trialSetup.delivery.not_sent': 'Les instructions de configuration n’ont pas été envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
    'trialSetup.delivery.not_sent.latest': 'Les instructions de configuration ont été envoyées à votre contact vérifié le {date}, mais les plus récentes n’ont pas été envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
  },
  ar: {
    'access.state.trial_available': 'لم تبدأ بعد',
    'access.state.trial_active': 'فترة تجريبية مجانية',
    'access.state.trial_expired': 'انتهت الفترة التجريبية المجانية',
    'access.trial.ends': 'تنتهي في {date}',
    'access.trial.active': 'الفترة التجريبية المجانية: نشطة، تنتهي في {date}',
    'access.trial.ended': 'انتهت الفترة التجريبية المجانية في {date}. لا يزال بإمكانك قراءة كل شيء وتصديره.',
    'trialSetup.title': 'نشاطك التجاري مؤهل لفترة تجريبية مجانية مدتها 7 أيام',
    'trialSetup.notStarted': 'لم تبدأ فترتك التجريبية بعد.',
    'trialSetup.status': 'حالة الفترة التجريبية: متاحة',
    'trialSetup.status.label': 'حالة الفترة التجريبية: متاحة، لم تبدأ بعد',
    'trialSetup.duration': 'المدة بعد التفعيل: {durationDays} أيام',
    'trialSetup.startsAfterClaim': 'لا تبدأ إلا بعد أن تطلبها',
    'trialSetup.contact': 'وسيلة الاتصال المُتحقق منها: {masked}',
    'trialSetup.delivery.sent': 'أرسلنا تعليمات إكمال إعداد نشاطك التجاري إلى وسيلة الاتصال التي تم التحقق منها.',
    'trialSetup.delivery.sent.whatsapp': 'أرسلنا تعليمات إكمال إعداد نشاطك التجاري عبر واتساب إلى {masked} في {date}.',
    'trialSetup.delivery.sent.email': 'أرسلنا تعليمات إكمال إعداد نشاطك التجاري عبر البريد الإلكتروني إلى {masked} في {date}.',
    'trialSetup.delivery.sending': 'نرسل الآن تعليمات إكمال إعداد نشاطك التجاري إلى وسيلة الاتصال التي تم التحقق منها.',
    'trialSetup.delivery.waiting.phone': 'سيتم إرسال التعليمات تلقائيًا بمجرد التحقق من رقم واتساب الخاص بك.',
    'trialSetup.delivery.waiting.email': 'سيتم إرسال التعليمات تلقائيًا بمجرد التحقق من بريدك الإلكتروني.',
    'trialSetup.delivery.failed': 'تعذّر إرسال تعليمات الإعداد. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
    'trialSetup.delivery.not_sent': 'لم تُرسل تعليمات الإعداد. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
    'trialSetup.delivery.not_sent.latest': 'أُرسلت تعليمات الإعداد إلى وسيلة الاتصال التي تم التحقق منها في {date}، لكن أحدث التعليمات لم تُرسل. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
  },
};

describe('the website’s entry points are gone from the app', () => {
  it('the helper, the hook and the signup link no longer exist', () => {
    for (const f of ['lib/portal.ts', 'hooks/useAccountPortal.ts', 'lib/signup.ts']) {
      assert.equal(existsSync(new URL(f, ROOT)), false, `${f} must not exist`);
    }
  });

  it('no source builds, configures or opens a website address', () => {
    for (const f of SOURCES) {
      const text = code(f);
      for (const banned of ['EXPO_PUBLIC_PORTAL_URL', 'EXPO_PUBLIC_SIGNUP_URL', 'accountPortalUrl', 'signupUrl', 'portal-handoff', 'portal-session', 'openAccountPortal', 'useAccountPortal']) {
        assert.equal(text.includes(banned), false, `${f} must not mention ${banned}`);
      }
      assert.doesNotMatch(text, rules.WEBSITE_ADDRESS, `${f} names a website address`);
      assert.doesNotMatch(text, /SITE_URL|WEBSITE_URL/i, `${f} configures a website`);
    }
  });

  it('the app imports only the third-party packages it is known to use — no QR encoder, web view or browser can arrive unseen', () => {
    const imported = new Map<string, string>();
    for (const f of SOURCES) for (const pkg of packagesOf(code(f))) if (!imported.has(pkg)) imported.set(pkg, relative(f));
    const unknown = [...imported].filter(([pkg]) => !PACKAGES.includes(pkg)).map(([pkg, f]) => `${pkg} (${f})`);
    assert.deepEqual(unknown, [], 'a package outside the allowlist is imported');
    assert.deepEqual([...imported.keys()].sort(), [...PACKAGES].sort(), 'the allowlist names a package the app no longer imports: take it out');
  });

  it('nothing opens a browser: no openURL in any form, no Linking at all — but in the guard that makes every openURL refuse', () => {
    assert.deepEqual(SOURCES.flatMap(browserNames), []);
    // The guard refuses: React Native's openURL — which expo-linking and expo-router call — and, on the web, any new
    // tab but a blob page. The root layout installs it once, at module scope, before any screen exists. It keeps the
    // phone's own opener first, and reaches it only for an exact legal page (the owner's brief of 2026-10-16).
    const guard = code(new URL(GUARD, ROOT).pathname);
    assert.equal((guard.match(/openURL/g) ?? []).length, 2);
    assert.match(guard, /^\s*const phone = Linking\.openURL\.bind\(Linking\);\n\s*Linking\.openURL = \(\) => Promise\.reject\(new Error\('Dukan ERP opens no address outside the app\.'\)\);$/m);
    assert.match(guard, /^\s*legalOpener \?\?= tab \?\? phone;$/m);
    // The kept opener is called once, with the address built here from a page and a language — never one passed in.
    assert.deepEqual([...guard.matchAll(/legalOpener\(([^)]*)\)/g)].map(([, arg]) => arg), ['url']);
    assert.match(guard, /^export function openLegalPage\(page: LegalPage, language: Language\): Promise<unknown> \{\n\s*const url = LEGAL_ORIGIN \? legalPageUrl\(LEGAL_ORIGIN, page, language\) : '';\n\s*if \(!legalOpener \|\| !isLegalPageUrl\(LEGAL_ORIGIN, url\)\) return Promise\.reject/m);
    // Only the legal pages' component opens one.
    assert.deepEqual(SOURCES.filter((f) => relative(f) !== GUARD && /\bopenLegalPage\b/.test(code(f))).map(relative), ['components/legal/LegalPages.tsx']);
    assert.match(guard, /^\s*window\.open = \(url, \.\.\.rest\) => \(String\(url \?\? ''\)\.startsWith\('blob:'\) \? open\(url, \.\.\.rest\) : null\);$/m);
    assert.doesNotMatch(guard, /expo-linking|location|href|require\(/);
    assert.match(strip(read('app/_layout.tsx')), /^import \{ refuseBrowser \} from '\.\.\/lib\/navigation\/no-browser';$[\s\S]*^refuseBrowser\(\);$/m);
  });

  it('every navigation leads to a screen of the app’s own — a path written out, or a route its registries hold — and expo-router is reached only by name, a router only through its own methods', () => {
    assert.deepEqual(SOURCES.flatMap(leadsOutside), []);
  });

  it('the route registries hold only the app’s own paths, and a server’s link is followed only when it is one', () => {
    for (const [tab, route] of Object.entries(TABS)) assert.match(route, PATH, tab);
    for (const route of [LOGIN, SELECT_BRANCH, ACCESS_CLOSED, ACCESS_STATUS, APP_HOME]) assert.match(route, PATH);
    for (const [child, parent] of Object.entries(BACK_PARENTS)) assert.match(parent, PATH, child);
    // A destination's route is continued in templates (`${expenses.route}/new`): its first segment is written out.
    for (const d of allDestinations()) assert.match(d.route, SEGMENT, d.id);
    for (const hub of HUBS) assert.match(tabRouteOf(hub), PATH, hub.id);
    // The sign-in guard answers one of its own routes, or nothing.
    const entry = treeOf(new URL('lib/navigation/entry.ts', ROOT).pathname);
    const answers = nodesOf(entry).filter(ts.isReturnStatement).map((r) => r.expression!);
    const routeOrNothing = (e: ts.Expression): boolean =>
      e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && ['LOGIN', 'SELECT_BRANCH', 'ACCESS_CLOSED', 'ACCESS_STATUS', 'APP_HOME'].includes(e.text)) || (ts.isConditionalExpression(e) && routeOrNothing(e.whenTrue) && routeOrNothing(e.whenFalse));
    assert.ok(answers.length >= 5);
    assert.deepEqual(answers.filter((e) => !routeOrNothing(e)).map((e) => e.getText(entry)), []);
    assert.equal(internalRoute('https://example.invalid/account/trial#t=token'), null);
    assert.equal(internalRoute('//example.invalid'), null);
  });

  it('no page navigates itself or opens a window but the report’s and the receipt’s preview, the CSV download and the guard', () => {
    assert.deepEqual(SOURCES.flatMap(browserUses).sort(), [
      // The web build's API host is the page's own: read, never written.
      'constants/config.ts: reads (globalThis as { location?: { hostname?: string } }).location?.hostname',
      // The report's preview and the customer's receipt: a new tab on a blob made from the page already in memory.
      'lib/browser-tab.ts: window.open',
      // The guard: a new tab only for a blob page.
      'lib/navigation/no-browser.ts: window.open',
      'lib/navigation/no-browser.ts: window.open',
      // The CSV the browser saves: a link to a blob made from the report already in memory.
      'lib/report-export.ts: assigns link.href',
    ]);
    assert.match(code(new URL('lib/browser-tab.ts', ROOT).pathname), /const url = URL\.createObjectURL\(new Blob\(\[html\][^)]*\)\);\s*const tab = window\.open\(url, '_blank'\);/);
    assert.match(code(new URL('lib/report-export.ts', ROOT).pathname), /const url = URL\.createObjectURL\(blob\);\s*const link = document\.createElement\('a'\);\s*link\.href = url;/);
  });

  it('the app never asks the server for a price, a payment instruction, a store or a seat, or the platform’s own routes — in any spelling', () => {
    for (const f of SOURCES) {
      const route = rules.normalizePath(code(f));
      for (const [name, pattern] of rules.ROUTES) assert.doesNotMatch(route, pattern, `${f} reaches a ${name}`);
    }
  });

  it('the free trial can only be read here (2026-10-13): no claim, no resend, no link token — in any letter case or spelling', () => {
    // The token's marks in any string, however it is written, and in a query built from parts.
    const marked = CODE_SOURCES.flatMap((f) => textsOf(f).filter(({ text, module }) => !module && rules.TOKEN_MARKER.test(rules.normalizePath(text))).map(({ text }) => `${relative(f)}: ${text}`));
    assert.deepEqual([...marked, ...SOURCES.flatMap(tokenQueries)], []);
    for (const f of SOURCES) {
      const text = code(f);
      assert.doesNotMatch(rules.normalizePath(text), rules.TOKEN_MARKER, `${f} carries a setup-link token marker`);
      assert.doesNotMatch(text, /claimTrial/i, `${f} reaches a trial action`);
      // The one trial request there is: a read. Nothing about the trial is ever posted, put, patched or deleted.
      assert.doesNotMatch(text, /api\.(post|put|patch|delete)(?:<[^>]*>)?\(\s*['`][^'`]*trial/i, `${f} writes something about the trial`);
    }
    const reads = SOURCES.flatMap((f) => [...code(f).matchAll(/api\.get(?:<[^>]*>)?\(\s*['`]([^'`]*trial[^'`]*)['`]/gi)].map((m) => m[1]));
    assert.deepEqual(reads, ['/account/trial-setup']);
  });

  it('the Owner’s trial card is display only: nothing pressable, linked, sent or counted down', () => {
    const card = strip(read('components/access/TrialSetupCard.tsx'));
    assert.doesNotMatch(card, /\b(Button|IconButton|Pressable|Touchable\w*|Link|FilterChip|Toggle)\b|onPress|onLongPress|href=/);
    assert.doesNotMatch(card, /\bapi\b|api\.post|useMutation|useRouter|router\.|Linking|WebView|useCountdown|Date\.now/);
  });

  it('the platform console is not in the customer app (2026-10-05)', () => {
    for (const f of ['app/platform', 'lib/platform-admin.ts', 'lib/platform-state.ts', 'app/subscription.tsx', 'app/subscription-blocked.tsx']) {
      assert.equal(existsSync(new URL(f, ROOT)), false, `${f} must not exist`);
    }
    assert.doesNotMatch(strip(read('app/(auth)/login.tsx')), /\/platform|auth\.action\.platform/i, 'sign-in offers no console');
  });

  it('a business account is created in the app again (2026-10-13), through the app’s own auth/register routes only', () => {
    for (const f of ['app/(auth)/register.tsx', 'app/(auth)/verify.tsx', 'lib/registration.ts', 'lib/registration-session.ts']) {
      assert.equal(existsSync(new URL(f, ROOT)), true, `${f} must exist`);
    }
    const login = strip(read('app/(auth)/login.tsx'));
    assert.match(login, /title=\{t\('auth\.action\.createAccount'\)\}[\s\S]*?onPress=\{\(\) => router\.push\('\/\(auth\)\/register' as never\)\}/, 'sign-in offers Create a business account, a screen of this app');
    assert.match(login, /auth\.accounts\.managed/, 'and says who creates an employee’s account');
    // The only registration requests anywhere in the app are the three auth/register routes.
    const registration = SOURCES.flatMap((f) =>
      [...code(f).matchAll(/api\.(?:get|post|put|patch|delete)(?:<[^>]*>)?\(\s*['`]([^'`]*regist[^'`]*)['`]/gi)].map((m) => m[1]),
    );
    assert.deepEqual([...new Set(registration)].sort(), ['/auth/register', '/auth/register/verify/confirm', '/auth/register/verify/start']);
  });
});

describe('the access screens', () => {
  const closed = strip(read('app/access-closed.tsx'));
  const status = strip(read('app/access.tsx'));

  it('the closed screen names every closed state from the server, and offers check again, sign out and the way out', () => {
    assert.match(closed, /closedReason\(entitlement\?\.state\)/);
    assert.match(closed, /access\.recheck/);
    assert.match(closed, /action\.signOut/);
    assert.match(closed, /account\.delete\.link/);
    assert.match(closed, /access\.managed/);
    assert.doesNotMatch(closed, /http|www\.|MRU|\d{3,}|\bpay|portal|website|renew|subscri/i);
  });

  it('the status screen shows state and dates only — no price, no allowance arithmetic, no action, no clock', () => {
    assert.match(status, /access\.active\.until/);
    assert.match(status, /access\.grace\.body/);
    assert.match(status, /access\.readOnly\.body/);
    assert.match(status, /access\.managed/);
    assert.doesNotMatch(status, /http|www\.|MRU|\bpay|portal|website|renew|subscri|Bankily/i);
    assert.doesNotMatch(status, /subscribedBranchCount|seatLimit|includedSeats|additionalSeats|seatsUsed|daysRemaining|graceHoursRemaining/, 'no billing composition, no countdown computed on the phone');
    assert.doesNotMatch(status, /Date\.now|new Date\(|getTime\(/, 'no date arithmetic on the phone');
  });

  it('the five tabs share the one notice and read the one access decision', () => {
    for (const f of ['app/(tabs)/index.tsx', 'app/(tabs)/partners.tsx', 'app/(tabs)/money-hub.tsx', 'app/(tabs)/inventory.tsx', 'app/(tabs)/more.tsx']) {
      assert.match(strip(read(f)), /<AccessNotice/, `${f} shows the shared notice`);
    }
    for (const f of ['app/(tabs)/index.tsx', 'app/(tabs)/partners.tsx', 'app/(tabs)/money-hub.tsx', 'app/(tabs)/inventory.tsx', 'app/closing/index.tsx']) {
      assert.match(strip(read(f)), /access\.canWrite/, `${f} offers its business writes only while the server accepts them`);
    }
    // A refused write names the access, never a role.
    assert.match(strip(read('lib/errors.ts')), /ENTITLEMENT_WRITE_BLOCKED[\s\S]*access\.blocked\.title/);
  });
});

describe('stores and staff seats (the owner, 2026-10-15)', () => {
  it('the app requests no store or seat, and prices, sells and activates neither: a staff member’s seat is the platform’s word', () => {
    for (const f of SOURCES) assert.doesNotMatch(rules.normalizePath(code(f)), /seat-requests|store-requests|activity-requests|activity-options|my-subscription/i, `${f} reaches a store or seat request`);
    // The team's own writes: a member created pending (with its invitation), a new invitation, an account withdrawn, a
    // member edited, a delegation. No code is ever sent from here (D214).
    const team = ['app/team.tsx', 'components/team/CreateMemberSheet.tsx', 'components/team/PendingPanel.tsx'].map((f) => strip(read(f))).join('\n');
    const writes = [...team.matchAll(/api\.(post|put|patch|delete)(?:<[^>]*>)?\(\s*([`'][^`']*[`']|\w+)/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual([...new Set(writes)].sort(), [
      'delete path', "post '/users'", 'post `/users/${user.id}/cancel-invitation`', 'post `/users/${user.id}/invitation`', 'put path', 'patch `/users/${user!.id}`',
    ].sort());
    // What the team is told about seats: creating a member, a member waiting, a refusal (no seat free), staff over the limit.
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(team\.create\.|team\.pending\.|team\.error\.|access\.staff\.)/.test(key)) continue;
        assert.doesNotMatch(rules.normalizeWords(value), rules.ACCESS_PRICE, `${lang} ${key} prices a seat: ${value}`);
        assert.doesNotMatch(value, /\bMRU\b|أوقية|\bpay\b|\bpaid\b|\bpayer\b|\bpaiement\b|ادفع|الدفع|\bbuy\b|\bpurchase\b|\bachet|اشترِ|\bwebsite\b|\bsite\b|موقع|https?:|www\./i, `${lang} ${key}: ${value}`);
      }
    }
  });
});

describe('the words', () => {
  it('the guard reads every key of every catalogue: each one its file writes, each value a sentence it can check', () => {
    for (const lang of LANGS) {
      // The catalogue as its file writes it: the exported object, every property a key written as itself — no spread,
      // computed key or getter through which a value could arrive unseen.
      const file = treeOf(new URL(`lib/i18n/${lang}.ts`, ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
      const declaration = nodesOf(file).find((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(file) === lang);
      const object = declaration?.initializer && bare(declaration.initializer);
      assert.ok(object && ts.isObjectLiteralExpression(object), `${lang}: the catalogue is one object literal`);
      const written = object.properties.map((p) => (ts.isPropertyAssignment(p) ? nameOf(p.name) : null));
      assert.deepEqual(object.properties.filter((p, i) => written[i] === null).map((p) => p.getText(file).slice(0, 80)), [], `${lang}: a property not written as a key`);
      // What the guard reads is the module itself, so a value written in any form (joined, on several lines) is read
      // as it will show; here, every key the file writes, in its order, each a non-empty string.
      const read = entries(lang);
      assert.equal(read.length, written.length, `${lang}: the guard reads ${read.length} of the ${written.length} keys its file writes`);
      assert.deepEqual(read.map(([key]) => key), written, `${lang}: the keys read are the keys written`);
      assert.deepEqual(read.filter(([, value]) => typeof value !== 'string' || value.trim() === '').map(([key]) => key), [], `${lang}: a value that is not a sentence`);
    }
    assert.deepEqual(LANGS.map((lang) => entries(lang).length), LANGS.map(() => entries('en').length), 'the three catalogues hold as many keys');
  });

  it('no catalogue carries console or subscription-management copy', () => {
    for (const lang of LANGS) {
      const dict = read(`lib/i18n/${lang}.ts`);
      assert.doesNotMatch(dict, /^\s*'(platform|sub|subscription|entitlement)\./m, `${lang} still carries removed copy`);
      for (const removed of ["'sub.manage'", "'auth.signup.unconfigured'", "'auth.signup.unavailable'", "'auth.action.platform'"]) {
        assert.equal(dict.includes(removed), false, `${lang} still has ${removed}`);
      }
      for (const needed of ["'access.managed'", "'access.mistake'", "'access.closed.rejected.body'", "'auth.accounts.managed'", "'auth.action.createAccount'", "'register.unavailable'"]) {
        assert.equal(dict.includes(needed), true, `${lang} lacks ${needed}`);
      }
    }
  });

  it('the access, sign-in, sign-up, trial and legal-page copy never names a price, a payment, a way to buy or renew, or a website — in any language', () => {
    const forbidden = /\bMRU\b|أوقية|https?:|www\.|\bwebsite\b|\bsite\b|موقع|\brenew|renouvel|تجديد|\bsubscri|\babonne|اشتراك|اشترك|\bbuy\b|\bpurchase\b|\bachet|اشترِ|\bpay\b|\bpaid\b|\bpayer\b|\bpaiement\b|ادفع|الدفع|Bankily|بنكيلي|\bcheckout\b|in-app|App Store|Apple|\bQR\b|\bclick\b|\bcliquez\b/i;
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(access\.|nav\.access|auth\.|register\.|trialSetup\.|legal\.|sync\.reason\.entitlement_blocked|hub\.business\.desc|more\.group\.account)/.test(key)) continue;
        assert.doesNotMatch(value, forbidden, `${lang} ${key}: ${value}`);
      }
    }
  });

  it('no key of any catalogue names a link — the website’s, the setup’s or any other — in any language', () => {
    // "link" as the verb for joining a file's rows to a product: the shop's own records, not an address.
    const LINK_VERB: Record<string, string> = { 'fileReceive.create.product': 'Create and link product' };
    const link = rules.words(/\blinks?\b|\bliens?\b|رابط|روابط/i);
    for (const lang of LANGS) {
      const offending = entries(lang)
        .filter(([key, value]) => link.test(rules.normalizeWords(value)) && !(lang === 'en' && LINK_VERB[key] === value))
        .map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} names a link:\n  ${offending.join('\n  ')}`);
    }
  });

  it('the trial is named only in its own keys — checked in every other key of every catalogue', () => {
    for (const lang of LANGS) {
      const offending = entries(lang)
        .filter(([key, value]) => !TRIAL_KEY.test(key) && TRIAL_WORDS.test(rules.normalizeWords(value)))
        .map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} names the trial outside its own keys:\n  ${offending.join('\n  ')}`);
    }
  });

  it('no source says the trial’s actions or names the trial — in every string, template and JSX text outside the catalogues', () => {
    assert.deepEqual(CODE_SOURCES.flatMap(trialWording), []);
  });

  it('nowhere does the app price its own access, or ask to be paid, renewed or subscribed to', () => {
    // Shop-side money (a sale's amount in MRU, a customer paying by Bankily) is the shop's; what must be absent is OUR price and OUR call to action.
    const ours = /renew(al)?\b|renouvel|تجديد الاشتراك|subscribe|abonnez|اشترك الآن|in-app purchase|achat intégré/i;
    for (const lang of LANGS) {
      const offending = entries(lang)
        .filter(([, value]) => ours.test(value) || rules.ACCESS_PRICE.test(rules.normalizeWords(value)) || rules.PAYMENT_INSTRUCTION.test(rules.normalizeWords(value)))
        .map(([key, value]) => `${key}: ${value}`);
      assert.deepEqual(offending, [], `${lang} prices or sells the app's own access:\n  ${offending.join('\n  ')}`);
    }
  });

  it('no catalogue carries the trial’s actions — a claim, a resend or a send — in any language or spelling', () => {
    for (const lang of LANGS) {
      const offending = entries(lang).flatMap(([key, value]) =>
        rules.TRIAL_ACTIONS.filter(([, pattern]: [string, RegExp]) => pattern.test(rules.normalizeWords(value))).map(([name]: [string]) => `${key} (${name}): ${value}`),
      );
      assert.deepEqual(offending, [], `${lang} carries a trial action:\n  ${offending.join('\n  ')}`);
    }
  });

  it('the trial’s keys say exactly what the owner approved, and exist in all three languages in the same order', () => {
    for (const lang of LANGS) {
      assert.deepEqual(Object.fromEntries(entries(lang).filter(([key]) => TRIAL_KEY.test(key))), TRIAL_COPY[lang], `${lang} trial copy`);
    }
    assert.equal(en['access.closed.not_started.title'], 'Access has not started yet');
    assert.equal(en['access.closed.not_started.body'], 'The business owner is finishing the setup. Check again later.');
    const scoped = (lang: string) => entries(lang).map(([key]) => key).filter((key) => TRIAL_KEY.test(key) || /^(access\.closed\.not_started|register\.|auth\.action\.createAccount)/.test(key));
    assert.ok(scoped('en').length > 50);
    for (const lang of ['fr', 'ar']) assert.deepEqual(scoped(lang), scoped('en'), `${lang} differs from English in its trial or sign-up keys`);
  });
});
describe('the checks above, held to every way out that was ever found', () => {
  // Screens written for the purpose and never saved: each is parsed as a screen of the app would be (under `app/`, so
  // its imports reach the app's own registries) and handed to the checks as it is.
  const HEAD = [
    "import React from 'react';",
    "import { Text } from 'react-native';",
    "import { Link, Redirect, useRouter } from 'expo-router';",
    "import { TABS } from '../lib/navigation/back';",
    "import { internalRoute } from '../lib/navigation/internal-route';",
    "import { hubById, moneyRows, visibleChildren, visibleGroups } from '../lib/navigation/registry';",
    '',
  ].join('\n');
  let probes = 0;
  const probe = (code: string, head = HEAD): string => {
    const file = join(new URL('app', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), `zz-probe-${probes++}.tsx`);
    trees.set(file, ts.createSourceFile(file, `${head}${code}\n`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
    return file;
  };
  const screen = (body: string) => `export function Probe({ url, host, e }: { url: string; host: string; e: unknown }) { const router = useRouter(); ${body} }`;
  const found = (check: (file: string) => string[], file: string, what: string) => assert.notDeepEqual(check(file), [], `not found: ${what}`);

  it('a navigation is found when it can lead anywhere — a value, a host, a scheme, however the router or the link is reached', () => {
    for (const body of [
      // The verification's: expo-router hands any external href to the browser.
      'return <Link href={(e as { next?: string }).next as never}><Text>x</Text></Link>;',
      'return <Text onPress={() => router.push(url as never)}>x</Text>;',
      'return <Text onPress={() => router.replace(`${host}/start` as never)}>x</Text>;',
      'return <Text onPress={() => router.push(`/${host}` as never)}>x</Text>;',
      'return <Text onPress={() => router.push({ pathname: url } as never)}>x</Text>;',
      "return <Text onPress={() => router.push({ pathname: '/sales', ...(e as object) } as never)}>x</Text>;",
      "return <Text onPress={() => router.push('https://example.invalid' as never)}>x</Text>;",
      "return <Text onPress={() => router.navigate('//example.invalid' as never)}>x</Text>;",
      'return <Redirect href={url as never} />;',
      // A router reached another way than calling one of its methods on the spot.
      'const { push } = router; return <Text onPress={() => push(url as never)}>x</Text>;',
      'const go = router.push; return <Text onPress={() => go(url as never)}>x</Text>;',
      "return <Text onPress={() => router['push'](url as never)}>x</Text>;",
      'return <Text onPress={() => router.push.call(router, url as never)}>x</Text>;',
      'return <Text onPress={() => [url].forEach(router.push as never)}>x</Text>;',
      'return <Text onPress={() => router.push(...([url] as [never]))}>x</Text>;',
      'const again = router; return <Text onPress={() => again.push(url as never)}>x</Text>;',
      'const leave = (r: typeof router) => r.push(url as never); return <Text onPress={() => leave(router)}>x</Text>;',
      'return <Text onPress={() => useRouter().push(url as never)}>x</Text>;',
      // A registry's name taken by a local, a registry written to, a list that is not the registry's.
      "const LOGIN = 'https://example.invalid'; return <Text onPress={() => router.replace(LOGIN as never)}>x</Text>;",
      'const TABS = { agent: url }; return <Text onPress={() => router.replace(TABS.agent as never)}>x</Text>;',
      'const internalRoute = (link: string) => link; return <Text onPress={() => router.push(internalRoute(url) as never)}>x</Text>;',
      '(TABS as unknown as Record<string, string>).agent = url; return <Text onPress={() => router.replace(TABS.agent)}>x</Text>;',
      'Object.assign(TABS, { agent: url }); return null;',
      'return <>{[{ route: url }].map((d) => <Text key={d.route} onPress={() => router.push(d.route as never)}>x</Text>)}</>;',
      "return <>{visibleChildren({ children: [{ route: url }] } as never, new Set(), 'electronics').map((child) => <Text key={child.route} onPress={() => router.push(child.route as never)}>x</Text>)}</>;",
      "return <>{moneyRows(new Set(), 'electronics').map((child) => { child.route = url; return <Text key={child.id} onPress={() => router.push(child.route as never)}>x</Text>; })}</>;",
      // A link reached another way than as an element, or given what it was not written with.
      'return React.createElement(Link, { href: url as never }, null);',
      'return <Link {...({ href: url } as never)}><Text>x</Text></Link>;',
      "return <Text {...({ href: 'https://example.invalid' } as object)}>x</Text>;",
      "const href = url; return <Text {...({ href } as object)}>x</Text>;",
      "const P = Text as never as React.ComponentType<{ href: string }>; return <P href=\"https://example.invalid\" />;",
      "const P = Text as never as React.ComponentType<{ hrefAttrs: object }>; return <P hrefAttrs={{ target: '_blank' }} />;",
      // Text whose links the phone opens by itself, past the browser guard.
      'return <Text dataDetectorType="link">{url}</Text>;',
      // A path a router's resolution could turn into a host.
      "return <Text onPress={() => router.push('/..//example.invalid' as never)}>x</Text>;",
      "return <Text onPress={() => router.push(`/${host ? '..' : 'sales'}/${url}` as never)}>x</Text>;",
      // A page's own element, which on the web refreshes the page, sends it away or shows another page inside it
      // (the verification's, given a server's value) — and the props that do it, on any element.
      'return <meta httpEquiv="refresh" content={url} />;',
      'return <form action={url} method="get"><button type="submit">x</button></form>;',
      'return <object data={url} />;',
      'return <embed src={url} />;',
      'return <iframe src={url} />;',
      'return <base href={url} />;',
      'return <a href={url}>x</a>;',
      'return <svg:a href={url}>x</svg:a>;',
      "const P = Text as never as React.ComponentType<{ httpEquiv: string }>; return <P httpEquiv=\"refresh\" />;",
      'const P = Text as never as React.ComponentType<{ formAction: string }>; return <P formAction={url} />;',
      // An element made by hand, or given props whose names cannot be read.
      "return React.createElement('meta', { httpEquiv: 'refresh', content: url });",
      "return React.createElement('form', { action: url });",
      "const KEY = 'href'; return <Text {...{ [KEY]: url }}>x</Text>;",
      'return <Text {...{ [host]: url }}>x</Text>;',
      "return <Text {...Object.fromEntries([['href', url]])}>x</Text>;",
      // The registry changed in place, then followed: a hub's children pushed, spliced or unshifted by a borrowed method.
      "const hub = hubById('money'); if (!hub) return null; (hub.children as unknown as { id: string; route: string }[]).push({ id: 'zz', route: url }); const children = visibleChildren(hub, new Set(), 'electronics'); return <>{children.map((child) => <Text key={child.id} onPress={() => router.push(child.route as never)}>x</Text>)}</>;",
      "(hubById('money')!.children as unknown as { route: string }[]).splice(0, 1, { route: url }); return null;",
      "Array.prototype.unshift.call(hubById('money')!.children, { route: url }); return null;",
      "const children = visibleChildren(hubById('money')!, new Set(), 'electronics'); children.push({ ...children[0], route: url }); return <>{children.map((child) => <Text key={child.id} onPress={() => router.push(child.route as never)}>x</Text>)}</>;",
    ]) {
      found(leadsOutside, probe(screen(body)), body);
    }
    // The verification's spread of a key named at the module's top.
    found(leadsOutside, probe(screen('return <Text {...{ [KEY]: url }}>x</Text>;'), `${HEAD}const KEY = 'href';\n`), 'a computed key named at the top');
    // expo-router reached other than by name.
    for (const head of [
      "import { router as nav } from 'expo-router';\n",
      "import { useRouter as useLeave } from 'expo-router';\n",
      "import { Link as Away } from 'expo-router';\n",
      "import * as Router from 'expo-router';\n",
      "import Router from 'expo-router';\n",
      "export { router } from 'expo-router';\n",
      "const { router } = require('expo-router');\n",
      "import { linkTo } from 'expo-router/build/global-state/routing';\n",
      "export { linkTo } from 'expo-router/build/global-state/routing';\n",
    ]) {
      found(leadsOutside, probe('export const go = 1;', head), head);
    }
  });

  it('a navigation to a path written out, a registry’s route or a destination the registry lists is not', () => {
    for (const body of [
      "return <Text onPress={() => router.push('/sales')}>x</Text>;",
      'return <Text onPress={() => router.push(`/sales/${host}`)}>x</Text>;',
      "return <Text onPress={() => router.push(host ? '/sales/period' : '/sales')}>x</Text>;",
      "return <Text onPress={() => router.push({ pathname: '/unit/[identifier]', params: { identifier: host } })}>x</Text>;",
      "return <Text onPress={() => router.push(`/${host ? 'loans' : 'consignments'}/${url}`)}>x</Text>;",
      'return <Text onPress={() => router.replace(TABS.agent)}>x</Text>;',
      'const target = internalRoute(url); return <Text onPress={() => (target ? router.push(target) : undefined)}>x</Text>;',
      'return <Text onPress={() => (router.canGoBack() ? router.back() : router.replace(TABS.home))}>x</Text>;',
      'React.useEffect(() => undefined, [router]); return null;',
      'return <Redirect href="/" />;',
      "return <Link href=\"/sales\"><Text>x</Text></Link>;",
      "const actions = moneyRows(new Set(), 'electronics'); const expenses = actions.find((c) => c.id === 'expenses'); return <>{actions.map((child) => <Text key={child.id} onPress={() => router.push(child.route as never)}>x</Text>)}{expenses ? <Text onPress={() => router.push(`${expenses.route}/new` as never)}>x</Text> : null}</>;",
      "const groups = visibleGroups(new Set(), 'electronics'); return <>{groups.map(({ group, destinations }) => destinations.map((d) => <Text key={group.id + d.id} onPress={() => router.push(d.route as never)}>x</Text>))}</>;",
      "const hub = host ? hubById(host) : undefined; if (!hub) return null; const children = visibleChildren(hub, new Set(), 'electronics'); return <>{children.map((child) => <Text key={child.id} onPress={() => router.push(child.route as never)}>x</Text>)}</>;",
      // The app's own components, whatever their names, and props whose names are read.
      'const Form = (p: { sale: string }) => <Text>{p.sale}</Text>; return <Form sale={url} />;',
      "return <Text {...(host ? { numberOfLines: 1, ellipsizeMode: 'tail' as const } : null)}>x</Text>;",
      "const KEY = 'numberOfLines'; return <Text {...{ [KEY]: 1 }}>x</Text>;",
      'const row = <Text>x</Text>; return React.cloneElement(row, { accessibilityLabel: host });',
      // A copy of what the registry lists, changed, is not the registry.
      "const hub = host ? hubById(host) : undefined; if (!hub) return null; const ids = visibleChildren(hub, new Set(), 'electronics').map((child) => child.id); ids.push('more'); return <Text>{ids.join(',')}</Text>;",
    ]) {
      assert.deepEqual(leadsOutside(probe(screen(body))), [], body);
    }
  });

  it('a page that navigates itself, opens a window or writes its own markup is found, however the window, its document or its location is named', () => {
    for (const code of [
      // The verification's.
      'export const go = (e: string) => window.location.assign(e);',
      "export const go = (e: string) => document.defaultView?.open(e, '_blank');",
      'export const go = (e: string) => { const w = window; w.open(e); };',
      // And every other way found since.
      'export const go = (e: string) => { location.href = e; };',
      'export const go = (e: string) => { (window as unknown as { location: string }).location = e; };',
      'export const go = (e: string) => { const { open } = window; open(e); };',
      "export const go = (e: string) => (globalThis as unknown as Window)['location'].replace(e);",
      'export const go = (e: string) => { const page = { location }; page.location.assign(e); };',
      'export const go = (e: string) => open(e);',
      'export const go = (e: string, name: string) => (window as unknown as Record<string, (link: string) => void>)[name](e);',
      "export const go = (e: string) => { const a = document.createElement('a'); a.href = e; a.click(); };",
      "export const go = (e: string) => { const a = document.createElement('a'); a.setAttribute('href', e); a.click(); };",
      "export const go = (e: string) => { const f = document.createElement('form'); f.action = e; f.submit(); };",
      "export const go = () => document.createElement('iframe');",
      "export const go = () => document.createElementNS('http://www.w3.org/1999/xhtml', 'object');",
      'export const go = (e: string) => (window as unknown as { navigation: { navigate(link: string): void } }).navigation.navigate(e);',
      'declare const navigation: { navigate(link: string): void };\nexport const go = (e: string) => navigation.navigate(e);',
      "export const go = (e: string) => document.write('<meta http-equiv=\"refresh\" content=\"0;url=' + e + '\">');",
      "export const go = (e: string) => { document.body.innerHTML = '<a href=\"' + e + '\">x</a>'; };",
    ]) {
      found(browserUses, probe(code, ''), code);
    }
  });

  it('a browser, a web view or a way past the guard is found by its name, wherever it is written', () => {
    for (const code of [
      "import { Linking } from 'react-native';\nexport const go = (e: string) => Linking.openURL(e);",
      "import { Linking } from 'react-native';\nconst { openURL } = Linking;\nexport const go = (e: string) => openURL(e);",
      "import * as ExpoLinking from 'expo-linking';\nexport const go = (e: string) => ExpoLinking.openURL(e);",
      "import { NativeModules } from 'react-native';\nexport const go = (e: string) => NativeModules.IntentAndroid.openURL(e);",
      "import { NativeModules } from 'react-native';\nexport const go = (e: string, name: string) => NativeModules[name][e];",
      "import { Text } from 'react-native';\nexport const P = ({ e }: { e: string }) => <Text dataDetectorType=\"link\">{e}</Text>;",
      'export const P = ({ e }: { e: string }) => <iframe src={e} />;',
      `export const page = (e: string) => '<meta http-equiv="refresh" content="0;url=' + e + '">';`,
      'export const page = (e: string) => `<p><a class="x" href="${e}">open</a></p>`;',
      // A page written to leave or to show another inside it — the verification's markup, in any letter case.
      'export const page = (e: string) => `<html><body><iframe src="${e}"></iframe></body></html>`;',
      'export const page = (e: string) => `<html><body><object data="${e}"></object></body></html>`;',
      'export const page = (e: string) => `<html><body><embed src="${e}"></body></html>`;',
      'export const page = (e: string) => `<html><body onload="document.forms[0].submit()"><form action="${e}"></form></body></html>`;',
      'export const page = (e: string) => `<FORM ACTION="${e}"></FORM>`;',
      "export const page = (e: string) => '<base href=\"' + e + '\">';",
      'export const page = () => `<img src="logo.png" onerror="document.forms[0].submit()">`;',
      "export const page = () => '<p>' + '<script>document.title = 1</script>' + '</p>';",
      'export const page = () => `<area shape="rect" coords="0,0,9,9" href="https://example.invalid">`;',
    ]) {
      found(browserNames, probe(code, ''), code);
    }
    // The pages the app does write — the receipt's and the report's — and a component of its own called Form are not.
    for (const code of [
      'export const page = (logo: string) => `<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><img class="logo" src="${logo}" alt="" /><table><tr><td>1</td></tr></table></body></html>`;',
      "import { Text } from 'react-native';\nconst Form = ({ sale }: { sale: string }) => <Text>{sale}</Text>;\nexport const P = () => <Form sale=\"x\" />;",
    ]) {
      assert.deepEqual(browserNames(probe(code, '')), [], code);
    }
  });

  it('the trial named or acted on in a source’s own text is found, however it is worded; its names are not', () => {
    for (const code of [
      "export const label = 'access.trial.Start my free trial';",
      "export const label = 'Start now — 7 days free';",
      "import { Text } from 'react-native';\nexport const P = () => <Text>Sign up for a free trial</Text>;",
      "export const label = 'Votre essai ' + 'commence ici';",
    ]) {
      found(trialWording, probe(code, ''), code);
    }
    for (const code of ["export const key = 'access.trial.ends';", "export const route = '/account/trial-setup';", "export const id = 'trial-setup-card';"]) {
      assert.deepEqual(trialWording(probe(code, '')), [], code);
    }
  });

  it('a query that carries the setup link’s token is found, and so is a string that starts with it', () => {
    for (const code of [
      'export const link = (t: string) => new URLSearchParams({ t });',
      "export const link = (e: string) => new URLSearchParams([['t', e]]);",
      'export const link = (e: string) => { const query = { t: e }; return new URLSearchParams(query); };',
      "export const link = (u: URL, e: string) => u.searchParams.set('t', e);",
      "export const link = (u: URL, e: string) => u.searchParams['append']('t', e);",
    ]) {
      found(tokenQueries, probe(code, ''), code);
    }
    for (const code of ["export const link = (u: URL, e: string) => { u.hash = 't=' + e; };", 'export const link = (o: string, e: string) => `${o}#t=${e}`;', "export const link = (o: string, e: string) => o + '?t=' + e;"]) {
      const marked = textsOf(probe(code, '')).filter(({ text }) => rules.TOKEN_MARKER.test(rules.normalizePath(text)));
      assert.notDeepEqual(marked, [], code);
    }
  });
});
