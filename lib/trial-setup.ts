import type { EntitlementState } from './entitlement';
import type { TranslationKey } from './i18n/keys';

/**
 * What the closed screen may say about the free trial's setup instructions
 * (0095; the owner's correction of 2026-10-13).
 *
 * A business that created its own account is eligible for one 7-day free
 * trial, started by its Owner on the Dukan ERP website and nowhere else. The
 * instructions for that go out automatically, once the Owner's contacts are
 * verified, to those verified contacts only. The app's part is to SAY what the
 * server knows — eligible, not started, how long it lasts once claimed, where
 * the instructions went (masked by the server), whether they were sent — and
 * nothing more: no claim, no resend, no link, no countdown. These are the
 * decisions behind those words, with no React and no network, so a plain node
 * test reads them.
 *
 * Type-only imports, so a plain `node` test can load this file.
 */

/** A contact the Owner proves: the address, or the WhatsApp number. */
export type TrialContact = 'email' | 'phone';
/** Where the instructions can go. */
export type TrialChannel = 'email' | 'whatsapp';
/**
 * The last word on the instructions: waiting for a required contact to be
 * verified (nothing is sent before), never attempted, sent, refused by every
 * provider, or nothing able to send them at all.
 */
export type TrialDelivery = 'waiting_for_contact' | 'not_sent' | 'sent' | 'failed' | 'unavailable';

/** A verified contact as the server masks it (`a•••@example.com`, `+222••••1234`) — never the raw value. */
export interface TrialDestination {
  channel: TrialChannel;
  masked: string;
}

/** What `GET account/trial-setup` answers the Owner; for anything but an eligible business, only the state. */
export type TrialSetupStatus =
  | { state: EntitlementState; eligible: false }
  | {
      state: 'trial_available';
      eligible: true;
      durationHours: number;
      durationDays: number;
      requiredContacts: TrialContact[];
      missingContacts: TrialContact[];
      destinations: TrialDestination[];
      delivery: TrialDelivery;
      sentTo: TrialChannel[];
      lastAttemptAt: string | null;
      timeZone: string;
    };

export type EligibleTrialSetup = Extract<TrialSetupStatus, { eligible: true }>;

/** The server's refusal of anybody but the Owner (403 `owner_only`): staff are told the neutral words, nothing else. */
export function refusedToStaff(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 403;
}

/**
 * How the closed screen answers a business that has not started: the Owner's
 * card for an eligible answer; the neutral words for anybody the server
 * refused or no longer calls eligible; a wait while it is asked; and, when it
 * could not be asked at all, that failure, honestly — never a guess at who is
 * holding the phone.
 */
export type NotStartedView = 'card' | 'neutral' | 'loading' | 'unreadable';

export function notStartedView(query: { data?: TrialSetupStatus; error: unknown; isLoading: boolean }): NotStartedView {
  if (query.data?.eligible) return 'card';
  if (query.data || refusedToStaff(query.error)) return 'neutral';
  if (query.error && !query.isLoading) return 'unreadable';
  return 'loading';
}

const WAITING: Record<TrialContact, TranslationKey> = {
  phone: 'trialSetup.delivery.waiting.phone',
  email: 'trialSetup.delivery.waiting.email',
};

/**
 * The card's delivery line — one, or one per contact still to be verified
 * while it waits for them. Every line is a statement; none offers an action,
 * because there is nothing to do here: sending again is the website's, after
 * the Owner signs in, or support's. A word this build does not know says
 * nothing rather than something untrue.
 */
export function deliveryLines(status: Pick<EligibleTrialSetup, 'delivery' | 'missingContacts'>): TranslationKey[] {
  switch (status.delivery) {
    case 'waiting_for_contact':
      return status.missingContacts.map((contact) => WAITING[contact]).filter(Boolean);
    case 'sent':
      return ['trialSetup.delivery.sent'];
    case 'unavailable':
      return ['trialSetup.delivery.unavailable'];
    case 'failed':
      return ['trialSetup.delivery.failed'];
    case 'not_sent':
      return ['trialSetup.delivery.not_sent'];
    default:
      return [];
  }
}

/** Sent is good news; waiting is information; anything that will not arrive asks for support. */
export function deliveryTone(delivery: TrialDelivery): 'success' | 'info' | 'warning' {
  if (delivery === 'sent') return 'success';
  if (delivery === 'waiting_for_contact') return 'info';
  return 'warning';
}
