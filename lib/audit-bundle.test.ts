/**
 * The bundle audit, held to every way past it that was ever found (`scripts/audit-bundle.js`).
 *
 *   node lib/audit-bundle.test.ts
 *
 * A bundle is written for the purpose in a temporary directory: every call site the audit pins, the browser guard,
 * the read-only status route, the trial card's titles and the guard's refusal, each module on its own line of a
 * source map. The audit must pass it as it is. Then each way past the audit that a review or a verification found —
 * a browser opened through an alias of the window or `document.defaultView`, a page that navigates itself, a token
 * carried by a query, a claim or a resend in another wording, a price, a QR encoder, a web view — is added to it,
 * one at a time, and the audit must name it by the check it breaks, on the platform it was added to.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const auditor = createRequire(import.meta.url)('../scripts/audit-bundle.js');

const work = mkdtempSync(join(tmpdir(), 'audit-bundle-test-'));
after(() => rmSync(work, { recursive: true, force: true }));

/** A number as a source map writes it: base64 VLQ. */
function vlq(value: number): string {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += digits[digit];
  } while (v > 0);
  return out;
}

/** What the audit pins, written as code: each site of each kind, in the module it is pinned to. */
const SITE: Record<string, string> = { openURL: 'x.openURL(u);', 'window.open': 'window.open(u);', navigation: 'location.assign(u);' };

/**
 * One platform's export: the pinned sites, module by module, then the guard's refusal and what must be present —
 * unless `without` names a module to leave out — and the injected code last, on a line no module maps.
 */
function exportWith(platform: 'web' | 'ios', injected = '', without = ''): string {
  const modules = new Map<string, string[]>();
  const add = (module: string, code: string) => modules.set(module, [...(modules.get(module) ?? []), code]);
  for (const [call, pins] of Object.entries(auditor.CALL_SITES[platform] as Record<string, Record<string, number>>)) {
    for (const [module, count] of Object.entries(pins)) for (let i = 0; i < count; i++) add(module, SITE[call]);
  }
  const present = Object.fromEntries((auditor.PRESENT as [string, string][]).map(([check, text]) => [check, JSON.stringify(text)]));
  add(auditor.GUARD, `var refusal=${present['browser guard’s refusal']};`);
  add('/lib/trial-setup.ts', `var route=${present['read-only status route']};`);
  for (const lang of ['EN', 'FR', 'AR']) add(`/lib/i18n/${lang.toLowerCase()}.ts`, `var title=${present[`card title (${lang})`]};`);
  const kept = [...modules].filter(([module]) => module !== without);
  const lines = kept.map(([, code]) => `__d(function(g,r,i,a,m,e,d){var x=r(1),u=r(2);${code.join('')}});`);
  const mappings = kept.map((_, i) => `A${vlq(i === 0 ? 0 : 1)}AA`).join(';');
  const dir = mkdtempSync(join(work, `${platform}-`));
  const js = join(dir, '_expo', 'static', 'js', platform);
  mkdirSync(js, { recursive: true });
  writeFileSync(join(js, 'entry-test.js'), [...lines, injected].join('\n'));
  writeFileSync(join(js, 'entry-test.js.map'), JSON.stringify({ version: 3, sources: kept.map(([module]) => module), names: [], mappings }));
  return dir;
}

const findings = (dir: string): string[] => auditor.audit([dir], 'https://example.invalid').problems;
function caught(platform: 'web' | 'ios', injected: string, check: string) {
  const problems = findings(exportWith(platform, injected));
  assert.ok(problems.includes(`${platform}: ${check}`), `${JSON.stringify(injected)} is not found as ${check}: ${problems.join('; ') || 'PASS'}`);
}

describe('the bundle the audit is held against', () => {
  it('passes as it is, on the web and on a phone', () => {
    assert.deepEqual(findings(exportWith('web')), []);
    assert.deepEqual(findings(exportWith('ios')), []);
  });

  it('fails without the browser guard', () => {
    const problems = findings(exportWith('ios', '', auditor.GUARD));
    assert.ok(problems.includes('ios: browser-opening call'), problems.join('; '));
    assert.ok(problems.some((p: string) => p.startsWith('ios: browser guard’s refusal is missing')), problems.join('; '));
  });
});

describe('a browser, however it is reached', () => {
  it('opened through the window by any name: an alias, document.defaultView, a destructured or a bare open', () => {
    for (const code of [
      "window.open(e,'_blank')",
      "document.defaultView.open(e,'_blank')",
      'var w=window;w.open(e)',
      "var v=typeof window!=='undefined'?window:null;v.open(e)",
      'const{open:o}=self;o(e)',
      'open(e)',
      "globalThis['open'](e)",
    ]) {
      caught('web', `;(function(e){${code}})(q);`, 'browser-opening call');
    }
  });

  it('a page that navigates itself: location assigned, assign or replace, an href or an action set, a form sent, the page’s own navigation, a document written — by any name', () => {
    for (const code of [
      'window.location.assign(e)',
      'self.location.replace(e)',
      'location.href=e',
      'window.location=e',
      'document.location=e',
      'const{location:l}=window;l.assign(e)',
      'var l=document.defaultView.location;l.replace(e)',
      'var g=location.replace.bind(location);g(e)',
      'const{assign:a}=window.location;a.call(location,e)',
      "var a=document.createElement('a');a.href=e;a.click()",
      "var a=document.createElement('a');a.setAttribute('href',e);a.click()",
      "var s=document.createElementNS('http://www.w3.org/2000/svg','a');s.setAttributeNS(null,'xlink:href',e)",
      "var f=document.createElement('form');f.setAttribute('action',e);f.submit()",
      'f.requestSubmit()',
      'window.navigation.navigate(e)',
      'navigation.navigate(e)',
      'const{navigation:v}=self;v.navigate(e)',
      "document.write('<p>'+e+'</p>')",
    ]) {
      caught('web', `;(function(e){${code}})(q);`, 'browser-opening call');
    }
  });

  it('a page written to leave: a refresh to another address, a link in markup — however the string is built', () => {
    for (const code of [
      `document.body.innerHTML='<meta http-equiv="refresh" content="0;url='+e+'">'`,
      "var m=document.createElement('meta');m.httpEquiv='refresh';m.content='0;url='+e;document.head.appendChild(m)",
      'n.html=`<a href="${e}">open</a>`',
    ]) {
      caught('web', `;(function(e,n){${code}})(q);`, 'browser-opening call');
    }
  });

  it('openURL in any form, on a phone and on the web', () => {
    for (const code of ['r(d[2]).Linking.openURL(e)', 'const{openURL:h}=t.default;h(e)', '(0,o.openURL)(e)']) {
      caught('ios', `;(function(e,t,o){${code}})(q);`, 'browser-opening call');
      caught('web', `;(function(e,t,o){${code}})(q);`, 'browser-opening call');
    }
  });
});

describe('the setup link, however it is built', () => {
  it('its token in a fragment or a query — written, percent-encoded, joined, or carried by URLSearchParams', () => {
    for (const code of [
      "n.link=o+'#t='+t",
      'n.link=`${o}/start?t=${t}`',
      "n.x='%23t%3D'+e",
      "u.hash='t='+e",
      "n.link=o+'/start?'+new URLSearchParams({t:e})",
      "n.link=new URLSearchParams([['t',e]])",
      "u.searchParams.set('t',e)",
      "p.append('t',e)",
      "n.x='/ACCOUNT/TRIAL'",
    ]) {
      caught('web', `;(function(n,o,t,e,u,p){${code}})(q);`, 'setup-link token marker');
    }
  });

  it('the trial’s routes, in any letter case', () => {
    caught('web', ";n.api.post('/PLATFORM/MY-SUBSCRIPTION/TRIAL/CLAIM',{});", 'claim route');
    caught('ios', ";n.api.post('/account/Trial-Setup/Resend',{});", 'resend route');
  });
});

describe('words a screen could say', () => {
  it('a claim or a resend in English, French or Arabic, in any of the wordings that once passed', () => {
    const say = (text: string) => `;n.x=${JSON.stringify(text)};`;
    for (const [text, check] of [
      ['Start my 7 day free trial', 'claim button text (EN)'],
      ['Get started with your free trial', 'claim button text (EN)'],
      ['Commencer maintenant mon essai gratuit', 'claim button text (FR)'],
      ['جرّب مجانًا لمدة 7 أيام', 'claim button text (AR)'],
      ['Resend the setup link', 'resend/send button text (EN)'],
      ['Renvoyer le lien', 'resend/send button text (FR)'],
      ['إعادة إرسال الرابط', 'resend/send button text (AR)'],
      ['Start now — 7 days free', 'claim button text (EN)'],
      ['ابدأ الآن مجانًا', 'claim button text (AR)'],
    ]) {
      caught('web', say(text), check);
    }
  });

  it('the trial named in any sentence but its own — in a string, a joined string or a page rendered ahead of time', () => {
    const named = 'trial named outside its approved sentences';
    for (const text of ['Sign up for a free trial', 'Enable your free trial', 'Inscrivez-vous à l’essai gratuit', 'سجّل في الفترة التجريبية', 'access.trial.Start my free trial']) {
      caught('web', `;n.x=${JSON.stringify(text)};`, named);
    }
    caught('ios', ";n.x='Use my free '+'trial';", named);
    // The trial's own sentence, as the catalogue writes it, is no finding.
    assert.deepEqual(findings(exportWith('web', `;n.x=${JSON.stringify('Free trial: active, ends {date}')};`)), []);
    const page = exportWith('web');
    writeFileSync(join(page, 'access.html'), '<html><body><p>Your business is eligible for a 7-day free trial</p><p>Enable your free trial</p></body></html>');
    assert.ok(findings(page).includes(`web: ${named}`), 'a page rendered ahead of time');
  });

  it('a price of the app’s own access, a website, a QR encoder, a web view', () => {
    caught('web', ";n.p='500 MRU per month';", 'price of the app’s own access');
    caught('web', ";n.site='https://dukan.tsx-mr.com';", 'website address');
    caught('web', ";throw new Error('The amount of data is too big to be stored in a QR Code');", 'QR code library');
    caught('ios', ";(0,o.requireNativeViewManager)('ExpoDomWebViewModule');", 'web view library');
    const problems = findings(exportWith('web', ";n.p='200 MRU';"));
    assert.ok(problems.some((p: string) => p.startsWith('web: price string 200 MRU')), problems.join('; '));
  });
});
