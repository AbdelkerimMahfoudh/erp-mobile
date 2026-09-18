/**
 * Choosing the phone to sell, on the phone.
 *
 * Three ways in — scan, typed IMEI, the shelf — and one way out: a selection
 * describing the same existing Unit. These rules decide only what the screen
 * says before and after asking the server; the server decides whether the
 * phone exists, whether it can be sold here, and at what price.
 *
 * Pure: no React, no network.
 */

import { isValidLuhn } from './imei';
import type { SaleAvailability } from '../types/api';

/** How the phone was found. Shown on the selection, never used to decide anything. */
export type PickSource = 'scan' | 'manual' | 'stock';

/** Presentation characters only — spaces, dashes, dots, slashes. */
export function normalizeImeiInput(raw: string): string {
  return raw.trim().replace(/[\s\-./]+/g, '');
}

export type ManualImeiProblem = 'empty' | 'not_digits' | 'length' | 'checksum';

/**
 * Why a typed IMEI cannot be looked up yet, or null when it can. The same rules
 * the server applies, said before the request rather than after it.
 */
export function manualImeiProblem(raw: string): ManualImeiProblem | null {
  const imei = normalizeImeiInput(raw);
  if (imei.length === 0) return 'empty';
  if (!/^\d+$/.test(imei)) return 'not_digits';
  if (imei.length !== 15) return 'length';
  if (!isValidLuhn(imei)) return 'checksum';
  return null;
}

/** The words for an availability. Only `available` may continue to payment. */
export function availabilityKey(a: SaleAvailability): `pick.availability.${SaleAvailability}` {
  return `pick.availability.${a}`;
}

export function sourceKey(s: PickSource): `pick.source.${PickSource}` {
  return `pick.source.${s}`;
}

export type LookupFailure = 'invalid' | 'not_found' | 'network' | 'forbidden' | 'server';

/**
 * What went wrong asking the server, from its status and code. A request that
 * never arrived is "network", never "not found" — telling a shopkeeper a phone
 * is not in stock because the Wi-Fi dropped is the one wrong answer that
 * matters.
 */
export function lookupFailure(status: number | null, code?: string | null): LookupFailure {
  if (status === null || status === 0) return 'network';
  if (status === 404 || code === 'not_found') return 'not_found';
  if (status === 400 || (code && code.startsWith('imei_'))) return 'invalid';
  if (status === 401 || status === 403) return 'forbidden';
  return 'server';
}
