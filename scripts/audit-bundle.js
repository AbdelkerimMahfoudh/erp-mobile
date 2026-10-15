#!/usr/bin/env node
/**
 * Exported-bundle audit: what the app actually ships, not what its source
 * promises (docs/21, the owner's correction of 2026-10-13 and decision of
 * 2026-10-15).
 *
 *   EXPO_PUBLIC_API_ORIGIN=https://example.invalid npx expo export --platform web --source-maps --output-dir <web>
 *   EXPO_PUBLIC_API_ORIGIN=https://example.invalid npx expo export --platform ios --no-bytecode --source-maps --output-dir <ios>
 *   EXPO_PUBLIC_API_ORIGIN=https://example.invalid node scripts/audit-bundle.js <web> <ios> [<android> …]
 *
 * The app may SAY what the server knows about the one 7-day free trial; it can
 * DO nothing about it — the trial is started on the Dukan ERP website alone,
 * and its setup instructions are sent again there, after sign-in, or through
 * support — and it prices, sells and activates nothing of its own access, an
 * additional store or a paid staff seat included. `lib/access-boundary.test.ts`
 * holds the source to that; this holds the exported bundles to it, after every
 * transform, minifier and dependency has had its say, and it checks what is
 * bundled rather than how it is spelled:
 *
 * - Modules. Every bundle comes with its source map, and every module the maps
 *   list is checked: no QR encoder (any package with "qr" in its name), no web
 *   view and no browser library (`DENIED_PACKAGES`), and no module of the app's
 *   own that names Linking or imports expo-linking beyond `LINKING_ALLOWED`. A
 *   web page inside a native export (`www.bundle/`, an Expo DOM component) is
 *   a web view, whatever it holds. And the browser guard
 *   (`lib/navigation/no-browser.ts`, which makes every `openURL` refuse) must be
 *   bundled on every platform, its refusal with it.
 * - Calls. Every `openURL` — called, destructured, passed around; every
 *   `window.open` — called or read, on the window by any of its names
 *   (`window`, `self`, `globalThis`, `top`, `parent`, `frames`,
 *   `document.defaultView`, or a local name given to one of them), destructured
 *   from it, or a bare global `open(…)`; and every page navigation —
 *   `location.assign` or `.replace`, an assignment to a location or to an
 *   `href` — is traced to its module through the source map and compared with
 *   `CALL_SITES`, the libraries' own, the guard's and the report's. One more
 *   anywhere, or one gone, fails; what was found is printed beside what is
 *   pinned, so the list is changed on purpose.
 * - Strings. Every string and template literal — a template's parts joined,
 *   concatenated literals folded — is read as a path (`normalizePath`, in any
 *   letter case): no claim, resend, store or seat request, price or platform
 *   route, no setup-link token marker (`#t=`, `?t=`, a string that starts with
 *   `t=`, `account/trial`) wherever it sits, nor a query that carries a `t`
 *   (`new URLSearchParams({ t })`, `.set('t', …)`), and no address — absolute,
 *   protocol-relative or `www.` — that is not the API's, a development host's
 *   or a library's own.
 * - Words. The decoded text is read as words (`normalizeWords`): no claim or
 *   resend wording in English, French or Arabic, no website address, no price
 *   of the app's own access, no payment instruction; and an amount written
 *   next to MRU or ouguiya must be one of the shop's own (`SHOP_AMOUNTS`).
 * - Code. A QR encoder's tables and messages, a web view's native component
 *   or iframe, a browser library's call.
 *
 * And PRESENT in every bundle: the read-only status route `account/trial-setup`,
 * the trial card's title in English, French and Arabic and the guard's
 * refusal, so the audit cannot pass by scanning nothing. Native bundles must be
 * exported with `--no-bytecode`: Hermes bytecode cannot be read and is refused,
 * not skipped.
 *
 * Exits 1 on any finding, 0 when every check holds on every platform.
 * `lib/audit-bundle.test.ts` runs it on bundles written for the purpose, with
 * every way past it that was ever found injected one at a time.
 */
const fs = require('node:fs');
const path = require('node:path');
const rules = require('./boundary-rules.cjs');

// Metro's own parser: wherever the app can be bundled, it is installed.
let parse = null;
try {
  ({ parse } = require('@babel/parser'));
} catch {
  // Said where it matters: by the command line below, or by `audit` when it is called.
}

const ROOT = path.join(__dirname, '..');

/** No QR encoder, no web view and no browser may be bundled, whoever depends on it. */
const DENIED_PACKAGES = ['react-native-webview', '@expo/dom-webview', 'expo-web-browser', 'expo-auth-session', 'react-native-inappbrowser-reborn'];
const deniedPackage = (name) => /qr/i.test(name) || DENIED_PACKAGES.includes(name);

/**
 * The app's own modules that may name Linking, with what each may use: the
 * browser guard, which replaces React Native's `openURL` with a refusal. The
 * app's deep links (the `dukanerp` scheme) are resolved by expo-router, which
 * imports expo-linking itself, and nothing else of the app's own creates,
 * reads or opens a link. A read-only use (`createURL`, `useURL`, `parse`)
 * would be added here, by module and by name, on purpose.
 */
const GUARD = '/lib/navigation/no-browser.ts';
const LINKING_ALLOWED = new Map([[GUARD, new Set(['Linking'])]]);

/**
 * Where the bundles reach for a browser today, by module and platform: the
 * libraries' own — expo-linking's export and its call into React Native,
 * expo-router's for an external redirect or link, React Native's and
 * react-native-web's Linking (whose web `openURL`s set `window.location`),
 * react-native-svg's `href` on an SVG element — the guard that makes `openURL`
 * refuse, and on the web build the report preview (`lib/report-pdf.ts` opens
 * the report's own page in a new tab) and the CSV download
 * (`lib/report-export.ts` hands the browser a `blob:` file through a link).
 * Nothing else of the app's own reaches any of them.
 */
const LINKING_LIBRARIES = {
  'node_modules/expo-linking/build/Linking.js': 2,
  'node_modules/expo-router/build/getRoutesRedirects.js': 2,
  'node_modules/expo-router/build/global-state/router.js': 1,
  [GUARD]: 1,
};
const CALL_SITES = {
  web: {
    openURL: { ...LINKING_LIBRARIES, 'node_modules/expo-linking/build/RNLinking.web.js': 1, 'node_modules/react-native-web/dist/exports/Linking/index.js': 1 },
    'window.open': { '/lib/report-pdf.ts': 1, [GUARD]: 2, 'node_modules/react-native-web/dist/exports/Linking/index.js': 1 },
    navigation: {
      '/lib/report-export.ts': 1,
      'node_modules/expo-linking/build/RNLinking.web.js': 1,
      'node_modules/react-native-svg/lib/module/web/utils/prepare.js': 1,
      'node_modules/react-native-web/dist/exports/Linking/index.js': 1,
    },
  },
  ios: { openURL: { ...LINKING_LIBRARIES, 'node_modules/react-native/Libraries/Linking/Linking.js': 2 }, 'window.open': {}, navigation: {} },
  android: { openURL: { ...LINKING_LIBRARIES, 'node_modules/react-native/Libraries/Linking/Linking.js': 2 }, 'window.open': {}, navigation: {} },
};
const CALLS = ['openURL', 'window.open', 'navigation'];

/** The names a page's own window goes by, and the property that leads from a document to it. */
const WINDOW = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames']);

/**
 * The amounts the bundles may write next to a currency: the shop's own
 * examples, never a price of the app's access — the design gallery's unit cost
 * and sale (`app/dev/gallery.tsx`), and the receipt stylesheet's note on
 * keeping an amount left to right inside Arabic (`lib/receipt-html.ts`).
 */
const SHOP_AMOUNTS = new Set(['30 000 MRU', '24 000 MRU', '45,000 MRU', '329 000 MRU', 'MRU 000 329']);
const AMOUNT = rules.words(/\d(?:[\d.,]|\s(?=\d))*\s?(?:MRU\b|أوقية|ouguiyas?\b)|\bMRU\s?\d(?:[\d.,]|\s(?=\d))*/gi);

/** Words: read after `normalizeWords`. */
const WORDS = [
  ...rules.TRIAL_ACTIONS,
  ['website address', rules.WEBSITE_ADDRESS],
  ['price of the app’s own access', rules.ACCESS_PRICE],
  ['payment-instruction string', rules.PAYMENT_INSTRUCTION],
];
/** Code: read as the decoded text writes it. */
const CODE = [
  [
    'QR code library',
    /bad rs block|code length overflow|too big to be stored in a QR Code|Bytes exceed max length|react-native-qrcode|qrcode\.react|react-qr-code|QRCodeSVG|QRCodeStyling|\b26\s*,\s*44\s*,\s*70\s*,\s*100\s*,\s*134\s*,\s*172\b|\[\s*1\s*,\s*26\s*,\s*19\s*\]\s*,\s*\[\s*1\s*,\s*26\s*,\s*16\s*\]|\[\s*6\s*,\s*18\s*\]\s*,\s*\[\s*6\s*,\s*22\s*\]\s*,\s*\[\s*6\s*,\s*26\s*\]/i,
  ],
  ['web view library', /RNCWebView|WebViewNativeComponent|requireNativeView(?:Manager)?\)?\s*\(\s*["'`](?:ExpoDomWebView|RNCWebView)|@expo\/dom-webview|react-native-webview\/lib|\(\s*["'`]iframe["'`]\s*[,)]|createElement\(\s*["'`]iframe["'`]/],
  ['browser-opening call', /openBrowserAsync|openAuthSessionAsync|ExpoWebBrowser|WebBrowser\.open|\bLinking\.openURL\(|(?:openURL|window\.open)\(\s*["'`]https?:/],
  ['setup-link token marker', /account\/trial(?!-setup)/i],
];

/**
 * Hosts a library names in its own messages and loaders — documentation
 * links in development warnings, the SVG namespace, the barcode reader's
 * code — and development addresses. Nothing here is a page the app opens.
 */
const LIBRARY_HOSTS = new Set([
  'www.w3.org', 'w3.org', 'reactnavigation.org', 'github.com', 'docs.swmansion.com', 'react.dev', 'reactjs.org', 'fb.me',
  'reactnative.dev', 'docs.expo.dev', 'expo.dev', 'dev.to', 'naver.github.io', 'fastly.jsdelivr.net', 'classic-assets.eascdn.net',
  'localhost', '127.0.0.1', '10.0.2.2',
]);
const HOST = '([a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}|localhost|\\d{1,3}(?:\\.\\d{1,3}){3})';
/** Absolute and `www.` addresses anywhere; protocol-relative ones (`//host`) inside strings. */
const ADDRESS = new RegExp(`https?://${HOST}|\\bwww\\.${HOST}`, 'gi');
const RELATIVE_ADDRESS = new RegExp(`(?:^|[^:\\w/])//${HOST}`, 'gi');

/** The card's title, as each catalogue spells it: it must be in every bundle. */
function catalogueValue(lang, key) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'i18n', `${lang}.ts`), 'utf8');
  const escaped = key.replace(/[.]/g, '\\.');
  const m = src.match(new RegExp(`^\\s*'${escaped}':\\s*'((?:[^'\\\\]|\\\\.)*)',\\s*$`, 'm'));
  if (!m) throw new Error(`lib/i18n/${lang}.ts has no ${key}`);
  return m[1].replace(/\\(.)/g, '$1');
}
/** The guard's refusal, as it writes it. */
function guardRefusal() {
  const m = fs.readFileSync(path.join(ROOT, GUARD), 'utf8').match(/new Error\('([^']+)'\)/);
  if (!m) throw new Error(`${GUARD} no longer refuses with an Error`);
  return m[1];
}
const PRESENT = [
  ['read-only status route', 'account/trial-setup'],
  ['card title (EN)', catalogueValue('en', 'trialSetup.title')],
  ['card title (FR)', catalogueValue('fr', 'trialSetup.title')],
  ['card title (AR)', catalogueValue('ar', 'trialSetup.title')],
  ['browser guard’s refusal', guardRefusal()],
];

const decode = (s) =>
  s
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const walk = (d) => fs.readdirSync(d).flatMap((n) => (fs.statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
const sample = (text, index, length = 0) => text.slice(Math.max(0, index - 60), index + length + 60).replace(/\s+/g, ' ');

/** A module by the name it keeps wherever node_modules is: from its package on, or the app's own path. */
const moduleName = (source) => (source.includes('node_modules/') ? source.slice(source.lastIndexOf('node_modules/')) : source);

/**
 * Which module of a bundle wrote the code at a character offset, read off its
 * source map: one `[generated column, source]` list per generated line.
 */
function moduleAt(code, map) {
  if (!map) return () => '<no source map>';
  const B64 = new Int8Array(128);
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].forEach((c, i) => (B64[c.charCodeAt(0)] = i));
  const lines = [];
  let source = 0;
  for (const line of map.mappings.split(';')) {
    const segments = [];
    let column = 0;
    for (const segment of line ? line.split(',') : []) {
      const values = [];
      for (let i = 0, value = 0, shift = 0; i < segment.length; i++) {
        const digit = B64[segment.charCodeAt(i)];
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      column += values[0];
      if (values.length >= 4) source += values[1];
      segments.push([column, values.length >= 4 ? source : -1]);
    }
    lines.push(segments);
  }
  const starts = [0];
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    let found = null;
    for (const segment of lines[lo] ?? []) {
      if (segment[0] > offset - starts[lo]) break;
      found = segment;
    }
    return found && found[1] >= 0 ? moduleName(map.sources[found[1]]) : '<unmapped>';
  };
}

const propertyName = (node) => (node.computed ? (node.property.type === 'StringLiteral' ? node.property.value : null) : node.property.name);
const keyName = (node) => (node.key.type === 'Identifier' ? node.key.name : node.key.type === 'StringLiteral' ? node.key.value : null);
const templateText = (node) => node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('\u0000');
const isMember = (node) => node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression';
const isCall = (node) => node.type === 'CallExpression' || node.type === 'OptionalCallExpression';

/** A `+` chain of literals read as the one string it makes; what is not a literal reads as \0. Null if nothing in it is text. */
function folded(node) {
  const parts = [];
  let left = node;
  while (left.type === 'BinaryExpression' && left.operator === '+') {
    parts.push(left.right);
    left = left.left;
  }
  parts.push(left);
  let any = false;
  const text = parts
    .reverse()
    .map((part) => {
      const piece =
        part.type === 'StringLiteral' ? part.value : part.type === 'TemplateLiteral' ? templateText(part) : part.type === 'BinaryExpression' && part.operator === '+' ? folded(part) : null;
      if (piece !== null) any = true;
      return piece ?? '\u0000';
    })
    .join('');
  return any ? text : null;
}

/**
 * Names, scope by scope: a name given to the page's window, its document or its
 * location (`var w = window`, `l = document.defaultView.location`) is that
 * thing wherever it reaches; a name bound to anything else — a parameter, a
 * local, a function — hides the page's own global of the same name.
 */
const GLOBALS = new Map([...[...WINDOW].map((name) => [name, 'window']), ['document', 'document'], ['location', 'location']]);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);
const scopeOf = (parent, hidden = []) => ({ parent, aliases: new Map(), hidden: new Set(hidden) });
function binding(scope, name) {
  for (let s = scope; s; s = s.parent) if (s.aliases.has(name) || s.hidden.has(name)) return s;
  return null;
}
function lookup(scope, name) {
  const s = binding(scope, name);
  return s ? (s.aliases.get(name) ?? null) : (GLOBALS.get(name) ?? null);
}
function bind(scope, name, kind) {
  if (kind) {
    scope.aliases.set(name, kind);
    scope.hidden.delete(name);
  } else {
    scope.aliases.delete(name);
    scope.hidden.add(name);
  }
}
/** The names a pattern binds: `a`, `{ a, b: c }`, `[d, ...e]`, `f = 1`. */
function boundNames(pattern, out = []) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) boundNames(p.type === 'RestElement' ? p.argument : p.value, out);
  else if (pattern.type === 'ArrayPattern') for (const e of pattern.elements) boundNames(e, out);
  else if (pattern.type === 'AssignmentPattern') boundNames(pattern.left, out);
  else if (pattern.type === 'RestElement') boundNames(pattern.argument, out);
  return out;
}
/** Whether an expression is the page's window, its document or its location — and which. */
function kindOf(node, scope) {
  if (!node) return null;
  switch (node.type) {
    case 'Identifier':
      return lookup(scope, node.name);
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const name = propertyName(node);
      if (WINDOW.has(name) || name === 'defaultView') return 'window';
      if (name === 'ownerDocument') return 'document';
      const of = kindOf(node.object, scope);
      if (name === 'document' && of === 'window') return 'document';
      if (name === 'location' && (of === 'window' || of === 'document')) return 'location';
      return null;
    }
    case 'ConditionalExpression':
      return kindOf(node.consequent, scope) ?? kindOf(node.alternate, scope);
    case 'LogicalExpression':
      return kindOf(node.left, scope) ?? kindOf(node.right, scope);
    case 'SequenceExpression':
      return kindOf(node.expressions[node.expressions.length - 1], scope);
    case 'AssignmentExpression':
      return kindOf(node.right, scope);
    default:
      return null;
  }
}
/** A query that carries the setup link's `t`: `new URLSearchParams({ t })`, `[['t', …]]`, `.set('t', …)`, `.append('t', …)`. */
function carriesToken(node) {
  const callee = node.callee;
  const [first] = node.arguments;
  if (!first) return false;
  const named = callee.type === 'Identifier' ? callee.name : isMember(callee) ? propertyName(callee) : null;
  if (named === 'URLSearchParams') {
    if (first.type === 'ObjectExpression') return first.properties.some((p) => p.type === 'ObjectProperty' && keyName(p) === 't');
    if (first.type === 'ArrayExpression') return first.elements.some((e) => e?.type === 'ArrayExpression' && e.elements[0]?.type === 'StringLiteral' && e.elements[0].value === 't');
  }
  return (named === 'set' || named === 'append') && first.type === 'StringLiteral' && first.value === 't';
}

/**
 * Every string of a parsed bundle (with where it starts), every `window.open`
 * it reaches for, every page navigation and every query carrying the token,
 * read in source order with the names in scope.
 */
function readTree(program, on) {
  const stack = [[program, scopeOf(null), false]];
  while (stack.length) {
    const [node, outer, inChain] = stack.pop();
    let scope = outer;
    if (FUNCTIONS.has(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) bind(outer, node.id.name, null);
      scope = scopeOf(outer, node.params.flatMap((p) => boundNames(p)));
    }
    if (node.type === 'StringLiteral') on.string(node.value, node.start);
    else if (node.type === 'TemplateLiteral') on.string(templateText(node), node.start);
    else if (node.type === 'BinaryExpression' && node.operator === '+' && !inChain) {
      const text = folded(node);
      if (text !== null) on.string(text, node.start);
    } else if (isMember(node)) {
      // Read, called or bound: `window.open`, `location.assign`, `location.replace.bind(location)`.
      const name = propertyName(node);
      if (name === 'open' && ['window', 'document'].includes(kindOf(node.object, scope))) on.open(node.property.start);
      else if ((name === 'assign' || name === 'replace') && kindOf(node.object, scope) === 'location') on.navigation(node.property.start);
    } else if (node.type === 'VariableDeclarator') {
      if (node.id.type === 'Identifier') bind(scope, node.id.name, kindOf(node.init, scope));
      else {
        for (const name of boundNames(node.id)) bind(scope, name, null);
        // `const { open, location: l, document: d } = window`, `const { assign } = location`: what is taken out of a
        // window, a document or a location keeps what it is.
        const from = kindOf(node.init, scope);
        if (node.id.type === 'ObjectPattern' && from) {
          for (const p of node.id.properties) {
            if (p.type !== 'ObjectProperty') continue;
            const key = keyName(p);
            if (from === 'location') {
              if (key === 'assign' || key === 'replace') on.navigation(p.start);
              continue;
            }
            if (key === 'open') on.open(p.start);
            const kind = key === 'location' ? 'location' : key === 'document' ? 'document' : WINDOW.has(key) || key === 'defaultView' ? 'window' : null;
            if (kind && p.value.type === 'Identifier') bind(scope, p.value.name, kind);
          }
        }
      }
    } else if (node.type === 'AssignmentExpression') {
      const left = node.left;
      if (left.type === 'Identifier') {
        if (lookup(scope, left.name) === 'location' && !binding(scope, left.name)) on.navigation(left.start);
        else bind(binding(scope, left.name) ?? scope, left.name, kindOf(node.right, scope));
      } else if (isMember(left)) {
        const name = propertyName(left);
        if (name === 'href' || (name === 'location' && ['window', 'document'].includes(kindOf(left.object, scope)))) on.navigation(left.property.start);
      }
    } else if (isCall(node) || node.type === 'NewExpression') {
      const callee = node.callee;
      if (callee.type === 'Identifier' && callee.name === 'open' && !binding(scope, 'open')) on.open(node.start);
      if (carriesToken(node)) on.token(node.start);
    }
    const children = [];
    for (const key in node) {
      if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
      const value = node[key];
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') children.push([child, scope, false]);
      } else if (typeof value.type === 'string') children.push([value, scope, key === 'left' && node.type === 'BinaryExpression' && node.operator === '+']);
    }
    // In source order, so a name is bound before it is used.
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

const CHECKS = [...rules.TRIAL_ACTIONS.map(([n]) => n), 'claim route', 'resend route', 'store or seat request route', 'setup-link token marker', 'website address', 'QR code library', 'web view library', 'browser-opening call', 'price of the app’s own access', 'price or payment route', 'payment-instruction string', 'platform route'];
const LABELS = { openURL: 'openURL', 'window.open': 'window.open', navigation: 'page navigation' };

/**
 * Audit the exports under `dirs`: every platform found, what it holds, and
 * every finding. `apiOrigin` is the API the bundles were built for: its host
 * is the app's own.
 */
function audit(dirs, apiOrigin = (process.env.EXPO_PUBLIC_API_ORIGIN ?? '').trim()) {
  if (!parse) throw new Error('scripts/audit-bundle.js needs @babel/parser, which Metro installs — run npm ci first.');
  const API_HOST = apiOrigin ? new URL(apiOrigin).hostname : null;
  const allowedHost = (host) => LIBRARY_HOSTS.has(host) || host === API_HOST || host.endsWith('.invalid');

  /** What one platform's files hold, gathered file by file. */
  const platforms = new Map();
  const problems = [];
  const lines = [];
  const platformOf = (name) => {
    if (!platforms.has(name)) {
      platforms.set(name, {
        files: 0, chars: 0, text: '', modules: new Set(), found: new Map(), calls: Object.fromEntries(CALLS.map((c) => [c, new Map()])), unparsed: [], hosts: new Set(), amounts: new Set(),
      });
    }
    return platforms.get(name);
  };
  const report = (p, name, detail) => {
    if (!p.found.has(name)) p.found.set(name, []);
    p.found.get(name).push(detail);
  };
  const count = (table, module) => table.set(module, (table.get(module) ?? 0) + 1);

  for (const dir of dirs) {
    const root = path.resolve(dir);
    const files = walk(root);
    const bundled = new Set(files.map((f) => path.relative(root, f).match(/^_expo[\\/]static[\\/]js[\\/](\w+)[\\/]/)?.[1]).filter(Boolean));
    const native = [...bundled].filter((p) => p !== 'web');
    for (const file of files) {
      const rel = path.relative(root, file);
      const own = rel.match(/^_expo[\\/]static[\\/]js[\\/](\w+)[\\/]/)?.[1];
      if (rel.endsWith('.hbc') || (own && /\.(hbc|bundle)$/.test(rel))) problems.push(`${rel}: Hermes bytecode cannot be read — export with --no-bytecode`);
      if (!/\.(js|html)$/.test(rel)) continue;
      const name = own ?? native[0] ?? 'web';
      const p = platformOf(name);
      if (/^www\.bundle[\\/]/.test(rel)) report(p, 'web view library', `${rel}: a web page shipped inside the native app (an Expo DOM component renders in a web view)`);

      const raw = fs.readFileSync(file, 'utf8');
      const text = decode(raw);
      p.files += 1;
      p.chars += text.length;
      p.text += '\n' + text;

      const words = rules.normalizeWords(text);
      for (const [check, pattern] of WORDS) {
        for (const m of words.matchAll(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))) report(p, check, `${rel}: …${sample(words, m.index, m[0].length)}…`);
      }
      for (const [check, pattern] of [...CODE, ...rules.ROUTES]) {
        for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))) report(p, check, `${rel}: …${sample(text, m.index, m[0].length)}…`);
      }
      for (const m of words.matchAll(AMOUNT)) p.amounts.add(m[0].replace(/\s+/g, ' ').trim());
      for (const m of text.matchAll(ADDRESS)) {
        const host = (m[1] ?? `www.${m[2]}`).toLowerCase();
        if (!allowedHost(host)) p.hosts.add(host);
      }
      if (!rel.endsWith('.js')) continue;

      const mapFile = `${file}.map`;
      const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null;
      if (!map && own) problems.push(`${rel}: no source map — export with --source-maps, so every bundled module can be checked`);
      if (map) {
        map.sources.forEach((source, i) => {
          p.modules.add(source);
          const pkg = source.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/)?.[1];
          if (pkg && deniedPackage(pkg)) report(p, pkg.toLowerCase().includes('qr') ? 'QR code library' : /web-?view/i.test(pkg) ? 'web view library' : 'browser-opening call', `module ${source}`);
          if (pkg || !source.startsWith('/') || !map.sourcesContent?.[i]) return;
          if (/qr/i.test(path.basename(source))) report(p, 'QR code library', `app module ${source}`);
          const code = strip(map.sourcesContent[i]);
          const used = new Set();
          for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s*['"]expo-linking['"]/g)) {
            const names = m[1].match(/\{([^}]*)\}/);
            for (const n of names ? names[1].split(',') : []) if (n.trim()) used.add(n.trim().split(/\s+as\s+/)[0]);
            if (!names || /^[\w$]+\s*,|\*\s*as/.test(m[1].trim())) used.add('*');
          }
          if (/(?:require|import)\(\s*['"]expo-linking['"]\s*\)/.test(code)) used.add('*');
          if (/\bLinking\b/.test(code)) used.add('Linking');
          const allowed = LINKING_ALLOWED.get(source) ?? new Set();
          const denied = [...used].filter((n) => !allowed.has(n));
          if (denied.length) report(p, 'browser-opening call', `app module ${source} names ${denied.join(', ')} of expo-linking or react-native's Linking`);
        });
      }

      const at = moduleAt(raw, map);
      for (let i = raw.indexOf('openURL'); i !== -1; i = raw.indexOf('openURL', i + 1)) count(p.calls.openURL, at(i));
      let program;
      try {
        program = parse(raw, { sourceType: 'script', allowReturnOutsideFunction: true }).program;
      } catch (error) {
        problems.push(`${name}: ${rel} cannot be parsed as JavaScript (${error.message}) — the audit cannot vouch for it`);
        p.unparsed.push(rel);
        continue;
      }
      readTree(program, {
        string: (value, start) => {
          const route = rules.normalizePath(value);
          if (rules.TOKEN_MARKER.test(route)) report(p, 'setup-link token marker', `${rel} (${at(start)}): ${JSON.stringify(value.slice(0, 120))}`);
          for (const [check, pattern] of rules.ROUTES) if (pattern.test(route)) report(p, check, `${rel} (${at(start)}): ${JSON.stringify(value.slice(0, 120))}`);
          for (const m of value.matchAll(RELATIVE_ADDRESS)) if (!allowedHost(m[1].toLowerCase())) p.hosts.add(m[1].toLowerCase());
        },
        open: (start) => count(p.calls['window.open'], at(start)),
        navigation: (start) => count(p.calls.navigation, at(start)),
        token: (start) => report(p, 'setup-link token marker', `${rel} (${at(start)}): a query carrying \`t\`: ${JSON.stringify(raw.slice(start, start + 80))}`),
      });
    }
  }
  if (platforms.size === 0) problems.push('no exported bundle found under ' + dirs.join(', '));

  const total = (table) => [...table.values()].reduce((a, b) => a + b, 0);
  for (const [platform, p] of platforms) {
    // A call site that is not pinned — or a pin no longer met — is a browser-opening call until somebody looks.
    // What is counted on the parsed tree is unknown for a bundle that could not be parsed (itself a finding).
    const sites = (p.unparsed.length ? ['openURL'] : CALLS).map((call) => {
      const pinned = new Map(Object.entries(CALL_SITES[platform]?.[call] ?? {}));
      const found = p.calls[call];
      const modules = [...new Set([...pinned.keys(), ...found.keys()])].sort();
      const differ = modules.filter((m) => (pinned.get(m) ?? 0) !== (found.get(m) ?? 0));
      if (!CALL_SITES[platform]) report(p, 'browser-opening call', `${LABELS[call]}: no baseline is pinned for ${platform} — check each site below, then pin it in CALL_SITES`);
      for (const m of differ) report(p, 'browser-opening call', `${LABELS[call]}: ${found.get(m) ?? 0} found, ${pinned.get(m) ?? 0} pinned in ${m}`);
      return { call, pinned, found, modules, differ };
    });
    if (![...p.modules].some((m) => moduleName(m) === GUARD)) report(p, 'browser-opening call', `the browser guard ${GUARD} is not bundled: nothing makes openURL refuse`);

    lines.push(`\n${platform}: ${p.files} files, ${p.chars} characters, ${p.modules.size} bundled modules`);
    for (const check of new Set([...CHECKS, ...p.found.keys()])) {
      const hits = p.found.get(check) ?? [];
      if (hits.length === 0) {
        lines.push(`  absent   ${check}`);
        continue;
      }
      lines.push(`  FOUND    ${check}: ${hits.length} ×`);
      for (const hit of hits.slice(0, 5)) lines.push(`             ${hit}`);
      problems.push(`${platform}: ${check}`);
    }

    const strangers = [...p.amounts].filter((a) => !SHOP_AMOUNTS.has(a));
    if (strangers.length === 0) lines.push(`  absent   price string (every amount is one of the shop's own: ${[...p.amounts].join(' · ') || 'none'})`);
    else {
      lines.push(`  FOUND    price string: ${strangers.join(' · ')} (the shop's own: ${[...SHOP_AMOUNTS].join(' · ')})`);
      problems.push(`${platform}: price string ${strangers.join(', ')}`);
    }
    if (p.hosts.size === 0) lines.push('  absent   website link (every address is the API’s, a development host or a library’s own)');
    else {
      lines.push(`  FOUND    website link: ${[...p.hosts].join(', ')}`);
      problems.push(`${platform}: website link to ${[...p.hosts].join(', ')}`);
    }

    if (p.unparsed.length) lines.push(`  UNKNOWN  window.open and page navigation call sites: ${p.unparsed.join(', ')} could not be parsed`);
    for (const { call, pinned, found, modules, differ } of sites) {
      lines.push(`  ${differ.length || !CALL_SITES[platform] ? 'CHANGED ' : 'pinned  '} ${LABELS[call]} call sites: ${total(found)} found, ${total(pinned)} pinned`);
      for (const m of modules) lines.push(`             ${differ.includes(m) ? '≠' : ' '} ${found.get(m) ?? 0} found, ${pinned.get(m) ?? 0} pinned   ${m}`);
    }

    for (const [check, needle] of PRESENT) {
      if (p.text.includes(needle)) lines.push(`  present  ${check}`);
      else {
        lines.push(`  MISSING  ${check}: ${needle}`);
        problems.push(`${platform}: ${check} is missing — the scan cannot vouch for this bundle`);
      }
    }
  }

  lines.push('');
  for (const p of problems) lines.push(`FINDING ${p}`);
  lines.push(
    problems.length
      ? `FAIL: ${problems.length} findings`
      : `PASS: ${[...platforms.keys()].join(', ')} — no trial action, link, QR code, web view, browser, price or payment instruction`,
  );
  return { platforms, problems, lines };
}

module.exports = { audit, CALL_SITES, GUARD, PRESENT, SHOP_AMOUNTS };

if (require.main === module) {
  const dirs = process.argv.slice(2);
  if (!parse) {
    console.error('scripts/audit-bundle.js needs @babel/parser, which Metro installs — run npm ci first.');
    process.exit(2);
  }
  if (dirs.length === 0) {
    console.error('usage: node scripts/audit-bundle.js <export-dir> [<export-dir> …]');
    process.exit(2);
  }
  const { problems, lines } = audit(dirs);
  for (const line of lines) console.log(line);
  process.exit(problems.length ? 1 : 0);
}
