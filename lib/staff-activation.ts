/**
 * An employee finishing the account their business Owner created (docs/69 §3; D213 in docs/21).
 *
 * The person proves the WhatsApp number or email address the Owner gave and chooses a password, on the app's own
 * public routes (`staff/verify/resend`, `staff/verify/confirm`). A WhatsApp number's code goes only after the person
 * ticks the operational WhatsApp consent on their own phone: the agreement is theirs, never the Owner's, and its
 * version and the language it was shown in travel with the request. An email address needs no WhatsApp consent.
 *
 * The rules, with no React and no network, so they can be tested directly.
 */

export type StaffContact = { channel: 'phone' | 'email'; value: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Digits, optionally an international +. The server normalises properly. */
const PHONE = /^\+?[\d\s-]{6,24}$/;

/** What the person typed, read as the contact it is — or null for anything else. */
export function contactOf(raw: string): StaffContact | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes('@')) return EMAIL.test(value) ? { channel: 'email', value } : null;
  return PHONE.test(value) ? { channel: 'phone', value } : null;
}

/** Whether this contact needs the WhatsApp consent before its code: a number does, an email address does not. */
export function needsConsent(contact: StaffContact | null): boolean {
  return contact?.channel === 'phone';
}

/** `POST staff/verify/resend`: the consent's fields only for a number, and only when ticked (`consentFields`). */
export function codeRequestBody(contact: StaffContact, language: string, consent: Record<string, string>): Record<string, string> {
  return { destination: contact.value, language, ...(contact.channel === 'phone' ? consent : {}) };
}

/** `POST staff/verify/confirm`: the password only when given — the server asks for it the first time. */
export function confirmBody(contact: StaffContact, code: string, password: string): Record<string, string> {
  const body: Record<string, string> = { destination: contact.value, code: code.trim() };
  if (password) body.password = password;
  return body;
}
