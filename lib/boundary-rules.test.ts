/**
 * The shared boundary rules, phrase by phrase (`scripts/boundary-rules.cjs`).
 *
 *   node lib/boundary-rules.test.ts
 *
 * The source boundary test (`lib/access-boundary.test.ts`) and the bundle audit (`scripts/audit-bundle.js`) judge
 * words and routes by these rules. Each phrase below was once a way past them — a claim with "7 day" for "7-day",
 * "Commencer maintenant mon essai", "جرّب مجانًا", a resend of the link rather than of the instructions — so each
 * stays here, with the app's own sentences that must stay allowed beside them: sending a code again is the app's
 * own sign-in and team check, not the trial's.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const rules = createRequire(import.meta.url)('../scripts/boundary-rules.cjs');

/** The rules a phrase breaks, by name, read the way both guards read it: normalized first. */
function broken(phrase: string): string[] {
  const words = rules.normalizeWords(phrase);
  const named: [string, RegExp][] = [...rules.TRIAL_ACTIONS, ['website address', rules.WEBSITE_ADDRESS], ['access price', rules.ACCESS_PRICE], ['payment instruction', rules.PAYMENT_INSTRUCTION]];
  return named.filter(([, pattern]) => pattern.test(words)).map(([name]) => name);
}
const assertBroken = (phrase: string, rule: RegExp) => assert.ok(broken(phrase).some((name) => rule.test(name)), `${JSON.stringify(phrase)} is not caught (${broken(phrase).join(', ') || 'nothing'})`);
const assertAllowed = (phrase: string) => assert.deepEqual(broken(phrase), [], `${JSON.stringify(phrase)} is the app's own and must stay allowed`);

describe('a claim, however it is worded', () => {
  it('English: any start, try or get, with the trial within five words, or trying for free', () => {
    for (const phrase of [
      'Start my 7-day free trial', 'Start my {durationDays}-day free trial', 'Start my 7‑day free trial', 'Start my 7 day free trial',
      'Start your 7 days free trial', 'Start your seven day free trial', 'Start a 1-week free trial', 'Start the {durationDays} day free trial',
      'Start free trial', 'Start your free trial now', 'Start using your free trial', 'Begin trial', 'Get started with your free trial',
      'Activate my trial', 'Claim the 7-day trial', 'Try Dukan ERP free for 7 days',
    ]) {
      assertBroken(phrase, /^claim button text \(EN\)$/);
    }
  });

  it('French: any of the verbs, with the essai within five words, or starting for free', () => {
    for (const phrase of [
      'Commencer mon essai gratuit', 'Commencer maintenant mon essai gratuit', 'Démarrer mon essai gratuit de 7 jours', 'Démarrer l’essai gratuit',
      'Je commence mon essai', 'Activer votre période d’essai', 'Lancer mon essai de {durationDays} jours', 'Commencez gratuitement pendant 7 jours',
      'Profitez de 7 jours gratuits',
    ]) {
      assertBroken(phrase, /^claim button text \(FR\)$/);
    }
  });

  it('Arabic: start, activate, ask, get or try the trial, try it free, or make use of it — diacritics or not', () => {
    for (const phrase of [
      'ابدأ تجربتك المجانية', 'ابدأ الفترة التجريبية', 'ابدأ فترتي التجريبية المجانية لمدة 7 أيام', 'ابدأ الآن فترتك التجريبية المجانية لمدة 7 أيام',
      'فعّل فترتك التجريبية المجانية', 'جرّب مجانًا لمدة 7 أيام', 'استفد من الفترة التجريبية المجانية',
    ]) {
      assertBroken(phrase, /^claim button text \(AR\)$/);
    }
  });
});

describe('a resend, by what it sends again: the instructions, the link, the message or the e-mail', () => {
  it('English', () => {
    for (const phrase of [
      'Resend instructions', 'Send the setup instructions again', 'Send me the instructions again', 'Resend the setup link', 'Send the link again',
      'Send me a new link', 'Resend email', 'Send the message again', 'Request new instructions', 'Get the instructions again',
    ]) {
      assertBroken(phrase, /^resend\/send button text \(EN\)$/);
    }
  });

  it('French', () => {
    for (const phrase of [
      'Renvoyer les instructions', 'Renvoyer les instructions de configuration', 'Envoyer à nouveau les instructions', 'Renvoyer le lien',
      'Renvoyer le lien de configuration', 'Envoyer à nouveau le lien', 'Recevoir de nouveau les instructions', 'Renvoyer le message',
    ]) {
      assertBroken(phrase, /^resend\/send button text \(FR\)$/);
    }
  });

  it('Arabic', () => {
    for (const phrase of [
      'إعادة إرسال التعليمات', 'أعِد إرسال التعليمات', 'إرسال التعليمات مرة أخرى', 'إرسال تعليمات الإعداد مرة أخرى', 'إعادة إرسال الرابط',
      'إعادة إرسال رابط الإعداد', 'أرسل الرابط مرة أخرى',
    ]) {
      assertBroken(phrase, /^resend\/send button text \(AR\)$/);
    }
  });
});

describe('a price of the app’s own access, by what it prices', () => {
  it('per month, per seat or place, an extra place, a tariff, an amount in ouguiya', () => {
    for (const phrase of ['500 MRU per month', '100 MRU per seat', '500 UM par mois', '500 MRU / mois', '500 أوقيه شهريا', '500 أوقية', 'Additional staff place: 100', 'Place supplémentaire : 100']) {
      assertBroken(phrase, /^access price$/);
    }
  });
});

describe('what the app does say stays allowed', () => {
  it('its codes are sent again, its rows are linked, and the trial’s own approved sentences describe without acting', () => {
    for (const phrase of [
      'Send the code again', 'Send it again', 'Send a new code', 'Send again', 'Renvoyer le code', 'Envoyer à nouveau', 'Envoyer un nouveau code',
      'أرسل الرمز مرّة أخرى', 'Create and link product', '30 000 MRU',
      'Your business is eligible for a 7-day free trial', 'Starts only after you claim it', 'Ne commence qu’après votre demande',
      'Votre commerce peut bénéficier d’un essai gratuit de 7 jours', 'لا تبدأ إلا بعد أن تطلبها', 'نشاطك التجاري مؤهل لفترة تجريبية مجانية مدتها 7 أيام',
      'We sent the instructions for completing your business setup to your verified contact.',
      'We are sending the instructions for completing your business setup to your verified contact.',
      'Nous envoyons les instructions pour finaliser la configuration de votre commerce à votre contact vérifié.', 'سيتم إرسال التعليمات تلقائيًا',
    ]) {
      assertAllowed(phrase);
    }
  });
});

describe('a path, as a server would route it', () => {
  it('decoded, its dot segments resolved, its slashes single — so the platform’s routes are found in any spelling', () => {
    assert.equal(rules.normalizePath('/platform/./my-subscription/../my-subscription/trial/claim'), '/platform/my-subscription/trial/claim');
    assert.equal(rules.normalizePath('%2Fplatform%2Fmy-subscription%2Ftrial%2Fclaim'), '/platform/my-subscription/trial/claim');
    assert.equal(rules.normalizePath('%252Fplatform%252Fquote'), '/platform/quote');
    assert.equal(rules.normalizePath('\\platform\\\\my-subscription'), '/platform/my-subscription');
    assert.equal(rules.normalizePath('//platform//x/../y'), '/platform/y');
    assert.equal(rules.normalizePath('a/b/c/../../../d'), 'd');
    assert.equal(rules.normalizePath('../../x'), '../../x');
    const [, claim] = rules.ROUTES.find(([name]: [string]) => name === 'claim route');
    assert.match(rules.normalizePath('/PLATFORM/MY-SUBSCRIPTION/TRIAL/CLAIM'), claim);
  });
});
