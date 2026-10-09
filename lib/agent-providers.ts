import { toAsciiDigits } from './price-input.ts';
import type { AgentProvider, CommissionDestination, PrincipalFeeMode, ProviderConfig, ReferenceRule } from './agent-rules.ts';

/**
 * A provider's configuration as the Owner fills it in (docs/73 §1.2, §4.2;
 * D154, D157), as pure rules.
 *
 * Every field is read from the provider's real schedule. A field the Owner does
 * not know yet stays **blank** — sent as `null`, shown as *Not set* — and the
 * provider stays *Not set up yet*: nothing is ever posted with a zero, a sample
 * or a guessed rate. The form never fills a field the Owner did not choose; a
 * new version starts from the version in force, blanks included, so changing
 * one rate does not quietly clear another.
 *
 *   node lib/agent-providers.test.ts
 */

export type ProviderKind = AgentProvider['kind'];
export const PROVIDER_KINDS: readonly ProviderKind[] = ['bankily', 'sedad', 'other'];
export const PROVIDER_LABEL_MAX = 80;
export const CONFIG_REASON_MAX = 255;

export const COMMISSION_DESTINATIONS: readonly CommissionDestination[] = ['provider_float', 'cash', 'held_separately'];
export const FEE_MODES: readonly PrincipalFeeMode[] = ['separate', 'deducted'];
export const REFERENCE_RULES: readonly ReferenceRule[] = ['required', 'optional', 'none'];

/** The name a provider of a known kind goes by, offered when it is added; an `other` provider is named by the Owner. */
export function suggestedLabel(kind: ProviderKind): string {
  return kind === 'bankily' ? 'Bankily' : kind === 'sedad' ? 'Sedad' : '';
}

export type ProviderStatus = 'ready' | 'not_set_up' | 'switched_off';

/** How a provider stands for the counter: ready to post, a blank to fill, or switched off. The server's verdict. */
export function providerStatus(provider: Pick<AgentProvider, 'isActive' | 'readyForTransactions'>): ProviderStatus {
  if (!provider.isActive) return 'switched_off';
  return provider.readyForTransactions ? 'ready' : 'not_set_up';
}

/** The Owner's order, then by name — the counter's own order, switched-off providers last. */
export function providersInOrder<P extends Pick<AgentProvider, 'isActive' | 'sortOrder' | 'label'>>(providers: readonly P[]): P[] {
  return [...providers].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

// ── Rates as people say them ────────────────────────────────────────────────

/** A rate in basis points as the field shows it: 150 → "1.5", 5 → "0.05"; a blank is an empty field. */
export function percentText(rateBp: number | null): string {
  if (rateBp === null) return '';
  return String(Math.round(rateBp) / 100);
}

export type ParsedPercent = { ok: true; bp: number | null } | { ok: false; reason: 'not_a_number' | 'too_precise' | 'too_high' };

/**
 * A typed percentage as basis points — the unit the server keeps, whole:
 * `1.5` → 150. Empty is a blank (`null`), never zero; `0` typed is zero. Arabic
 * digits and a comma read as the same figure; at most two decimals (a basis
 * point); at most 100 %.
 */
export function parsePercent(text: string): ParsedPercent {
  const normalised = toAsciiDigits(text.trim()).replace(/,/g, '.').replace(/\s|%/g, '');
  if (!normalised) return { ok: true, bp: null };
  if (!/^\d*\.?\d*$/.test(normalised) || normalised === '.') return { ok: false, reason: 'not_a_number' };
  if ((normalised.split('.')[1]?.length ?? 0) > 2) return { ok: false, reason: 'too_precise' };
  const bp = Math.round(Number(normalised) * 100);
  if (!Number.isFinite(bp)) return { ok: false, reason: 'not_a_number' };
  if (bp > 10_000) return { ok: false, reason: 'too_high' };
  return { ok: true, bp };
}

// ── The configuration form ──────────────────────────────────────────────────

export interface ConfigForm {
  rateIn: string;
  rateOut: string;
  /** Asked, never assumed: null until the Owner says whether the schedule has one rate or two. */
  sameRate: boolean | null;
  destination: CommissionDestination | null;
  feeMode: PrincipalFeeMode | null;
  referenceRule: ReferenceRule | null;
  reason: string;
}

/**
 * The form a new version starts from: the version in force, field by field —
 * its blanks blank — or every field blank for a provider never configured. The
 * reason is always the Owner's own, for this version.
 */
export function formOf(config: ProviderConfig | null): ConfigForm {
  if (!config) return { rateIn: '', rateOut: '', sameRate: null, destination: null, feeMode: null, referenceRule: null, reason: '' };
  return {
    rateIn: percentText(config.rateInBp),
    rateOut: config.sameRateBothDirections ? '' : percentText(config.rateOutBp),
    sameRate: config.sameRateBothDirections,
    destination: config.commissionDestination,
    feeMode: config.principalFeeMode,
    referenceRule: config.referenceRule,
    reason: '',
  };
}

export interface ConfigBody {
  rateInBp: number | null;
  rateOutBp: number | null;
  sameRateBothDirections: boolean;
  commissionDestination: CommissionDestination | null;
  principalFeeMode: PrincipalFeeMode | null;
  referenceRule: ReferenceRule | null;
  reason: string;
}

export type ConfigProblem = 'reason_missing' | 'reason_too_long' | 'rate_in_invalid' | 'rate_out_invalid' | 'same_rate_unanswered' | 'deducted_needs_float';

export type ConfigCheck = { ok: true; body: ConfigBody; missing: string[] } | { ok: false; problems: ConfigProblem[] };

/** The required fields left blank, named as the server names them (`missing`), in its order. */
export function missingFields(body: Pick<ConfigBody, 'rateInBp' | 'rateOutBp' | 'commissionDestination' | 'principalFeeMode' | 'referenceRule'>): string[] {
  return (['rateInBp', 'rateOutBp', 'commissionDestination', 'principalFeeMode', 'referenceRule'] as const).filter((f) => body[f] === null);
}

/**
 * The version the server records (`POST agent/providers/:id/configs`), or why
 * it cannot be sent:
 *  - a typed rate must be a percentage the server can keep;
 *  - once a rate is typed, the Owner says whether it is the same both ways —
 *    the phone never decides it (with one rate it is copied to both, as the
 *    server does; with none, nothing is copied and both stay blank);
 *  - a fee deducted from the principal lands on the float, or the server
 *    refuses the version (`config_invalid`) — said before it is sent;
 *  - every version carries the reason it exists.
 * Blanks are sent as blanks (`null`): the version records exactly what the
 * Owner knows, and `missing` says what still keeps the provider from posting.
 */
export function configCheck(form: ConfigForm): ConfigCheck {
  const problems: ConfigProblem[] = [];
  const rateIn = parsePercent(form.rateIn);
  const rateOut = parsePercent(form.sameRate ? '' : form.rateOut);
  const reason = form.reason.trim();
  if (!rateIn.ok) problems.push('rate_in_invalid');
  if (!rateOut.ok) problems.push('rate_out_invalid');
  const anyRate = (rateIn.ok && rateIn.bp !== null) || (rateOut.ok && rateOut.bp !== null);
  if (form.sameRate === null && anyRate) problems.push('same_rate_unanswered');
  if (form.feeMode === 'deducted' && form.destination !== 'provider_float') problems.push('deducted_needs_float');
  if (!reason) problems.push('reason_missing');
  else if (reason.length > CONFIG_REASON_MAX) problems.push('reason_too_long');
  if (problems.length > 0 || !rateIn.ok || !rateOut.ok) return { ok: false, problems };

  const same = form.sameRate === true;
  const body: ConfigBody = {
    rateInBp: rateIn.bp,
    rateOutBp: same ? rateIn.bp : rateOut.bp,
    sameRateBothDirections: same,
    commissionDestination: form.destination,
    principalFeeMode: form.feeMode,
    referenceRule: form.referenceRule,
    reason,
  };
  return { ok: true, body, missing: missingFields(body) };
}
