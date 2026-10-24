/**
 * A business without an entitlement is never told it is "waiting for approval" (2026-10-24).
 *
 *   node lib/access-pending-wording.test.ts
 *
 * Redeeming a platform-issued setup code activates the Owner at once; no approval follows it. What such a business
 * lacks is active access (a subscription or a grant, arranged outside the app — the app never names either: App Store
 * rule, `access-boundary.test.ts`), and the `pending` state says exactly that, in every language. An answer the app
 * cannot read is said as unreadable (`access.closed.unknown.*`), never as pending.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';

const CATALOGUES = { en, fr, ar } as Record<string, Record<string, string>>;
const PENDING = ['access.state.pending', 'access.closed.pending.title', 'access.closed.pending.body'];
const UNKNOWN = ['access.closed.unknown.title', 'access.closed.unknown.body'];
const APPROVAL: Record<string, RegExp> = { en: /approv|review/i, fr: /approb|approuv|valid/i, ar: /موافقة|مراجعة/ };
const READY: Record<string, RegExp[]> = { en: [/access/i, /account is ready/i], fr: [/accès/i, /compte est prêt/i], ar: [/وصول/, /حسابك جاهز/] };

for (const [lang, dict] of Object.entries(CATALOGUES)) {
  describe(lang, () => {
    it('the pending state names no approval step', () => {
      for (const key of [...PENDING, ...UNKNOWN]) {
        assert.ok(dict[key], `${lang} lacks ${key}`);
        assert.doesNotMatch(dict[key], APPROVAL[lang], `${lang} ${key}: ${dict[key]}`);
      }
    });
    it('says the account is ready and what is missing: active access', () => {
      for (const w of READY[lang]) assert.match(dict['access.closed.pending.body'], w);
    });
    it('an unreadable answer is not worded like the pending one', () => {
      assert.notEqual(dict['access.closed.unknown.title'], dict['access.closed.pending.title']);
    });
  });
}
