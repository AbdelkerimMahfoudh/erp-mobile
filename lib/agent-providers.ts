import { type AgentProvider, type ProviderConfig, type ReferenceRule } from './agent-rules.ts';

/**
 * A provider and its configuration as the Owner keeps them (docs/73 §1.2;
 * D154, D157, D164), as pure rules.
 *
 * D164: a provider has no rate. The commission is typed by the employee for
 * every exchange and paid by the customer; the provider neither pays nor
 * checks it. What a provider keeps is its name, whether it is switched on, and
 * whether it asks for its own reference — nothing has to be filled in before
 * the counter can use it. A version written before D164 keeps its rates as
 * history, shown as such, never applied.
 *
 *   node lib/agent-providers.test.ts
 */

export type ProviderKind = AgentProvider['kind'];
export const PROVIDER_KINDS: readonly ProviderKind[] = ['bankily', 'sedad', 'other'];
export const PROVIDER_LABEL_MAX = 80;
export const CONFIG_REASON_MAX = 255;
export const REFERENCE_RULES: readonly ReferenceRule[] = ['required', 'optional', 'none'];

/** The name a provider of a known kind goes by, offered when it is added; an `other` provider is named by the Owner. */
export function suggestedLabel(kind: ProviderKind): string {
  return kind === 'bankily' ? 'Bankily' : kind === 'sedad' ? 'Sedad' : '';
}

export type ProviderStatus = 'active' | 'switched_off';

/** How a provider stands for the counter: in use, or switched off. Nothing else keeps it from the counter (D164). */
export function providerStatus(provider: Pick<AgentProvider, 'isActive'>): ProviderStatus {
  return provider.isActive ? 'active' : 'switched_off';
}

/** The Owner's order, then by name — the counter's own order, switched-off providers last. */
export function providersInOrder<P extends Pick<AgentProvider, 'isActive' | 'sortOrder' | 'label'>>(providers: readonly P[]): P[] {
  return [...providers].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/** A rate in basis points as people say it, for a version's history only: 150 → "1.5". */
export function percentText(rateBp: number | null): string {
  if (rateBp === null) return '';
  return String(Math.round(rateBp) / 100);
}

// ── The configuration form ──────────────────────────────────────────────────

export interface ConfigForm {
  referenceRule: ReferenceRule;
  reason: string;
}

/** The form a new version starts from: the rule in force (`optional` when none was ever set) and no reason yet. */
export function formOf(provider: Pick<AgentProvider, 'referenceRule'> & { config?: Pick<ProviderConfig, 'referenceRule'> | null }): ConfigForm {
  return { referenceRule: provider.config?.referenceRule ?? provider.referenceRule, reason: '' };
}

export interface ConfigBody {
  referenceRule: ReferenceRule;
  reason: string;
}

export type ConfigProblem = 'reason_missing' | 'reason_too_long';

export type ConfigCheck = { ok: true; body: ConfigBody } | { ok: false; problems: ConfigProblem[] };

/**
 * The version the server records (`POST agent/providers/:id/configs`), or why
 * it cannot be sent: the reference rule, and the reason the version exists.
 * No rate, destination or fee mode is ever sent — the server refuses them.
 */
export function configCheck(form: ConfigForm): ConfigCheck {
  const reason = form.reason.trim();
  if (!reason) return { ok: false, problems: ['reason_missing'] };
  if (reason.length > CONFIG_REASON_MAX) return { ok: false, problems: ['reason_too_long'] };
  return { ok: true, body: { referenceRule: form.referenceRule, reason } };
}
