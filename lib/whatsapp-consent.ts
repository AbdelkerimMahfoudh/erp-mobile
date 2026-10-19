/**
 * The operational WhatsApp consent, as the app shows it (the owner's brief of 2026-10-19; D213 in docs/21).
 *
 * The server owns all of it: the copy and its version (`GET messaging/whatsapp/consent`), where a person's consent
 * stands, and whether a message may go. This module only turns the server's answers into what a screen says, and
 * builds the bodies that carry an agreement back — so a test can hold the rules without rendering anything.
 *
 * Nothing here is ever inferred: a number typed or verified is not a consent, and an unticked box sends nothing.
 */
import type { TranslationKey } from './i18n';
import type { WhatsAppConsentCopy, WhatsAppConsentState, WhatsAppConsentView } from '../types/api';

/** The fields a registration or a new number carries when, and only when, the box was ticked. */
export function consentFields(copy: WhatsAppConsentCopy | null | undefined, ticked: boolean): Record<string, string> {
  if (!ticked || !copy) return {};
  return { whatsappConsentVersion: copy.version, whatsappConsentLocale: copy.language };
}

/** Whether the account should ask for the consent: a verified number without the copy in force agreed to. */
export function consentRequested(view: Pick<WhatsAppConsentView, 'state'> | null | undefined): boolean {
  return view?.state === 'none' || view?.state === 'outdated';
}

/** Whether a withdrawal needs the support-recovery acknowledgement before the server will take it. */
export function withdrawalNeedsAcknowledgement(view: Pick<WhatsAppConsentView, 'onlyVerifiedContact'>): boolean {
  return view.onlyVerifiedContact;
}

const STATE: Record<WhatsAppConsentState, TranslationKey> = {
  no_number: 'consent.state.no_number',
  none: 'consent.state.none',
  granted: 'consent.state.granted',
  outdated: 'consent.state.outdated',
  withdrawn: 'consent.state.withdrawn',
};

/** The state in words — never by colour alone. */
export function consentStateKey(state: WhatsAppConsentState): TranslationKey {
  return STATE[state];
}

/** The chip tone that goes with the words. */
export function consentStateTone(state: WhatsAppConsentState): 'success' | 'warning' | 'neutral' {
  if (state === 'granted') return 'success';
  if (state === 'none' || state === 'outdated') return 'warning';
  return 'neutral';
}

const EVENT: Record<string, TranslationKey> = {
  granted: 'consent.event.granted',
  withdrawn: 'consent.event.withdrawn',
  opted_out_optional: 'consent.event.opted_out_optional',
};

export function consentEventKey(event: string): TranslationKey {
  return EVENT[event] ?? 'consent.event.granted';
}

const SOURCE: Record<string, TranslationKey> = {
  mobile_registration: 'consent.source.registration',
  website_registration: 'consent.source.registration',
  owner_registration: 'consent.source.registration',
  number_changed: 'consent.source.number_changed',
  inbound_keyword: 'consent.source.inbound_keyword',
};

/** Where an event was made; anything made from an account reads as such. */
export function consentSourceKey(source: string): TranslationKey {
  return SOURCE[source] ?? 'consent.source.account';
}

/** The words for a refusal of a consent body by the server, when there is one of ours. */
export function consentProblemKey(code: string | undefined): TranslationKey | null {
  if (code === 'whatsapp_consent_required') return 'consent.problem.required';
  if (code === 'whatsapp_consent_outdated') return 'consent.problem.outdated';
  if (code === 'withdrawal_needs_acknowledgement') return 'consent.withdraw.needsAck';
  return null;
}
