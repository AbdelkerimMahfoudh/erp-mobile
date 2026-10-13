#!/usr/bin/env node
/**
 * Exported-bundle audit: what the app actually ships, not what its source
 * promises (docs/21, the owner's correction of 2026-10-13).
 *
 *   EXPO_PUBLIC_API_ORIGIN=https://example.invalid npx expo export --platform web --output-dir <web>
 *   EXPO_PUBLIC_API_ORIGIN=https://example.invalid npx expo export --platform ios --no-bytecode --output-dir <ios>
 *   EXPO_PUBLIC_API_ORIGIN=https://example.invalid node scripts/audit-bundle.js <web> <ios> [<android> …]
 *
 * The app may SAY what the server knows about the one 7-day free trial; it can
 * DO nothing about it. The trial is started on the Dukan ERP website alone,
 * its setup instructions are sent by the server to the Owner's verified
 * contacts, and sending them again happens on the website after sign-in or
 * through support. `lib/access-boundary.test.ts` holds the source to that;
 * this holds the exported bundles to it, after every transform, minifier and
 * dependency has had its say. Each item below is proved ABSENT by name:
 *
 *   claim button text and claim routes · resend/send button text (EN/FR/AR)
 *   and resend routes · setup-link token markers · website addresses and
 *   links · QR code libraries · web view libraries · browser-opening calls ·
 *   price strings · payment-instruction strings · the platform's routes
 *
 * and the read-only status route (`account/trial-setup`) and the trial card's
 * title in English, French and Arabic are proved PRESENT — in every bundle
 * scanned — so the audit cannot pass by scanning nothing.
 *
 * Strings are compared after decoding `\uXXXX`, `\u{…}` and `\xXX` escapes:
 * native bundles write French and Arabic that way. Native bundles must be
 * exported with `--no-bytecode`; Hermes bytecode cannot be read as text and
 * is refused rather than skipped. Every absolute address in a bundle must
 * belong to the API origin it was exported for, a development host, or one
 * of the libraries' own documentation and asset hosts listed below; anything
 * else is reported, so a website address cannot slip in under a new name.
 *
 * Exits 1 on any finding, 0 when every check holds on every platform.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node scripts/audit-bundle.js <export-dir> [<export-dir> …]');
  process.exit(2);
}

/** What must not be shipped, each by the name it is reported under. */
const ABSENT = [
  // The claim: only the website exposes it.
  ['claim button text (EN)', /start (my|your|the) (7-day )?(free )?trial|claim (my|your|the) (7-day )?(free )?trial/i],
  ['claim button text (FR)', /d[ée]marrer (mon|votre|l['’])\s?essai|r[ée]clamer (mon|votre|l['’])\s?essai/i],
  ['claim button text (AR)', /ابدأ (فترتي|فترتك|الفترة) التجريبية/],
  ['claim route', /trial\/claim|trial\/link|my-subscription/],
  // Sending the instructions again: the website's, after sign-in, or support's.
  ['resend/send button text (EN)', /\b(re)?send (the )?(setup )?instructions\b/i],
  ['resend/send button text (FR)', /\br?envoyer (les |des )?instructions\b/i],
  ['resend/send button text (AR)', /(إعادة إرسال|أعد إرسال|أرسل) (ال)?تعليمات|إرسال تعليمات الإعداد مرة أخرى/],
  ['resend route', /trial\/setup\/resend|trial-setup\/resend|setup\/resend/],
  // The one-time setup link is for the website's eyes only.
  ['setup-link token marker', /account\/trial(?!-setup)|["'`][#?]t=/],
  // No website: neither its address nor a configured origin for it.
  ['website address', /tsx-mr\.(com|mr|net|org)|dukan[\w-]*\.(com|mr|net|org|app)\b|PUBLIC_SITE_ORIGIN|EXPO_PUBLIC_(SITE|PORTAL|SIGNUP|WEBSITE)_URL/i],
  // Nothing to scan towards the website, and no page of it inside the app.
  ['QR code library', /bad rs block|code length overflow|too big to be stored in a QR Code|react-native-qrcode|qrcode\.react|react-qr-code|QRCodeSVG|QRCodeStyling/i],
  ['web view library', /RNCWebView|WebViewNativeComponent|requireNativeView\(\s*["']ExpoDomWebView|@expo\/dom-webview|react-native-webview\/lib/],
  ['browser-opening call', /openBrowserAsync|openAuthSessionAsync|ExpoWebBrowser|WebBrowser\.open|\bLinking\.openURL\(|(?:openURL|window\.open)\(\s*["'`]https?:/],
  // The app prices nothing of its own and asks for no payment.
  ['price string', /\b(100|300|500|700)\s?MRU\b|\bper month\b|\bpar mois\b|شهريًا|MRU\s?\/\s?(month|mois)/i],
  ['payment-instruction string', /payment-instructions|platform\/quote|payment instructions|instructions de paiement|تعليمات الدفع|\bpay now\b|payer maintenant|ادفع الآن|no payment is required|aucun paiement n.est demandé|لا يلزم أي دفع/i],
  ['platform route', /\/platform\//],
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
const apiOrigin = (process.env.EXPO_PUBLIC_API_ORIGIN ?? '').trim();
const API_HOST = apiOrigin ? new URL(apiOrigin).hostname : null;
const allowedHost = (host) => LIBRARY_HOSTS.has(host) || host === API_HOST || host.endsWith('.invalid');

/** The card's title, as each catalogue spells it: it must be in every bundle. */
function catalogueValue(lang, key) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'i18n', `${lang}.ts`), 'utf8');
  const escaped = key.replace(/[.]/g, '\\.');
  const m = src.match(new RegExp(`^\\s*'${escaped}':\\s*'((?:[^'\\\\]|\\\\.)*)',\\s*$`, 'm'));
  if (!m) throw new Error(`lib/i18n/${lang}.ts has no ${key}`);
  return m[1].replace(/\\(.)/g, '$1');
}
const PRESENT = [
  ['read-only status route', 'account/trial-setup'],
  ['card title (EN)', catalogueValue('en', 'trialSetup.title')],
  ['card title (FR)', catalogueValue('fr', 'trialSetup.title')],
  ['card title (AR)', catalogueValue('ar', 'trialSetup.title')],
];

const decode = (s) =>
  s
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const walk = (d) => fs.readdirSync(d).flatMap((n) => (fs.statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));

/** The bundles of every export, by platform (`_expo/static/js/<platform>/…`); web's prerendered pages go with web. */
const platforms = new Map();
const problems = [];
for (const dir of dirs) {
  for (const file of walk(path.resolve(dir))) {
    const rel = path.relative(path.resolve(dir), file);
    const js = rel.match(/_expo[\\/]static[\\/]js[\\/](\w+)[\\/]/);
    if (rel.endsWith('.hbc') || (js && /\.(hbc|bundle)$/.test(rel))) problems.push(`${rel}: Hermes bytecode cannot be read — export with --no-bytecode`);
    const platform = js ? js[1] : rel.endsWith('.html') ? 'web' : null;
    if (!platform || !/\.(js|html)$/.test(rel)) continue;
    const entry = platforms.get(platform) ?? { files: 0, text: '' };
    entry.files += 1;
    entry.text += '\n' + decode(fs.readFileSync(file, 'utf8'));
    platforms.set(platform, entry);
  }
}
if (platforms.size === 0) problems.push('no exported bundle found under ' + dirs.join(', '));

for (const [platform, { files, text }] of platforms) {
  console.log(`\n${platform}: ${files} files, ${text.length} characters`);
  for (const [name, pattern] of ABSENT) {
    const hits = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
    if (hits.length === 0) {
      console.log(`  absent   ${name}`);
      continue;
    }
    const sample = text.slice(Math.max(0, hits[0].index - 60), hits[0].index + 80).replace(/\s+/g, ' ');
    console.log(`  FOUND    ${name}: ${hits.length} × …${sample}…`);
    problems.push(`${platform}: ${name}`);
  }
  const strangers = new Set();
  for (const m of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})/gi)) {
    if (!allowedHost(m[1].toLowerCase())) strangers.add(m[1].toLowerCase());
  }
  if (strangers.size === 0) console.log('  absent   website link (every address is the API’s, a development host or a library’s own)');
  else {
    console.log(`  FOUND    website link: ${[...strangers].join(', ')}`);
    problems.push(`${platform}: website link to ${[...strangers].join(', ')}`);
  }
  for (const [name, needle] of PRESENT) {
    if (text.includes(needle)) console.log(`  present  ${name}`);
    else {
      console.log(`  MISSING  ${name}: ${needle}`);
      problems.push(`${platform}: ${name} is missing — the scan cannot vouch for this bundle`);
    }
  }
}

console.log('');
for (const p of problems) console.log(`FINDING ${p}`);
console.log(problems.length ? `FAIL: ${problems.length} findings` : `PASS: ${[...platforms.keys()].join(', ')} — no trial action, link, QR code, web view, browser, price or payment instruction`);
process.exit(problems.length ? 1 : 0);
