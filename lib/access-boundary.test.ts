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
import { join } from 'node:path';
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
/** Every node of a tree, depth first. */
function nodesOf(tree: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return out;
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
  let other = false;
  for (const node of nodesOf(tree)) {
    if (!(ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) || !ts.isIdentifier(node.name) || node.name.text !== name) continue;
    if (ts.isVariableDeclaration(node) && node.initializer && (node.parent.flags & ts.NodeFlags.Const) !== 0) values.push(node.initializer);
    else other = true;
  }
  return other ? [] : values;
}

/**
 * The browser guard (`lib/navigation/no-browser.ts`): the one module that names `Linking` or `openURL`, to make every
 * `openURL` refuse, and that reaches `window.open`, to let a new tab open only for a `blob:` page.
 */
const GUARD = 'lib/navigation/no-browser.ts';

/** A path of the app's own: `/`, and no host after it (`//host`, `/\host`). */
const PATH = /^\/(?![/\\])/;
/** A path whose first segment is written out, so a template may go on after it. */
const SEGMENT = /^\/[^/\\]/;
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
/** A screen that lists a registry's destinations (`lib/navigation/registry.ts`) and opens the one pressed: what it reads each from. */
const REGISTRY_READS: Record<string, string[]> = {
  'app/(tabs)/money-hub.tsx': ['child.route', 'expenses.route'],
  'app/(tabs)/more.tsx': ['d.route'],
  'app/hub/[id].tsx': ['child.route'],
};
/** Whether a name is imported, as itself, from the registry it belongs to. */
function fromRegistry(name: string, tree: ts.SourceFile): boolean {
  return tree.statements.some((statement) => {
    if (!REGISTRIES[name] || !ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (!statement.moduleSpecifier.text.replace(/\.ts$/, '').endsWith(REGISTRIES[name])) return false;
    const bindings = statement.importClause?.namedBindings;
    return !!bindings && ts.isNamedImports(bindings) && bindings.elements.some((e) => e.name.text === name && (e.propertyName?.text ?? name) === name);
  });
}
/** The first segments a value can be, when each is written out: `type === 'consignment' ? 'consignments' : 'loans'`. */
function segmentsOf(node: ts.Expression): string[] | null {
  const n = bare(node);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
  if (!ts.isConditionalExpression(n)) return null;
  const [yes, no] = [segmentsOf(n.whenTrue), segmentsOf(n.whenFalse)];
  return yes && no ? [...yes, ...no] : null;
}
/**
 * Whether a navigation target can only be a screen of the app's own: a path written out (a literal or a template that
 * starts with `/` and its first segment), an object whose `pathname` is one, a `const` or a choice between such, or a
 * route a registry holds — read from its registry, never from a value the app was given.
 */
function leadsInside(node: ts.Expression, file: string, tree: ts.SourceFile): boolean {
  const n = bare(node);
  const reads = REGISTRY_READS[file] ?? [];
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return PATH.test(n.text);
  if (ts.isTemplateExpression(n)) {
    const [first] = n.templateSpans;
    if (n.head.text === '/') return segmentsOf(first.expression)?.every((segment) => /^[^/\\]/.test(segment)) ?? false;
    if (n.head.text === '') return first.literal.text.startsWith('/') && reads.includes(bare(first.expression).getText(tree));
    return SEGMENT.test(n.head.text);
  }
  if (ts.isConditionalExpression(n)) return leadsInside(n.whenTrue, file, tree) && leadsInside(n.whenFalse, file, tree);
  if (ts.isObjectLiteralExpression(n)) {
    const pathname = n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(tree) === 'pathname');
    return pathname !== undefined && leadsInside(pathname.initializer, file, tree);
  }
  if (ts.isIdentifier(n)) {
    const values = constantsNamed(n.text, tree);
    return values.length > 0 ? values.every((value) => leadsInside(value, file, tree)) : fromRegistry(n.text, tree);
  }
  if (ts.isPropertyAccessExpression(n)) return reads.includes(n.getText(tree)) || (ts.isIdentifier(n.expression) && n.expression.text === 'TABS' && fromRegistry('TABS', tree));
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && fromRegistry(n.expression.text, tree);
}
/**
 * Every place a source leads somewhere that could be outside the app: a router's `push`, `replace`, `navigate`,
 * `dismissTo` or `prefetch`, a `<Link>` or `<Redirect>`, a tab's `href` option — each whose target is not provably
 * the app's own — and any other element given an `href` or `hrefAttrs`.
 */
function leadsOutside(file: string): string[] {
  const tree = treeOf(file);
  const rel = relative(file);
  const nodes = nodesOf(tree);
  const routers = new Set(
    nodes
      .filter((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && !!n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(tree) === 'useRouter')
      .map((n) => (n.name as ts.Identifier).text),
  );
  if (tree.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === 'expo-router' && /\brouter\b/.test(s.importClause?.getText(tree) ?? ''))) routers.add('router');
  const out: string[] = [];
  for (const node of nodes) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && routers.has(node.expression.expression.text)) {
      const method = node.expression.name.text;
      const [target] = node.arguments;
      if (['push', 'replace', 'navigate', 'dismissTo', 'prefetch'].includes(method) && !(target && leadsInside(target, rel, tree))) out.push(`${rel}: ${node.getText(tree)}`);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(tree);
      const element = node.parent.parent as ts.JsxOpeningLikeElement;
      const tag = element.tagName.getText(tree);
      const value = node.initializer && (ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer);
      if (name === 'hrefAttrs' || (name === 'href' && !(['Link', 'Redirect'].includes(tag) && value && leadsInside(value, rel, tree)))) out.push(`${rel}: <${tag} ${node.getText(tree)}>`);
    } else if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'href') {
      const none = (v: ts.Expression): boolean => {
        const b = bare(v);
        return b.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(b) && b.text === 'undefined') || (ts.isConditionalExpression(b) && none(b.whenTrue) && none(b.whenFalse));
      };
      if (!none(node.initializer) && !leadsInside(node.initializer, rel, tree)) out.push(`${rel}: ${node.getText(tree)}`);
    }
  }
  return out;
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
/**
 * Every way a source reaches for a page's own browser: opening a window, reading or writing its location (by name,
 * through a window or a document, destructured), `defaultView`, and an assignment to an `href`.
 */
function browserUses(file: string): string[] {
  const tree = treeOf(file);
  const out: string[] = [];
  const member = (node: ts.Node): { object: ts.Expression; name: string } | null =>
    ts.isPropertyAccessExpression(node) ? { object: node.expression, name: node.name.text } : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? { object: node.expression, name: node.argumentExpression.text } : null;
  for (const node of nodesOf(tree)) {
    const m = member(node);
    if (m && (m.name === 'open' || m.name === 'location') && windowish(m.object, tree)) {
      const read = m.name === 'location' && member(node.parent)?.name === 'hostname' && !(ts.isBinaryExpression(node.parent.parent) && node.parent.parent.left === node.parent);
      out.push(read ? `reads ${node.parent.getText(tree)}` : node.getText(tree));
    } else if (m && m.name === 'defaultView') out.push(node.getText(tree));
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && member(node.left)?.name === 'href') out.push(`assigns ${node.left.getText(tree)}`);
    else if (ts.isObjectBindingPattern(node) && ts.isVariableDeclaration(node.parent) && node.parent.initializer && windowish(node.parent.initializer, tree)) {
      for (const e of node.elements) if (['open', 'location'].includes((e.propertyName ?? e.name).getText(tree))) out.push(`destructures ${e.getText(tree)}`);
    } else if (ts.isIdentifier(node) && node.text === 'location' && !constantsNamed('location', tree).length && isValueUse(node)) out.push('location');
  }
  return out.map((use) => `${relative(file)}: ${use}`);
}
/** An identifier used as a value — not a property's name, a key, a declaration or an import. */
function isValueUse(node: ts.Identifier): boolean {
  const p = node.parent;
  return !(
    (ts.isPropertyAccessExpression(p) && p.name === node) ||
    (ts.isPropertyAssignment(p) && p.name === node) ||
    (ts.isPropertySignature(p) && p.name === node) ||
    (ts.isBindingElement(p) && p.propertyName === node) ||
    ts.isShorthandPropertyAssignment(p) ||
    ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isBindingElement(p)) && p.name === node) ||
    ts.isImportSpecifier(p) ||
    ts.isJsxAttribute(p)
  );
}
/** A query that carries the setup link's `t`: `new URLSearchParams({ t })`, `[['t', …]]`, `.set('t', …)`, `.append('t', …)`. */
function tokenQueries(file: string): string[] {
  const tree = treeOf(file);
  const out: string[] = [];
  for (const node of nodesOf(tree)) {
    if (!(ts.isCallExpression(node) || ts.isNewExpression(node)) || !node.arguments?.length) continue;
    const callee = node.expression.getText(tree);
    const [first] = node.arguments;
    const named = (p: ts.ObjectLiteralElementLike) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 't';
    const pair = (e: ts.Expression) => ts.isArrayLiteralExpression(e) && e.elements[0] !== undefined && ts.isStringLiteral(e.elements[0]) && e.elements[0].text === 't';
    const carries =
      (/\bURLSearchParams$/.test(callee) && ((ts.isObjectLiteralExpression(first) && first.properties.some(named)) || (ts.isArrayLiteralExpression(first) && first.elements.some(pair)))) ||
      (/\.(set|append)$/.test(callee) && ts.isStringLiteral(first) && first.text === 't');
    if (carries) out.push(`${relative(file)}: ${node.getText(tree)}`);
  }
  return out;
}

/** The only keys that may name the free trial (2026-10-13): the Owner's card, the trial's three state words, its dates. */
const TRIAL_KEY = /^(trialSetup\.|access\.state\.trial_|access\.trial\.)/;
/** The trial named: "essai" alone, never inside "nécessaire" or "essais" (attempts); Arabic without its diacritics. */
const TRIAL_WORDS = rules.words(/\btrial\b|\bessai\b|تجريب|تجرب/i);

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
 * The trial's words, exactly as the owner approved them (SPEC §10; "being sent", shared contract C1), in all three
 * languages. A new key in these families, a changed sentence or a missing one fails here first.
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
    'trialSetup.delivery.sending': 'We are sending the instructions for completing your business setup to your verified contact.',
    'trialSetup.delivery.waiting.phone': 'The instructions will be sent automatically once your WhatsApp number is verified.',
    'trialSetup.delivery.waiting.email': 'The instructions will be sent automatically once your email address is verified.',
    'trialSetup.delivery.unavailable': 'Your business is eligible for a 7-day free trial, but setup instructions cannot be sent right now. Your trial has not started. Please contact Dukan ERP support.',
    'trialSetup.delivery.failed': 'The setup instructions could not be sent. Your trial has not started. Please contact Dukan ERP support.',
    'trialSetup.delivery.not_sent': 'The setup instructions have not been sent. Your trial has not started. Please contact Dukan ERP support.',
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
    'trialSetup.delivery.sending': 'Nous envoyons les instructions pour finaliser la configuration de votre commerce à votre contact vérifié.',
    'trialSetup.delivery.waiting.phone': 'Les instructions seront envoyées automatiquement dès que votre numéro WhatsApp sera vérifié.',
    'trialSetup.delivery.waiting.email': 'Les instructions seront envoyées automatiquement dès que votre adresse e-mail sera vérifiée.',
    'trialSetup.delivery.unavailable': 'Votre commerce peut bénéficier d’un essai gratuit de 7 jours, mais les instructions de configuration ne peuvent pas être envoyées pour le moment. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
    'trialSetup.delivery.failed': 'Les instructions de configuration n’ont pas pu être envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
    'trialSetup.delivery.not_sent': 'Les instructions de configuration n’ont pas été envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
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
    'trialSetup.delivery.sending': 'نرسل الآن تعليمات إكمال إعداد نشاطك التجاري إلى وسيلة الاتصال التي تم التحقق منها.',
    'trialSetup.delivery.waiting.phone': 'سيتم إرسال التعليمات تلقائيًا بمجرد التحقق من رقم واتساب الخاص بك.',
    'trialSetup.delivery.waiting.email': 'سيتم إرسال التعليمات تلقائيًا بمجرد التحقق من بريدك الإلكتروني.',
    'trialSetup.delivery.unavailable': 'نشاطك التجاري مؤهل لفترة تجريبية مجانية مدتها 7 أيام، لكن لا يمكن إرسال تعليمات الإعداد الآن. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
    'trialSetup.delivery.failed': 'تعذّر إرسال تعليمات الإعداد. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
    'trialSetup.delivery.not_sent': 'لم تُرسل تعليمات الإعداد. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.',
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
    for (const f of SOURCES) {
      const text = code(f);
      assert.doesNotMatch(text, /WebView|WebBrowser\.|openBrowserAsync|openAuthSessionAsync|<QRCode\b|<iframe\b/, `${f} draws a QR code or opens a web view or browser`);
      if (relative(f) === GUARD) continue;
      // Called, destructured (`const { openURL } = Linking`), on a namespace or a member: every form names it.
      assert.doesNotMatch(text, /openURL/, `${f} opens a link`);
      // The app's deep links are expo-router's; nothing of the app's own needs Linking from React Native or expo-linking.
      assert.doesNotMatch(text, /\bLinking\b|expo-linking/, `${f} reaches for Linking`);
    }
    // The guard only refuses: React Native's openURL — which expo-linking and expo-router call — and, on the web, any
    // new tab but a blob page. The root layout installs it once, at module scope, before any screen exists.
    const guard = code(new URL(GUARD, ROOT).pathname);
    assert.equal((guard.match(/openURL/g) ?? []).length, 1);
    assert.match(guard, /^\s*Linking\.openURL = \(\) => Promise\.reject\(new Error\('Dukan ERP opens no address outside the app\.'\)\);$/m);
    assert.match(guard, /^\s*window\.open = \(url, \.\.\.rest\) => \(String\(url \?\? ''\)\.startsWith\('blob:'\) \? open\(url, \.\.\.rest\) : null\);$/m);
    assert.doesNotMatch(guard, /expo-linking|location|href|require\(/);
    assert.match(strip(read('app/_layout.tsx')), /^import \{ refuseBrowser \} from '\.\.\/lib\/navigation\/no-browser';$[\s\S]*^refuseBrowser\(\);$/m);
  });

  it('every navigation leads to a screen of the app’s own: a path written out, or a route its registries hold', () => {
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

  it('no page navigates itself or opens a window but the report’s preview, the CSV download and the guard', () => {
    assert.deepEqual(SOURCES.flatMap(browserUses).sort(), [
      // The web build's API host is the page's own: read, never written.
      'constants/config.ts: reads (globalThis as { location?: { hostname?: string } }).location?.hostname',
      // The guard: a new tab only for a blob page.
      'lib/navigation/no-browser.ts: window.open',
      'lib/navigation/no-browser.ts: window.open',
      // The CSV the browser saves: a link to a blob made from the report already in memory.
      'lib/report-export.ts: assigns link.href',
      // The report's preview: a new tab on a blob made from the page already in memory.
      'lib/report-pdf.ts: window.open',
    ]);
    assert.match(code(new URL('lib/report-pdf.ts', ROOT).pathname), /const url = URL\.createObjectURL\(new Blob\(\[report\.html\][^)]*\)\);\s*const tab = window\.open\(url, '_blank'\);/);
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
    // The team's own writes: a member created pending, a code sent again, an invitation withdrawn, a member edited, a delegation.
    const team = ['app/team.tsx', 'components/team/CreateMemberSheet.tsx', 'components/team/PendingPanel.tsx'].map((f) => strip(read(f))).join('\n');
    const writes = [...team.matchAll(/api\.(post|put|patch|delete)(?:<[^>]*>)?\(\s*([`'][^`']*[`']|\w+)/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual([...new Set(writes)].sort(), [
      'delete path', "post '/users'", 'post `/users/${user.id}/cancel-invitation`', 'post `/users/${user.id}/resend-verification`', 'put path', 'patch `/users/${user!.id}`',
    ].sort());
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(team\.create\.|team\.pending\.|access\.staff\.)/.test(key)) continue;
        assert.doesNotMatch(rules.normalizeWords(value), rules.ACCESS_PRICE, `${lang} ${key} prices a seat: ${value}`);
        assert.doesNotMatch(value, /\bMRU\b|أوقية|\bpay\b|\bpaid\b|\bpayer\b|\bpaiement\b|ادفع|الدفع|\bbuy\b|\bpurchase\b|\bachet|اشترِ|\bwebsite\b|\bsite\b|موقع|https?:|www\./i, `${lang} ${key}: ${value}`);
      }
    }
  });
});

describe('the words', () => {
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

  it('the access, sign-in, sign-up and trial copy never names a price, a payment, a way to buy or renew, or a website — in any language', () => {
    const forbidden = /\bMRU\b|أوقية|https?:|www\.|\bwebsite\b|\bsite\b|موقع|\brenew|renouvel|تجديد|\bsubscri|\babonne|اشتراك|اشترك|\bbuy\b|\bpurchase\b|\bachet|اشترِ|\bpay\b|\bpaid\b|\bpayer\b|\bpaiement\b|ادفع|الدفع|Bankily|بنكيلي|\bcheckout\b|in-app|App Store|Apple|\bQR\b|\bclick\b|\bcliquez\b/i;
    for (const lang of LANGS) {
      for (const [key, value] of entries(lang)) {
        if (!/^(access\.|nav\.access|auth\.|register\.|trialSetup\.|sync\.reason\.entitlement_blocked|hub\.business\.desc|more\.group\.account)/.test(key)) continue;
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
    // Outside the catalogues the trial is named only by identifiers: its keys, its read-only route, its query key and
    // its card's test id — never by words a screen could show.
    const TRIAL_IDENTIFIERS = ['/account/trial-setup', 'trial-setup', 'trial-setup-card'];
    const offending: string[] = [];
    for (const f of CODE_SOURCES) {
      for (const { text, module } of textsOf(f)) {
        const words = rules.normalizeWords(text);
        for (const [name, pattern] of rules.TRIAL_ACTIONS as [string, RegExp][]) if (pattern.test(words)) offending.push(`${relative(f)} (${name}): ${text}`);
        if (!module && TRIAL_WORDS.test(words) && !TRIAL_KEY.test(text) && !TRIAL_IDENTIFIERS.includes(text)) offending.push(`${relative(f)} names the trial: ${text}`);
      }
    }
    assert.deepEqual(offending, []);
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
