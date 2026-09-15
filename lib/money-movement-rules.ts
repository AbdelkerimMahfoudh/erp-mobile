/**
 * Recorded money in and out per channel — `GET /closings/movements`.
 *
 * The daily closing's own movement query over a period, so Money and the
 * closing cannot disagree. It is what the app RECORDED: nothing here says a
 * bank or wallet provider confirmed any of it. No runtime imports, so a plain
 * node test can call the totals.
 */
export interface ChannelMovement {
  channel: 'cash' | 'account';
  accountId: string | null;
  label: string;
  isUnattributed: boolean;
  moneyIn: number;
  moneyOut: number;
  net: number;
}

export interface PeriodMovements {
  from: string;
  to: string;
  channels: ChannelMovement[];
}

/** Totals across every channel. Pure, for tests. */
export function movementTotals(channels: readonly ChannelMovement[]): { moneyIn: number; moneyOut: number; net: number } {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const moneyIn = r2(channels.reduce((a, c) => a + c.moneyIn, 0));
  const moneyOut = r2(channels.reduce((a, c) => a + c.moneyOut, 0));
  return { moneyIn, moneyOut, net: r2(moneyIn - moneyOut) };
}
