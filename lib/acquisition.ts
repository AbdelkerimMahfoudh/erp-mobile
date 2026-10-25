/**
 * Where a new business came from, if anywhere (0103, D221) — the rules, with no React and no network.
 *
 * A registration may carry one source at most: a promoter's six-digit promo code, typed; or the registration address
 * the person arrived with (`https://dukan.tsxmr.com/join?r=…`) — a promoter's QR card or another business's
 * invitation. The server checks it again when the business is created, and refuses the registration, saving nothing,
 * if it stopped being usable. It is where the person heard of Dukan ERP, and nothing more.
 */

export const PROMO_CODE_LENGTH = 6;

/** Arabic-Indic (U+0660–0669) and Eastern Arabic-Indic (U+06F0–06F9) digits as ASCII; everything else dropped. */
export function digitsOf(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) & 0x0f)).replace(/[^0-9]/g, '');
}

/**
 * The code after an edit at box `index`: what was typed or pasted there — one digit or a whole code, in any of the
 * three numeral systems — replaces the digits from that box on. Never more than six digits.
 */
export function typedInto(current: string, index: number, typed: string): string {
  const incoming = digitsOf(typed);
  if (!incoming) return current;
  return (current.slice(0, Math.min(index, current.length)) + incoming).slice(0, PROMO_CODE_LENGTH);
}

/** Backspace in box `index`: the digit there goes, or the one before it when the box is empty. Returns [code, focus]. */
export function backspaceAt(current: string, index: number): [string, number] {
  const at = index < current.length ? index : Math.max(0, index - 1);
  return [current.slice(0, at), at];
}

/** What the server says about a code or an address, before registering. */
export type AcquisitionLookup =
  | { usable: false }
  | { usable: true; source: 'promoter'; promoterName: string; code: string }
  | { usable: true; source: 'user_invite' };

/** The one source a registration carries, as its body names it. */
export type AcquisitionClaim = { promoCode: string } | { referralToken: string } | null;

/** Where the form's source stands. */
export interface AcquisitionState {
  /** The address the person arrived with — memory only, never the URL or storage. Null once removed or unusable. */
  token: string | null;
  /** What that address turned out to be, once asked. */
  link: AcquisitionLookup | null;
  /** The six boxes. */
  code: string;
  /** The code a QR card prefilled: the QR's own source while the boxes still hold it. */
  prefilled: string | null;
  lookup: { kind: 'idle' } | { kind: 'checking' } | { kind: 'usable'; name: string } | { kind: 'unavailable' } | { kind: 'limited'; message: string };
}

export const noAcquisition: AcquisitionState = { token: null, link: null, code: '', prefilled: null, lookup: { kind: 'idle' } };

export function isInvitation(s: AcquisitionState): boolean {
  return s.token !== null && s.link?.usable === true && s.link.source === 'user_invite';
}

export function isQr(s: AcquisitionState): boolean {
  return s.token !== null && s.prefilled !== null && s.code === s.prefilled;
}

/** A typed code the server said is usable (not the QR's own). */
export function typedUsable(s: AcquisitionState): boolean {
  return s.lookup.kind === 'usable' && !isQr(s);
}

/** An invitation and a usable typed code at once: the registrant must choose — the form waits until they do. */
export function mustChoose(s: AcquisitionState): boolean {
  return isInvitation(s) && typedUsable(s);
}

/** Whether the form must wait before sending: a check still running, or a choice still to make. */
export function acquisitionPending(s: AcquisitionState): boolean {
  return s.lookup.kind === 'checking' || (s.token !== null && s.link === null) || mustChoose(s);
}

/** The one source this registration carries, or none. A code that is incomplete, unavailable or unchecked carries nothing. */
export function claimOf(s: AcquisitionState): AcquisitionClaim {
  if (mustChoose(s)) return null;
  if (isQr(s) || (isInvitation(s) && !typedUsable(s))) return { referralToken: s.token! };
  if (typedUsable(s)) return { promoCode: s.code };
  return null;
}

/** The address arrived with, as the server described it. */
export function withLink(s: AcquisitionState, link: AcquisitionLookup): AcquisitionState {
  if (!link.usable) return { ...s, token: null, link };
  if (link.source === 'promoter') return { ...s, link, code: link.code, prefilled: link.code, lookup: { kind: 'usable', name: link.promoterName } };
  return { ...s, link };
}

/**
 * The boxes changed. Six digits are to be checked at once (`checking` until the server answers) — unless they are the
 * QR card's own, already answered. Changing the QR's own code makes it a typed code, and lets the QR go.
 */
export function withCode(s: AcquisitionState, code: string): AcquisitionState {
  if (code === s.code) return s;
  const leavesQr = isQr(s) && code !== s.prefilled;
  const prefilled = leavesQr ? null : s.prefilled;
  const lookup: AcquisitionState['lookup'] = code.length < PROMO_CODE_LENGTH ? { kind: 'idle' } : code === prefilled ? s.lookup : { kind: 'checking' };
  return { ...s, code, prefilled, token: leavesQr ? null : s.token, lookup };
}

/** "Remove promo code": the boxes empty; a QR's source goes with its code. */
export function withoutCode(s: AcquisitionState): AcquisitionState {
  return { ...s, code: '', prefilled: null, token: isQr(s) ? null : s.token, lookup: { kind: 'idle' } };
}

/** "Continue without the invitation", or choosing the code over it. */
export function withoutInvitation(s: AcquisitionState): AcquisitionState {
  return isInvitation(s) ? { ...s, token: null } : s;
}
