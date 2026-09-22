/**
 * The control website is not included from the app (2026-09-22).
 *
 *   node lib/website-deferred.test.ts
 *
 * The app used to mint a handoff ticket and open the website's account page —
 * after registration, and from the blocked screen — and to offer a website
 * registration link. All of it is gone from the app: activation and extension
 * are the platform administrators' decisions, and the app shows the server's
 * state and says whom to contact. The server's handoff route and every record
 * stay; only the app's inclusion of the site is withdrawn. These tests keep it
 * withdrawn.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), 'utf8');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

describe('the website’s entry points are gone from the app', () => {
  it('the helper, the hook and the signup link no longer exist', () => {
    for (const f of ['lib/portal.ts', 'hooks/useAccountPortal.ts', 'lib/signup.ts']) {
      assert.equal(existsSync(new URL(f, ROOT)), false, `${f} must not exist`);
    }
  });

  it('no source builds, configures or opens a website address', () => {
    for (const f of SOURCES) {
      const code = strip(readFileSync(f, 'utf8'));
      for (const banned of ['EXPO_PUBLIC_PORTAL_URL', 'EXPO_PUBLIC_SIGNUP_URL', 'accountPortalUrl', 'signupUrl', 'portal-handoff', 'portal-session', 'openAccountPortal', 'useAccountPortal']) {
        assert.equal(code.includes(banned), false, `${f} must not mention ${banned}`);
      }
      assert.doesNotMatch(code, /from 'expo-linking'|require\('expo-linking'\)/, `${f} must not open links`);
      assert.doesNotMatch(code, /Linking\.openURL|WebView/, `${f} must not open a browser or a web view`);
    }
  });

  it('registration ends on the state screen, with nothing opened in a browser', () => {
    const verify = strip(read('app/(auth)/verify.tsx'));
    assert.match(verify, /router\.replace\('\/subscription-blocked' as never\)/);
    assert.doesNotMatch(verify, /portal|Linking/);
  });
});

describe('the blocked screen', () => {
  const code = strip(read('app/subscription-blocked.tsx'));

  it('names every closed state the server can answer with, including a refusal', () => {
    for (const state of ['rejected', 'suspended', 'cancelled', 'pending']) {
      assert.match(code, new RegExp(`state === '${state}'`), `handles ${state}`);
    }
    assert.match(code, /sub\.\$\{key\}\.title/);
  });

  it('offers to check again and whom to contact — no website, payment link or price', () => {
    assert.match(code, /sub\.recheck/);
    assert.match(code, /sub\.contact/);
    assert.match(code, /action\.signOut/);
    assert.doesNotMatch(code, /http|www\.|MRU|\d{3,}|pay|portal|website/i);
  });
});

describe('the words', () => {
  it('no subscription copy sends anybody to a website, in any language', () => {
    for (const lang of ['en', 'fr', 'ar']) {
      const dict = read(`lib/i18n/${lang}.ts`);
      const subscriptionLines = dict.split('\n').filter((l) => /'(subscription|sub)\./.test(l) || /^\s+'[^']*(website|site officiel|الموقع)/.test(l));
      for (const line of subscriptionLines) {
        assert.doesNotMatch(line, /website|site officiel|الموقع الرسمي|WhatsApp/i, `${lang}: ${line.trim()}`);
      }
      for (const removed of ["'sub.manage'", "'register.portal.open'", "'register.portal.failed'", "'auth.signup.unconfigured'", "'auth.signup.unavailable'"]) {
        assert.equal(dict.includes(removed), false, `${lang} still has ${removed}`);
      }
      for (const needed of ["'sub.rejected.title'", "'sub.rejected.body'", "'sub.contact'"]) {
        assert.equal(dict.includes(needed), true, `${lang} lacks ${needed}`);
      }
    }
  });
});
