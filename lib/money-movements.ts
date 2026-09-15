import { useQuery } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import type { PeriodMovements } from './money-movement-rules';
export { movementTotals, type ChannelMovement, type PeriodMovements } from './money-movement-rules';

export function useMoneyMovements(from: string, to: string, options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.moneyMovements(branchId, from, to),
    queryFn: () =>
      api.get<PeriodMovements>(`/closings/movements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: (options.enabled ?? true) && Boolean(branchId),
  });
}

