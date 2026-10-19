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

/**
 * Whether the account should ask for the consent: a verified number without an active consent to the copy in force —
 * never agreed, agreed to an earlier copy, replaced, or still pending. A withdrawal is the person's choice: not nagged.
 */
export function consentRequested(view: Pick<WhatsAppConsentView, 'state'> | null | undefined): boolean {
  return view?.state === 'none' || view?.state === 'outdated' || view?.state === 'superseded' || view?.state === 'pending';
}

/** Whether a withdrawal needs the support-recovery acknowledgement before the server will take it. */
export function withdrawalNeedsAcknowledgement(view: Pick<WhatsAppConsentView, 'onlyVerifiedContact'>): boolean {
  return view.onlyVerifiedContact;
}

const STATE: Record<WhatsAppConsentState, TranslationKey> = {
  no_number: 'consent.state.no_number',
  none: 'consent.state.none',
  pending: 'consent.state.pending',
  active: 'consent.state.active',
  outdated: 'consent.state.outdated',
  withdrawn: 'consent.state.withdrawn',
  superseded: 'consent.state.superseded',
};

/** The state in words — never by colour alone. */
export function consentStateKey(state: WhatsAppConsentState): TranslationKey {
  return STATE[state];
}

/** The chip tone that goes with the words. */
export function consentStateTone(state: WhatsAppConsentState): 'success' | 'warning' | 'neutral' {
  if (state === 'active') return 'success';
  if (state === 'none' || state === 'outdated' || state === 'superseded' || state === 'pending') return 'warning';
  return 'neutral';
}

const EVENT: Record<string, TranslationKey> = {
  pending_unverified: 'consent.event.pending_unverified',
  active: 'consent.event.active',
  granted: 'consent.event.active',
  withdrawn: 'consent.event.withdrawn',
  superseded: 'consent.event.superseded',
  expired: 'consent.event.expired',
  opted_out_optional: 'consent.event.opted_out_optional',
};

export function consentEventKey(event: string): TranslationKey {
  return EVENT[event] ?? 'consent.event.active';
}

const SOURCE: Record<string, TranslationKey> = {
  employee_activation: 'consent.source.employee_activation',
  expiry: 'consent.source.expiry',
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
