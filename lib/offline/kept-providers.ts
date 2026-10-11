import { Directory, File, Paths } from 'expo-file-system';
import type { AgentProvider } from '../agent-rules.ts';
import { isDurable } from './durable-storage.ts';
import { keptProvidersFile, parseKeptProviders, type KeptProviders } from './kept-providers-rules.ts';

/**
 * The last provider list the server sent, one file per branch (rules and reasons in `kept-providers-rules.ts`).
 * Rates and labels only — the business's own configuration, no customer number — so a plain file is enough.
 */
const DIR = () => new Directory(Paths.document, 'agent-providers');

export function readKeptProviders(branchId: string): KeptProviders | null {
  if (!isDurable()) return null;
  try {
    const file = new File(DIR(), keptProvidersFile(branchId));
    return file.exists ? parseKeptProviders(file.textSync()) : null;
  } catch {
    // A list that cannot be read is no list: the counter says it cannot reach the server, as before.
    return null;
  }
}

export function keepProviders(branchId: string, providers: AgentProvider[]): void {
  if (!isDurable()) return;
  try {
    const dir = DIR();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const kept: KeptProviders = { savedAt: new Date().toISOString(), providers };
    new File(dir, keptProvidersFile(branchId)).write(JSON.stringify(kept));
  } catch {
    /* a list that cannot be kept is one the next offline exchange does without */
  }
}
