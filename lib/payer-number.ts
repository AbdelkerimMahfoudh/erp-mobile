/**
 * The payer number (docs/21 D151): the phone or account number a bank or
 * wallet payment came FROM — typed at the till, optional, never verified by any
 * provider. Not the transfer's reference, not the customer's saved phone, not
 * the account the money reached.
 *
 * Pure and dependency-free so it runs directly under Node. The server applies
 * the same rule (`erp-backend/src/sales/payer-number.ts`) and never trusts this
 * one; the two are kept identical by their tests.
 *
 * Accepted: an optional leading `+`, then digits, with the spaces and hyphens a
 * person types to group them. Normalised as presentation only: Arabic-Indic and
 * Extended Arabic-Indic digits read as the same digits; spaces of any kind,
 * hyphens and dashes of any kind, and invisible direction marks are dropped.
 * Never: a digit added, removed or changed — `00` is not turned into `+`, and
 * no country code is guessed. Refused: any other character, a `+` anywhere but
 * first, a number with no digit, more than {@link PAYER_NUMBER_MAX_DIGITS} digits.
 */

/** Characters accepted while typing; the field stops there. */
export const PAYER_NUMBER_MAX_INPUT = 40;
/** Digits kept: longer than any phone (15) or bank account number in use here. */
export const PAYER_NUMBER_MAX_DIGITS = 30;

export type ParsedPayerNumber =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'invalid' | 'too_long' };

const SPACES = /\s/gu;
const DASHES = /[-‐-―−﹘﹣－]/g;
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

export function parsePayerNumber(raw: string | null | undefined): ParsedPayerNumber {
  const visible = (raw ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/＋/g, '+')
    .replace(INVISIBLE, '')
    .replace(SPACES, '');
  // Blank is "no payer number"; anything visible must hold a number — a lone hyphen is a slip, not an empty field.
  if (visible === '') return { ok: true, value: null };
  const text = visible.replace(DASHES, '');
  if (!/^\+?[0-9]+$/.test(text)) return { ok: false, reason: 'invalid' };
  const digits = text.startsWith('+') ? text.length - 1 : text.length;
  if (digits > PAYER_NUMBER_MAX_DIGITS) return { ok: false, reason: 'too_long' };
  return { ok: true, value: text };
}

/**
 * The request field for one payment: the normalised number when the money is
 * not cash and one was typed, otherwise nothing at all — so cash never sends
 * one, and a blank field sends none.
 */
export function payerNumberField(method: string, typed: string | null | undefined): { payerNumber?: string } {
  if (method === 'cash') return {};
  const parsed = parsePayerNumber(typed);
  return parsed.ok && parsed.value ? { payerNumber: parsed.value } : {};
}
