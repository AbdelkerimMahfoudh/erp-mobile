/**
 * When the app may talk about push (D225) — pure, for tests.
 *
 *   node lib/push-policy.test.ts
 *
 * The owner's rule: never at a cold launch, never twice. The app's own explanation is offered once, right after the
 * person signs in, and only while iOS has not been asked yet. "Not now" is remembered on this phone and the app does
 * not bring it up again by itself; the person can turn notifications on later from Notifications → This phone. After
 * iOS refused, iOS will not ask again: the app says where in Settings to turn it on and offers to open the app's page
 * there — never its own prompt.
 */

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export interface PushOfferInput {
  permission: PushPermission;
  /** Signed in a moment ago on this phone — not a session restored at launch. */
  justSignedIn: boolean;
  /** "Not now" was chosen on this phone before. */
  declined: boolean;
}

/** Whether to show the app's explanation now. */
export function shouldOfferPush({ permission, justSignedIn, declined }: PushOfferInput): boolean {
  return justSignedIn && permission === 'undetermined' && !declined;
}

/** What "This phone" in the notification settings shows: on, can be asked, or only from iOS Settings. */
export type PhoneState = 'on' | 'ask' | 'settings' | 'unsupported';

export function phoneState(permission: PushPermission): PhoneState {
  if (permission === 'granted') return 'on';
  if (permission === 'undetermined') return 'ask';
  if (permission === 'denied') return 'settings';
  return 'unsupported';
}

/** The locales the server words a push in; anything else reads in English. */
export function pushLocale(language: string): 'en' | 'fr' | 'ar' {
  return language === 'fr' || language === 'ar' ? language : 'en';
}

/**
 * Whether this phone must (re)register: a new token, another person, or another language. The server's registration
 * is idempotent, so registering again is harmless — this only spares a request on every launch.
 */
export function registrationNeeded(stored: { token: string; userId: string; locale: string } | null, now: { token: string; userId: string; locale: string }): boolean {
  return !stored || stored.token !== now.token || stored.userId !== now.userId || stored.locale !== now.locale;
}
