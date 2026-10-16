'use strict';
/**
 * What the customer app may not say or reach — one list, held against the
 * source and the three catalogues by `lib/access-boundary.test.ts` and against
 * the exported bundles by `scripts/audit-bundle.js`, so the two guards cannot
 * drift apart (docs/21: the App Store boundary of 2026-10-05; the owner's
 * correction of 2026-10-13 — the free trial is display-only in the app; the
 * owner's decision of 2026-10-15 — no price, payment, purchase or activation
 * control for an additional store or a paid staff seat).
 *
 * Each pattern matches a meaning, not one spelling of it:
 * - words are compared after `normalizeWords`: no-break spaces and
 *   non-breaking hyphens read as plain ones, curly apostrophes as straight
 *   ones, Arabic without its diacritics or tatweel and with one alef,
 *   invisible direction marks dropped, and every `{placeholder}` read as the
 *   number it will become;
 * - the trial is named only in its own sentences: in the catalogues, under its
 *   own keys; in the source and in what ships, by those sentences, its keys
 *   and the names the code knows it by — so a new sentence about it, in any
 *   wording, is found wherever it is written;
 * - a claim is any of each language's verbs for starting a trial, and a resend
 *   is recognised by what it sends — the instructions — so "Send the code
 *   again", which the app does say about its own codes, is not one;
 * - a route is compared after `normalizePath` (percent-encoding decoded, `./`
 *   and `../` resolved, duplicate slashes collapsed) and in any letter case,
 *   because a router may not care about either;
 * - markup is read as a browser reads it, in any letter case: by every tag
 *   and attribute that can take a page somewhere else, not by one of them.
 */

/** One spelling for the forms a word takes on screen without changing what it says. */
function normalizeLetters(text) {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[‘’‛ʼ′]/g, "'")
    .replace(/[​-‏‪-‮⁦-⁩؜﻿]/g, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا');
}

/** A sentence as a person reads it once it is filled in: its `{placeholders}` are numbers. */
function normalizeWords(text) {
  return normalizeLetters(text).replace(/\{\w+\}/g, '7');
}

/** A pattern written in ordinary spelling, made to match normalized text. */
const words = (re) => new RegExp(normalizeLetters(re.source), re.flags);

/** A path as a server would route it: decoded, its dot segments resolved and its slashes single. */
function normalizePath(text) {
  let s = text;
  for (let pass = 0; pass < 2 && /%[0-9a-f]{2}/i.test(s); pass++) {
    s = s.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  // Segment by segment, so a whole source file is read in one pass: `.` goes, and `..` takes the named segment before it.
  const kept = [];
  for (const segment of s.replace(/\\/g, '/').replace(/\/{2,}/g, '/').split('/')) {
    const previous = kept[kept.length - 1];
    if (segment === '.') continue;
    if (segment === '..' && previous && previous !== '..') kept.pop();
    else kept.push(segment);
  }
  return kept.join('/');
}

/**
 * The free trial, named (2026-10-13). Only its own keys may name it — the Owner's card, the trial's three state
 * words, its dates — and outside the catalogues only the names the code knows it by: its keys, its read-only route,
 * its query key and its card's test id. Its words: "trial"; "essai" alone, never inside "nécessaire" or "essais"
 * (attempts); the Arabic root without its diacritics.
 */
const TRIAL_KEY = /^(trialSetup\.|access\.state\.trial_|access\.trial\.)/;
const TRIAL_WORDS = words(/\btrial\b|\bessai\b|تجريب|تجرب/i);
const TRIAL_NAME = /^(?:(?:trialSetup|access\.state\.trial_|access\.trial)[\w.]*|\/?account\/trial-setup|trial-setup(?:-card)?)$/;

/**
 * Every one of `parts` inside one sentence, in any order: no full stop between them, each at most `gap` characters
 * from the next. "Have the instructions sent again" and "Send again the instructions" say the same thing.
 */
function inAnyOrder(parts, gap = 60) {
  const orders = (rest) => (rest.length <= 1 ? [rest] : rest.flatMap((part, i) => orders([...rest.slice(0, i), ...rest.slice(i + 1)]).map((order) => [part, ...order])));
  return orders(parts)
    .map((order) => order.map((part) => `(?:${part})`).join(`[^.]{0,${gap}}?`))
    .join('|');
}

/** Where a French word starts and ends: `\b` does not know `à` or `é`. */
const FR_START = String.raw`(?<![\wÀ-ÿ])`;
const FR_END = String.raw`(?![\wÀ-ÿ])`;
/** Where an Arabic word starts: not inside another (`تبدأ` is not `ابدأ`, `إرسال` holds no `رسالة`). */
const AR_START = '(?<![؀-ۿ])';

/**
 * The words a claim and a resend are made of, in each language:
 * - what the setup goes out as — its instructions, its link, its message or e-mail — never a code, which the app
 *   does send again for its own sign-in and team checks;
 * - "again" and its kin — de nouveau, à nouveau, un nouvel envoi, un renvoi, مرة أخرى, من جديد, مجددًا — but not
 *   in "try again", "essayez de nouveau" or "حاول مرة أخرى", which the app says after a failure;
 * - asking for it to be sent (ask, request, demander l'envoi, اطلب الإرسال);
 * - starting, trying or getting, for a time (7 days, une semaine, 7 أيام) or for nothing (free, at no cost, on us,
 *   offerts, sans frais, دون مقابل, مجانًا).
 */
const WORDS = {
  en: {
    object: String.raw`\b(?:instructions?|links?|messages?|e-?mails?)\b`,
    again: String.raw`(?<!\btry(?:\s+\w+)?\s+)\b(?:again|anew|once\s+more|one\s+more\s+time)\b`,
    ask: String.raw`\b(?:ask|request)(?:ing)?\b`,
    get: String.raw`\b(?:ask|request|get|receive|need|want)\b`,
    fresh: String.raw`\b(?:new|another|fresh)\b`,
    send: String.raw`\b(?:re-?)?(?:send|sent|sending)\b|\bdeliver(?:y|ed|ing)?\b`,
    claim: String.raw`\b(?:try|start|begin|activate|enjoy|unlock|claim|redeem|test|use|get)\b`,
    span: String.raw`\b(?:\d+|one|two|three|seven|fourteen|thirty)\s*-?\s*(?:days?|weeks?|months?)\b|\ba\s+(?:week|month)\b`,
    free: String.raw`\bfree\b(?!\s+up\b)|\bat\s+no\s+cost\b|\bno\s+charge\b|\bon\s+us\b`,
  },
  fr: {
    object: `${FR_START}(?:instructions|liens?|messages?|e-?mails?|courriels?)${FR_END}`,
    again: String.raw`(?<!essa\w*\s+)${FR_START}(?:de|à)\s+nouveau${FR_END}|${FR_START}(?:nouvel\s+envoi|renvois?|une\s+nouvelle\s+fois|encore\s+une\s+fois)${FR_END}`,
    ask: `${FR_START}(?:demander|demandez|demande|redemander|redemandez|solliciter|sollicitez)${FR_END}`,
    get: `${FR_START}(?:demander|demandez|redemander|redemandez|recevoir|recevez|obtenir|obtenez|avoir)${FR_END}`,
    fresh: `${FR_START}(?:nouveaux?|nouvel|nouvelles?|autres?)${FR_END}`,
    send: `${FR_START}(?:r?envoi|r?envoyer|r?envoyez|r?envoyée?s?|réexpédier|réexpédiez)${FR_END}`,
    claim: `${FR_START}(?:essayer|essayez|essaie|essaye|profiter|profitez|profite|activer|activez|commencer|commencez|démarrer|démarrez|obtenir|obtenez|tester|testez|débuter|débutez|réclamer|réclamez|utiliser|utilisez|bénéficiez|bénéficie)${FR_END}`,
    span: String.raw`${FR_START}(?:\d+|sept|une?|deux|trois|quatorze|trente)\s*(?:jours?|semaines?|mois)${FR_END}`,
    free: String.raw`${FR_START}(?:gratuit\w*|offerte?s?|sans\s+frais|à\s+titre\s+gracieux)${FR_END}`,
  },
  ar: {
    object: `${AR_START}[وفبل]{0,2}(?:ال)?(?:تعليمات|رابط|روابط|رسالة|رسائل|بريد)`,
    again: String.raw`(?<!حاول\S*\s+)(?:مرة أخرى|مرة ثانية|من جديد|مجدد)`,
    ask: `${AR_START}[وف]?(?:اطلب|اطلبي|اطلبوا|طلب)`,
    get: `${AR_START}[وف]?(?:اطلب|اطلبي|اطلبوا|طلب|احصل|احصلي)`,
    fresh: '(?:جديد|أخرى|آخر)',
    send: `${AR_START}[وفب]?(?:إرسال|أرسل|ترسل|يرسل)`,
    claim: `${AR_START}[وف]?(?:جرّب|جرّبي|جرّبوا|احصل|احصلي|احصلوا|ابدأ|ابدئي|ابدؤوا|فعّل|فعّلي|استفد|استفيدي|استمتع|استمتعي|استخدم|استخدمي)`,
    span: String.raw`\d+\s*(?:أيام|يومًا|يوم|أسبوع|أسابيع|شهر|أشهر)|${AR_START}(?:سبعة|سبع)\s+أيام|${AR_START}أسبوع`,
    free: String.raw`مجان|(?:دون|بدون|بلا)\s+(?:أي\s+)?(?:مقابل|تكلفة|رسوم)`,
  },
};
/**
 * A word as a sentence says it, not as code names it: what ships is read whole, code and all, and a property's name
 * (`message:'…'`, `link=`, `start(`) is not a word on a screen. A sentence puts a space after its colon.
 */
const said = (pattern) => String.raw`(?:${pattern})(?![:=][^\s=]|\()`;
/**
 * A claim for a time or for nothing; a resend by its "again", by asking for it to be sent, or by asking for a new
 * one — each in one sentence, in any order.
 */
const claimFor = (w) => inAnyOrder([said(w.claim), `${w.span}|${w.free}`], 40);
const resendOf = (w) =>
  [inAnyOrder([said(w.object), said(w.again)]), inAnyOrder([said(w.ask), said(w.send), said(w.object)]), inAnyOrder([said(w.get), said(w.fresh), said(w.object)])].join('|');

/**
 * What starting or re-sending the trial would say. None of it may exist anywhere in the app.
 *
 * A claim is a verb for starting, trying or getting, with the trial within five words of it — "Start (using your
 * free) trial", "Commencer (maintenant mon) essai", "ابدأ (الآن فترتك) التجريبية" — or starting, trying or getting
 * for a time or for free, the trial named or not: "Try Dukan ERP for 7 days", "Start now — 7 days free", "Profitez de
 * 7 jours offerts", "Essayez Dukan ERP pendant 7 jours", "جرّب مجانًا", "احصل على 7 أيام دون مقابل". A resend is what
 * the setup goes out as, said again or asked for, in any order inside one sentence: "Resend the setup link", "Have
 * the instructions sent again", "Ask for the setup instructions again", "Demander un nouvel envoi des instructions",
 * "Envoyez-moi de nouveau les instructions", "إعادة إرسال الرابط". Never a code, which the app does send again for its
 * own sign-in and team checks. `(?:\s+[^\s.]+){0,5}?` reads "up to five words, inside one sentence".
 */
const TRIAL_ACTIONS = [
  [
    'claim button text (EN)',
    words(
      new RegExp(
        String.raw`\b(?:start|begin|activate|claim|try|get|unlock|launch|redeem)\b(?:\s+[^\s.]+){0,5}?\s+trial\b|\b(?:start|begin|activate|claim|try|get|unlock|launch|redeem|enable|join|sign\s+up)\b[^.]{0,25}\bfree\b|` + claimFor(WORDS.en),
        'i',
      ),
    ),
  ],
  [
    'claim button text (FR)',
    words(
      new RegExp(
        String.raw`\b(?:commencer|commencez|commence|démarrer|démarrez|démarre|lancer|lancez|lance|activer|activez|active|réclamer|réclamez|réclame|essayer|essayez|essaie|obtenir|obtenez|obtiens|profiter|profitez|profite|débuter|débutez|débute)\b(?:\s+[^\s.]+){0,5}?\s+(?:[^\s.']*')?essai\b|\b(?:commencer|commencez|commence|démarrer|démarrez|démarre|essayer|essayez|essaie|profiter|profitez|profite)\b[^.]{0,25}\bgratuit|` + claimFor(WORDS.fr),
        'i',
      ),
    ),
  ],
  [
    'claim button text (AR)',
    words(
      new RegExp(
        String.raw`(?<![؀-ۿ])(?:ابدأ|ابدئي|ابدؤوا|فعّل|فعّلي|اطلب|اطلبي|احصل|احصلي|جرّب|جرّبي|جرّبوا)\s[^.،]{0,25}(?:تجرب|تجريب)|(?<![؀-ۿ])(?:جرّب|جرّبي|جرّبوا|ابدأ|ابدئي|ابدؤوا|فعّل|فعّلي|احصل|احصلي)\s[^.،]{0,25}مجان|(?<![؀-ۿ])(?:استفد|استفيدي|استفيدوا)\s+من\s[^.،]{0,25}(?:تجرب|تجريب|مجان)|` + claimFor(WORDS.ar),
      ),
    ),
  ],
  [
    'resend/send button text (EN)',
    words(
      new RegExp(
        String.raw`\bre-?send\b[^.]{0,30}\b(?:instructions?|link|message|e-?mail)\b|\bsend\b[^.]{0,40}\b(?:instructions?|link|message|e-?mail)\b[^.]{0,30}\bagain\b|\bsend\s+(?:it\s+|them\s+)?again\b[^.]{0,30}\b(?:instructions?|link|message|e-?mail)\b|\bsend\b(?:\s+(?:me|us))?(?:\s+(?:the|my|your|a|an))?(?:\s+(?:new|setup))*\s+(?:instructions?|link)\b|\b(?:request|get|receive)\b(?:\s+(?:me|us))?(?:\s+(?:the|a|an|my|your))?\s+(?:new|another)\s+(?:setup\s+)?(?:instructions?|link|message|e-?mail)\b|\b(?:request|get|receive)\b[^.]{0,30}\b(?:instructions?|link)\b[^.]{0,20}\bagain\b|` + resendOf(WORDS.en),
        'i',
      ),
    ),
  ],
  [
    'resend/send button text (FR)',
    words(
      new RegExp(
        String.raw`\b(?:renvoyer|renvoyez|renvoie|réenvoyer|réenvoyez)\b[^.]{0,30}\b(?:instructions|lien|message|e-?mail|courriel)\b|\b(?:envoyer|envoyez|recevoir|recevez|redemander|redemandez|obtenir|obtenez)\s+(?:à|de)\s+nouveau\b[^.]{0,30}\b(?:instructions|lien|message|e-?mail|courriel)\b|\b(?:instructions|lien|message|e-?mail|courriel)\b[^.]{0,30}\s(?:à|de)\s+nouveau\b|\benvoy(?:er|ez)(?:-moi|-nous)?\s+(?:les\s+|des\s+|mes\s+|vos\s+|le\s+|un\s+|mon\s+|votre\s+)?(?:nouveaux?\s+|nouvel\s+|nouvelles?\s+)?(?:instructions|lien)\b|\b(?:recevoir|recevez|redemander|redemandez|demander|demandez|obtenir|obtenez)\s+(?:un\s+|une\s+|de\s+|des\s+|les\s+|le\s+)?(?:nouveaux?|nouvel|nouvelles?)\s+(?:instructions|lien|message)\b|` + resendOf(WORDS.fr),
        'i',
      ),
    ),
  ],
  [
    'resend/send button text (AR)',
    words(
      new RegExp(
        '(?:إعادة|أعد|أعيدي)\\s+(?:ال)?إرسال\\s+(?:ال)?(?:تعليمات|رابط|رسالة|بريد)|(?:إرسال|أرسل|أرسلي|أرسلوا)\\s+(?:لي\\s+)?(?:ال)?(?:تعليمات|رابط|رسالة)[^.]{0,30}(?:مرة أخرى|مجدد|من جديد)|(?:مرة أخرى|مجدد|من جديد)[^.]{0,20}(?:ال)?(?:تعليمات|رابط)|(?:أرسل|أرسلي|أرسلوا)\\s+(?:لي\\s+)?(?:ال)?رابط|' + resendOf(WORDS.ar),
      ),
    ),
  ],
];

/**
 * The routes the app never asks: the trial's claim and link check, sending its
 * instructions again, the Owner's store, seat and activity requests, a price or
 * a payment instruction, and the platform's own routes.
 */
const ROUTES = [
  ['claim route', /trial\/claim|trial\/link|my-subscription/i],
  ['resend route', /trial\/setup\/resend|trial-setup\/resend|setup\/resend/i],
  ['store or seat request route', /seat-requests|store-requests|activity-requests|activity-options/i],
  ['price or payment route', /payment-instructions|platform\/quote/i],
  ['platform route', /\/platform\//i],
];

/**
 * The one-time setup link's marks: its token after `#t=` or `?t=` — or at the start of a string that becomes a
 * fragment or a query (`u.hash = 't=' + token`) — and the website page it opens.
 */
const TOKEN_MARKER = /[#?&]t=|^t=|account\/trial(?!-setup)/i;

/**
 * Markup written to leave the page, or to show another page inside it — wherever the app could write it
 * (`innerHTML`, `document.write`, the report's own page): a refresh to another address (`<meta
 * http-equiv="refresh" content="0;url=…">`, or its content alone); a link (`<a href>`, `<area href>`); a page shown
 * inside it, or a form that sends it away (`<iframe>`, `<frame>`, `<object>`, `<embed>`, `<portal>`, `<form>`); a
 * `<base>` that moves every address the page holds; and a script the markup runs by itself (`<body onload=…>`,
 * `<img onerror=…>`), which can submit a form or move the page. The report's and the receipt's pages write none of it.
 */
const WRITTEN_WAY_OUT =
  /http-equiv\s*=\s*["']?\s*refresh|^\s*\d+\s*;\s*url\s*=|content\s*=\s*["']\s*\d+\s*;\s*url\s*=|<(?:a|area)\s[^>]*\bhref\s*=|<(?:iframe|frame|frameset|object|embed|portal|form|base)\b|<[a-z][^>]*\son[a-z]+\s*=/i;

/** The website, by its address or by a configured origin for it. */
const WEBSITE_ADDRESS = /tsx[-.]mr\.(?:com|mr|net|org|app)\b|\btsx\.mr\b|dukan[\w-]*\.(?:com|mr|net|org|app)\b|PUBLIC_SITE_ORIGIN|EXPO_PUBLIC_(?:SITE|PORTAL|SIGNUP|WEBSITE)_URL/i;

/**
 * A price for the app's own access, by what it is a price of — per month, per
 * seat, per store, a seat's or a subscription's cost, an amount in ouguiya —
 * rather than by amount: the shop's own amounts ("30 000 MRU") are the shop's.
 */
const ACCESS_PRICE = words(
  /\bper\s+(?:additional\s+|extra\s+)?(?:employee\s+|staff\s+)?(?:month|year|seat|store|place)s?\b|\b(?:additional|extra)\s+(?:employee\s+|staff\s+)?(?:seat|store|place)s?\s*[:=]\s*\d|\b(?:place|siège|magasin)s?\s+supplémentaires?\s*[:=]\s*\d|\/\s?(?:month|mois|year|an)\b|\bpar\s+(?:mois|an|place|siège|magasin)\b|\b(?:seat|store|access|subscription|plan)\s+(?:price|cost|fee|rate)s?\b|\b(?:prix|tarif|coût)\s+(?:d'une\s+|de\s+la\s+|du\s+|de\s+l'|par\s+)?(?:place|siège|magasin|boutique|abonnement|accès)\b|شهريًا|في الشهر|لكل (?:مقعد|متجر)|مقعد (?:موظف )?إضافي|(?:سعر|تكلفة|رسوم)\s+(?:ال)?(?:مقعد|متجر|اشتراك)|\d\s?أوقية|\d\s?ouguiyas?\b/i,
);

/** Asking to be paid: our payment instructions, in any of the three languages. */
const PAYMENT_INSTRUCTION = words(
  /payment instructions|instructions de paiement|تعليمات الدفع|\bpay now\b|payer maintenant|ادفع الآن|no payment is required|aucun paiement n'est demandé|لا يلزم أي دفع/i,
);

module.exports = { normalizeLetters, normalizeWords, normalizePath, words, TRIAL_KEY, TRIAL_WORDS, TRIAL_NAME, TRIAL_ACTIONS, ROUTES, TOKEN_MARKER, WRITTEN_WAY_OUT, WEBSITE_ADDRESS, ACCESS_PRICE, PAYMENT_INSTRUCTION };
