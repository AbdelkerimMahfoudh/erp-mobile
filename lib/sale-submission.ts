/**
 * Submitting one sale from the phone — the rules the screen must not improvise.
 *
 * Pure: no React, no network. What line to send for the item that was found,
 * what a quantity may be, and what a failed or lost submission MEANS — so that a
 * lost answer is treated as "unknown" and never as "not sent", and a refused
 * one is named rather than reported as "something went wrong".
 *
 * Errors are duck-typed on the fields that matter (`name`, `status`, `code`) so
 * every case is testable without constructing a real failed request, and so
 * this module needs nothing from the API client.
 */

import type { SaleSelection } from '../types/api';

/** One sale line as `POST /sales` takes it: a unit by its identifier, or a product by id and count. */
export type SaleLine = { identifier: string; price: number } | { productId: string; quantity: number; price: number };

/**
 * The line for the item that was found.
 *
 * A serialized unit — a phone, a device — is referenced by the identifier it was
 * found by (either IMEI or the serial), never by anything invented. A counted
 * product is referenced by its product id and how many; it has no unit to name.
 */
export function saleLineFor(selection: SaleSelection, identifier: string, quantity: number, price: number): SaleLine {
  if (selection.kind === 'product' && selection.productId) {
    return { productId: selection.productId, quantity, price };
  }
  return { identifier, price };
}

export type QuantityProblem = 'not_whole' | 'too_few' | 'too_many';

/**
 * Why a quantity cannot be sold, or null. Zero, a fraction, a negative number
 * and more than the branch has are all refused before the server is asked —
 * the server refuses them too, but a counter should not need a round trip to
 * learn that "0" is not a quantity.
 */
export function quantityProblem(quantity: number, available: number | undefined): QuantityProblem | null {
  if (!Number.isInteger(quantity)) return 'not_whole';
  if (quantity < 1) return 'too_few';
  if (available !== undefined && quantity > available) return 'too_many';
  return null;
}

/** The figure the payment sheet opens on. The server recomputes the real total. */
export function saleTotal(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity * 100) / 100;
}

/**
 * What a failed submission means.
 *
 * - `uncertain` — the answer was lost (a timeout). The sale MAY have been
 *   recorded. The only honest next step is to ask the server what the client
 *   key recorded, never to say "not sent" and never to resend blind.
 * - `idempotency_conflict` — the key already recorded a different sale; refresh
 *   and start again with a new key.
 * - `approval_required` — the server wants an Owner's approval for this price.
 * - `warnings` — handled by the caller before this is reached; listed for
 *   completeness so a caller never maps it as a failure.
 * - `refused` — the server read the request and said no, in a sentence.
 * - `offline` — the request never reached the server; nothing happened.
 * - `failed` — anything else; nothing is known to have been recorded.
 */
export type SubmitFailure =
  | { kind: 'uncertain' }
  | { kind: 'idempotency_conflict' }
  | { kind: 'approval_required' }
  | { kind: 'refused'; status: number; message: string; code: string | null }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string };

interface ErrorLike {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  body?: unknown;
}

export function classifySubmitFailure(error: unknown): SubmitFailure {
  const e = (error ?? {}) as ErrorLike;
  const message = typeof e.message === 'string' && e.message ? e.message : '';
  if (e.name === 'RequestTimeout' || e.name === 'AbortError' || e.name === 'TimeoutError') return { kind: 'uncertain' };
  if (typeof e.status === 'number') {
    const code =
      typeof e.code === 'string'
        ? e.code
        : typeof (e.body as { code?: unknown } | undefined)?.code === 'string'
          ? ((e.body as { code: string }).code)
          : null;
    if (code === 'idempotency_conflict') return { kind: 'idempotency_conflict' };
    if (code === 'approval_required') return { kind: 'approval_required' };
    if (e.status >= 400 && e.status < 500) return { kind: 'refused', status: e.status, message, code };
    return { kind: 'failed', message };
  }
  // fetch rejects with a TypeError only when the server could not be reached.
  if (error instanceof TypeError) return { kind: 'offline' };
  return { kind: 'failed', message };
}

/**
 * After an uncertain submission the server is asked what the key recorded.
 *
 * - `found` — the sale exists: finish as a success, with THAT sale.
 * - `not_found` — nothing was recorded: the same key may be resent.
 * - `unreachable` — still no answer: hold; the key must be kept for later.
 */
export type UncertainResolution = { kind: 'found' } | { kind: 'not_found' } | { kind: 'unreachable' };

export function resolveUncertain(lookupError: unknown | null): UncertainResolution {
  if (lookupError === null) return { kind: 'found' };
  const e = (lookupError ?? {}) as ErrorLike;
  if (e.status === 404) return { kind: 'not_found' };
  return { kind: 'unreachable' };
}

/**
 * Whether a tap may start a submission. One in flight means no second one —
 * a double tap must never become a second request, whatever the button shows.
 */
export function maySubmit(state: { inFlight: boolean; sellable: boolean; price: number | null; quantity: number; available: number | undefined }): boolean {
  return !state.inFlight && state.sellable && state.price !== null && state.price > 0 && quantityProblem(state.quantity, state.available) === null;
}
