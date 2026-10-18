/**
 * The shared boundary rules, phrase by phrase (`scripts/boundary-rules.cjs`).
 *
 *   node lib/boundary-rules.test.ts
 *
 * The source boundary test (`lib/access-boundary.test.ts`) and the bundle audit (`scripts/audit-bundle.js`) judge
 * words and routes by these rules. Each phrase below was once a way past them — a claim with "7 day" for "7-day",
 * "Commencer maintenant mon essai", "جرّب مجانًا", "Try Dukan ERP for 7 days", a resend of the link rather than of the
 * instructions, "Have the instructions sent again", "Demander un nouvel envoi des instructions" — so each stays here,
 * with the app's own sentences that must stay allowed beside them: sending a code again is the app's own sign-in and
 * team check, not the trial's, and "try again" follows a failure.
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
      // Starting for free, without the trial's name.
      'Start now — 7 days free', 'Start for free', 'Get started free', 'Sign up free', 'Enable it for free today',
      // Trying, using or getting it for a time, or on us (verification, R5-3).
      'Try Dukan ERP for 7 days', 'Enjoy Dukan ERP for a week', 'Use Dukan ERP free for 7 days', 'Sign up and get 7 days',
      'Start now: 14 days at no cost', 'Your first week is on us — start today',
    ]) {
      assertBroken(phrase, /^claim button text \(EN\)$/);
    }
  });

  it('French: any of the verbs, with the essai within five words, or starting for free', () => {
    for (const phrase of [
      'Commencer mon essai gratuit', 'Commencer maintenant mon essai gratuit', 'Démarrer mon essai gratuit de 7 jours', 'Démarrer l’essai gratuit',
      'Je commence mon essai', 'Activer votre période d’essai', 'Lancer mon essai de {durationDays} jours', 'Commencez gratuitement pendant 7 jours',
      'Profitez de 7 jours gratuits',
      // For a time, or offered (verification, R5-3).
      'Profitez de 7 jours offerts', 'Essayez Dukan ERP pendant 7 jours', 'Bénéficiez de 7 jours gratuits', 'Utilisez Dukan ERP gratuitement pendant 7 jours',
      'Commencez maintenant : 7 jours offerts', 'Essayez une semaine sans frais',
    ]) {
      assertBroken(phrase, /^claim button text \(FR\)$/);
    }
  });

  it('Arabic: start, activate, ask, get or try the trial, try it free, or make use of it — diacritics or not', () => {
    for (const phrase of [
      'ابدأ تجربتك المجانية', 'ابدأ الفترة التجريبية', 'ابدأ فترتي التجريبية المجانية لمدة 7 أيام', 'ابدأ الآن فترتك التجريبية المجانية لمدة 7 أيام',
      'فعّل فترتك التجريبية المجانية', 'جرّب مجانًا لمدة 7 أيام', 'استفد من الفترة التجريبية المجانية',
      // Starting for free, without the trial's name.
      'ابدأ الآن مجانًا', 'فعّل مجانًا لمدة 7 أيام',
      // For a time, or at no cost — and a verb joined to its "and" (verification, R5-3).
      'جرّب Dukan ERP لمدة 7 أيام', 'احصل على 7 أيام دون مقابل', 'استمتع بـ 7 أيام مجانًا', 'ابدأ الآن لمدة 7 أيام',
      'استخدم Dukan ERP مجانًا لمدة 7 أيام', 'سجّل الآن واحصل على 7 أيام', 'جرّب أسبوعًا بلا مقابل',
    ]) {
      assertBroken(phrase, /^claim button text \(AR\)$/);
    }
  });
});

describe('the trial named, in any wording: only its own sentences and the names the code knows it by may name it', () => {
  it('a sentence that names the trial is found by its words, whatever its verb — in English, French or Arabic', () => {
    for (const phrase of [
      'Sign up for a free trial', 'Enable your free trial', 'Free trial: start now', 'Use my free trial', 'Continue to your free trial',
      'Inscrivez-vous à l’essai gratuit', 'Utiliser mon essai gratuit', 'Essai gratuit : commencer', 'سجّل في الفترة التجريبية', 'فترة تجريبية',
    ]) {
      assert.match(rules.normalizeWords(phrase), rules.TRIAL_WORDS, phrase);
    }
    for (const phrase of ['Réessayer', 'Nombre d’essais restants', 'Une connexion est nécessaire', 'Try again', 'Retry']) {
      assert.doesNotMatch(rules.normalizeWords(phrase), rules.TRIAL_WORDS, phrase);
    }
  });

  it('a name the code knows it by is a whole key, its read-only route, its query key or its card’s test id — nothing longer', () => {
    for (const name of ['access.trial.ends', 'access.state.trial_available', 'trialSetup.delivery.sent', '/account/trial-setup', 'trial-setup', 'trial-setup-card']) {
      assert.match(name, rules.TRIAL_NAME, name);
    }
    for (const text of ['access.trial.Start my free trial', 'trial-setup: start your free trial', '/account/trial', 'trial']) {
      assert.doesNotMatch(text, rules.TRIAL_NAME, text);
    }
  });
});

describe('a resend, by what it sends again: the instructions, the link, the message or the e-mail', () => {
  it('English', () => {
    for (const phrase of [
      'Resend instructions', 'Send the setup instructions again', 'Send me the instructions again', 'Resend the setup link', 'Send the link again',
      'Send me a new link', 'Resend email', 'Send the message again', 'Request new instructions', 'Get the instructions again',
      'Send again the link', 'Send again the setup instructions',
      // Named with "again" or "new" in any order, or asked to be sent (verification, R5-3).
      'Ask for the setup instructions again', 'Request the setup e-mail again', 'Have the instructions sent again', 'Get the setup link again',
      'Send the instructions once more', 'Instructions: send again', 'Request a fresh link', 'Get a new setup link', 'Need new instructions?',
      'Ask for the link to be sent', 'Request sending the instructions',
    ]) {
      assertBroken(phrase, /^resend\/send button text \(EN\)$/);
    }
  });

  it('French', () => {
    for (const phrase of [
      'Renvoyer les instructions', 'Renvoyer les instructions de configuration', 'Envoyer à nouveau les instructions', 'Renvoyer le lien',
      'Renvoyer le lien de configuration', 'Envoyer à nouveau le lien', 'Recevoir de nouveau les instructions', 'Renvoyer le message',
      // A new sending asked for, "again" after a pronoun, in any order (verification, R5-3).
      'Demander un nouvel envoi des instructions', 'Envoyez-moi de nouveau les instructions', 'Recevoir à nouveau les instructions',
      'Demander l’envoi des instructions', 'Obtenir un autre lien', 'Redemander de nouveaux liens',
    ]) {
      assertBroken(phrase, /^resend\/send button text \(FR\)$/);
    }
  });

  it('Arabic', () => {
    for (const phrase of [
      'إعادة إرسال التعليمات', 'أعِد إرسال التعليمات', 'إرسال التعليمات مرة أخرى', 'إرسال تعليمات الإعداد مرة أخرى', 'إعادة إرسال الرابط',
      'إعادة إرسال رابط الإعداد', 'أرسل الرابط مرة أخرى',
      // A new link asked for, the instructions anew, sending asked for (R5-3).
      'اطلب رابطًا جديدًا', 'إرسال التعليمات من جديد', 'التعليمات مجددًا', 'اطلب إرسال التعليمات', 'أعد إرسال التعليمات',
    ]) {
      assertBroken(phrase, /^resend\/send button text \(AR\)$/);
    }
  });
});

describe('the website and the portal, by their addresses (the owner’s brief of 2026-10-18)', () => {
  it('the company site, the portal and any host under the brand are found, however the brand is spelled', () => {
    for (const phrase of [
      'https://tsxmr.com',
      'tsxmr.com/subscription',
      'https://dukan.tsxmr.com/subscription',
      'Open dukan.tsxmr.com to start',
      'portal.tsxmr.com',
      'www.tsxmr.com/fr/products/dukan-erp',
      'https://tsx-mr.com',
      'tsx.mr',
      'https://dukan-erp.com',
      'EXPO_PUBLIC_PORTAL_URL',
    ]) {
      assertBroken(phrase, /^website address$/);
    }
  });

  it('an address of no website of ours, and the app’s own words, stay allowed', () => {
    for (const phrase of ['owner@example.com', 'The Dukan ERP app', 'Your WhatsApp number', 'api.example.mr']) assertAllowed(phrase);
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
      // Its other sentences nearest to the rules: a retry after a failure, asking for a code again, the trial's length
      // after activation, the instructions sent and the latest not, a new code, a server that may not send messages.
      'Remove the WhatsApp number to continue with your email address, or try again later.', 'Check your email and try again.',
      'Vérifiez vos messages et essayez de nouveau.', 'تحقق من بريدك الإلكتروني وحاول مرة أخرى.', 'Free up space on this phone and try again.',
      'You can ask again in {seconds}s', 'Vous pourrez redemander dans {seconds} s', 'يمكنك الطلب مجدّدًا بعد {seconds} ثانية',
      'Duration after activation: {durationDays} days', 'Durée après activation : {durationDays} jours', 'المدة بعد التفعيل: {durationDays} أيام',
      'The setup instructions were sent to your verified contact on {date}, but the latest ones have not been sent.',
      'Les instructions de configuration ont été envoyées à votre contact vérifié le {date}, mais les plus récentes n’ont pas été envoyées.',
      'أُرسلت تعليمات الإعداد إلى وسيلة الاتصال التي تم التحقق منها في {date}، لكن أحدث التعليمات لم تُرسل.',
      'إرسال رمز جديد', 'the server is not allowed to send messages', 'Last 7 days',
    ]) {
      assertAllowed(phrase);
    }
  });

  it('code is not a sentence: what ships is read whole, and a property’s name beside a sentence is not a word on it', () => {
    // The design gallery's scanner notice, as the bundle compiles it: the property `message`, then a sentence.
    assertAllowed("onScanAgain:()=>{},notice:{tone:'danger',message:'This unit is already sold - it cannot be sold again.'}");
    assertAllowed('{start:e,end:t,days:7}');
    // The same words as a sentence says them are found.
    assertBroken('Message: send it again', /^resend\/send button text \(EN\)$/);
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
