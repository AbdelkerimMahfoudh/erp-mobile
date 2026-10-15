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
 * - a claim is any of each language's verbs for starting a trial, and a resend
 *   is recognised by what it sends — the instructions — so "Send the code
 *   again", which the app does say about its own codes, is not one;
 * - a route is compared after `normalizePath` (percent-encoding decoded, `./`
 *   and `../` resolved, duplicate slashes collapsed) and in any letter case,
 *   because a router may not care about either.
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
  s = s.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  for (let before = ''; before !== s; ) {
    before = s;
    s = s.replace(/(^|\/)\.(?:\/|$)/g, '$1').replace(/[^/.][^/]*\/\.\.(?:\/|$)/g, '');
  }
  return s;
}

/** What starting or re-sending the trial would say. None of it may exist anywhere in the app. */
const TRIAL_ACTIONS = [
  ['claim button text (EN)', words(/\b(?:start|begin|activate|claim|try|get|unlock|launch|redeem)\s+(?:(?:my|your|the|a|an|this|now)\s+)?(?:(?:\d+-day|seven-day|free)\s+){0,2}trial\b/i)],
  [
    'claim button text (FR)',
    words(/\b(?:commencer|commencez|démarrer|démarrez|lancer|lancez|activer|activez|réclamer|réclamez|essayer|essayez|obtenir|obtenez|profiter|profitez|débuter|débutez)\s+(?:de\s+|du\s+)?(?:(?:mon|votre|l'|un|cet|ce|ma|sa|la)\s*)?(?:période\s+d'\s*)?essai\b/i),
  ],
  ['claim button text (AR)', words(/(?<![؀-ۿ])(?:ابدأ|ابدئي|ابدؤوا|فعّل|فعّلي|اطلب|اطلبي|احصل|جرّب|جرّبي)\s[^.،]{0,25}(?:تجرب|تجريب)/)],
  [
    'resend/send button text (EN)',
    words(/\bre-?send\b[^.]{0,30}\binstructions?\b|\bsend\b[^.]{0,40}\binstructions?\b[^.]{0,30}\bagain\b|\bsend\b(?:\s+(?:me|us))?(?:\s+(?:the|my|your))?(?:\s+setup)?\s+instructions?\b/i),
  ],
  [
    'resend/send button text (FR)',
    words(/\b(?:renvoyer|renvoyez|réenvoyer|réenvoyez)\b[^.]{0,30}\binstructions\b|\benvoy(?:er|ez)\s+(?:à|de)\s+nouveau\b[^.]{0,30}\binstructions\b|\binstructions\b[^.]{0,30}\s(?:à|de)\s+nouveau\b|\benvoy(?:er|ez)\s+(?:les\s+|des\s+|mes\s+|vos\s+)?instructions\b/i),
  ],
  [
    'resend/send button text (AR)',
    words(/(?:إعادة|أعد)\s+(?:ال)?إرسال\s+(?:ال)?تعليمات|(?:إرسال|أرسل|أرسلوا)\s+(?:ال)?تعليمات[^.]{0,30}(?:مرة أخرى|مجدد|من جديد)|(?:مرة أخرى|مجدد|من جديد)[^.]{0,20}(?:ال)?تعليمات/),
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

/** The one-time setup link's marks: its token after `#t=` or `?t=`, and the website page it opens. */
const TOKEN_MARKER = /[#?&]t=|account\/trial(?!-setup)/i;

/** The website, by its address or by a configured origin for it. */
const WEBSITE_ADDRESS = /tsx[-.]mr\.(?:com|mr|net|org|app)\b|\btsx\.mr\b|dukan[\w-]*\.(?:com|mr|net|org|app)\b|PUBLIC_SITE_ORIGIN|EXPO_PUBLIC_(?:SITE|PORTAL|SIGNUP|WEBSITE)_URL/i;

/**
 * A price for the app's own access, by what it is a price of — per month, per
 * seat, per store, a seat's or a subscription's cost, an amount in ouguiya —
 * rather than by amount: the shop's own amounts ("30 000 MRU") are the shop's.
 */
const ACCESS_PRICE = words(
  /\bper\s+(?:additional\s+|extra\s+)?(?:employee\s+|staff\s+)?(?:month|year|seat|store|place)s?\b|\/\s?(?:month|mois|year|an)\b|\bpar\s+(?:mois|an|place|siège|magasin)\b|\b(?:seat|store|access|subscription|plan)\s+(?:price|cost|fee|rate)s?\b|\b(?:prix|tarif|coût)\s+(?:d'une\s+|de\s+la\s+|du\s+|de\s+l'|par\s+)?(?:place|siège|magasin|boutique|abonnement|accès)\b|شهريًا|في الشهر|لكل (?:مقعد|متجر)|مقعد (?:موظف )?إضافي|(?:سعر|تكلفة|رسوم)\s+(?:ال)?(?:مقعد|متجر|اشتراك)|\d\s?أوقية|\d\s?ouguiyas?\b/i,
);

/** Asking to be paid: our payment instructions, in any of the three languages. */
const PAYMENT_INSTRUCTION = words(
  /payment instructions|instructions de paiement|تعليمات الدفع|\bpay now\b|payer maintenant|ادفع الآن|no payment is required|aucun paiement n'est demandé|لا يلزم أي دفع/i,
);

module.exports = { normalizeLetters, normalizeWords, normalizePath, words, TRIAL_ACTIONS, ROUTES, TOKEN_MARKER, WEBSITE_ADDRESS, ACCESS_PRICE, PAYMENT_INSTRUCTION };
