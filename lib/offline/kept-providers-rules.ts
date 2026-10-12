import { providerOf, type AgentProvider } from '../agent-rules.ts';
import type { ErrorKind } from './queue-rules.ts';

/**
 * The provider list the counter keeps on the phone (D155; device run, 2026-10-10).
 *
 * An exchange recorded offline is prepared from the providers and their
 * reference rule; the phone held them only in memory, so a refresh that failed without a
 * network replaced the list with an error, and a relaunch had none at all. The
 * last list the server sent is now kept per branch and used only when the server
 * cannot be reached — never when it answered with a refusal (a permission or the
 * business's access taken away is the server's word, not a network problem).
 * A kept list is safe to prepare with: it carries no price — the commission is
 * typed with each exchange (D164) — and a reference rule that changed since is
 * the server's to enforce (`reference_required`, then fixed on the phone). A
 * list an earlier build kept, rates and all, is read in this build's shape.
 *
 * Pure (type-only imports), so a plain `node` test can load it.
 */

export interface KeptProviders {
  savedAt: string;
  providers: AgentProvider[];
}

/** The failures the kept list answers: the server out of reach, or too slow or broken to answer. */
export function mayUseKeptProviders(kind: ErrorKind): boolean {
  return kind === 'no_network' || kind === 'api_unreachable' || kind === 'timeout_uncertain' || kind === 'server_error';
}

/** The file of a branch: its id, kept to the characters a file name takes. */
export function keptProvidersFile(branchId: string): string {
  return `providers-${branchId.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 64)}.json`;
}

/** A kept list read back, or null for anything else — a corrupt file is no list, never an error. */
export function parseKeptProviders(text: string): KeptProviders | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const { savedAt, providers } = value as Partial<KeptProviders>;
    if (typeof savedAt !== 'string' || !Array.isArray(providers)) return null;
    const read = providers.map(providerOf);
    return read.every((p) => p !== null) ? { savedAt, providers: read as AgentProvider[] } : null;
  } catch {
    return null;
  }
}
