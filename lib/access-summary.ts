import type { Entitlement } from './entitlement';

/**
 * Business access in one line, for the top of More (D227): the state in words, then what the server says is left, then
 * the stores and seats. The phone counts no days: every figure is the server's. The permanent Test business has its own
 * honest state and never a countdown, because nothing about it runs out.
 */
export interface AccessSummary {
  stateKey: string;
  parts: { key: string; values?: Record<string, number> }[];
}

export function accessSummary(entitlement: Entitlement | undefined, isTestBusiness: boolean): AccessSummary | null {
  if (isTestBusiness) return { stateKey: 'access.summary.test', parts: [] };
  if (!entitlement) return null;
  const parts: AccessSummary['parts'] = [];
  const state = entitlement.state;
  if (state === 'grace') {
    const hours = entitlement.graceHoursRemaining;
    if (hours > 0) parts.push({ key: hours > 24 ? 'access.summary.graceDays' : 'access.summary.graceHours', values: hours > 24 ? { days: Math.ceil(hours / 24) } : { hours } });
  } else if (entitlement.canWrite && entitlement.daysRemaining !== null && entitlement.daysRemaining > 0) {
    parts.push({ key: 'access.summary.days', values: { days: entitlement.daysRemaining } });
  }
  if (entitlement.subscribedBranchCount > 0) {
    parts.push({ key: 'access.summary.coverage', values: { stores: entitlement.subscribedBranchCount, used: entitlement.seatsUsed, seats: entitlement.seatLimit } });
  }
  return { stateKey: entitlement.isComplimentary && state === 'active' ? 'access.state.complimentary' : `access.state.${state}`, parts };
}
