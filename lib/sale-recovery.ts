import type { QueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { invalidateMoney } from './money-invalidation';
import { qk } from './query-keys';
import { resolveUncertain } from './sale-submission';

/**
 * After a lost answer, ask the server what this client key recorded.
 *
 * `found` carries the sale: the submission succeeded and only the answer was
 * lost on the way back. `not_found` means nothing was recorded, so the same key
 * may be sent again. `unreachable` means still no answer — nothing is known,
 * and the key must be kept, never rotated, so a later retry cannot become a
 * second sale of the same item.
 */
export async function recoverUncertainSale<T>(
  clientUuid: string,
): Promise<{ kind: 'found'; sale: T } | { kind: 'not_found' } | { kind: 'unreachable' }> {
  try {
    const sale = await api.get<T>(`/sales/client/${clientUuid}`);
    return { kind: 'found', sale };
  } catch (error) {
    return resolveUncertain(error).kind === 'not_found' ? { kind: 'not_found' } : { kind: 'unreachable' };
  }
}

/** Everything a sale moves, read again — because the sale may or may not have happened. */
export function refreshAfterUncertainty(qc: QueryClient, branchId: string | null): void {
  void qc.invalidateQueries({ queryKey: ['sales'] });
  void qc.invalidateQueries({ queryKey: qk.home(branchId) });
  void qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
  void qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
  invalidateMoney(qc);
}
