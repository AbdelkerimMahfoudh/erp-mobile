/**
 * An employee activating the account their business Owner created (docs/69 §3; D213, D214 in docs/21).
 *
 * Creating the account sent the person nothing. The Owner gave them an invitation reference; they type it (or open the
 * app's link, which only fills it in), type their own WhatsApp number, tick the operational WhatsApp consent and ask for
 * the code themselves — on the public routes `staff/join/open`, `staff/join/request-code` and `staff/join/confirm`.
 * The agreement is theirs, never the Owner's; its version and the language it was shown in travel with the request.
 *
 * The rules, with no React and no network, so they can be tested directly.
 */

/** Crockford's base32: the reference's twelve characters never include I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REFERENCE_LENGTH = 12;

/**
 * What the person typed, as the reference the server knows — `K7QM-9XRT-2CHD` — or null when it cannot be one.
 * Spaces, dashes and case do not matter, and O is read as 0, I and L as 1, exactly as the server reads them.
 */
export function referenceOf(typed: string | null | undefined): string | null {
  if (typeof typed !== 'string' || typed.length > 40) return null;
  const folded = typed
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (folded.length !== REFERENCE_LENGTH || [...folded].some((c) => !ALPHABET.includes(c))) return null;
  return `${folded.slice(0, 4)}-${folded.slice(4, 8)}-${folded.slice(8)}`;
}

/** A WhatsApp number in international form, punctuation dropped and a leading 00 read as + — or null. */
export function numberOf(typed: string | null | undefined): string | null {
  const cleaned = (typed ?? '').trim().replace(/[\s\-().]/g, '');
  const e164 = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** `POST staff/join/open`. */
export function openBody(reference: string): Record<string, string> {
  return { reference };
}

/** `POST staff/join/request-code`: the typed number and the consent's fields (`consentFields`, empty unless ticked). */
export function codeRequestBody(reference: string, number: string, language: string, consent: Record<string, string>): Record<string, string> {
  return { reference, number, language, ...consent };
}

/** `POST staff/join/confirm`: the password only when given — the server asks for it the first time. */
export function confirmBody(reference: string, code: string, password: string): Record<string, string> {
  const body: Record<string, string> = { reference, code: code.trim() };
  if (password) body.password = password;
  return body;
}
