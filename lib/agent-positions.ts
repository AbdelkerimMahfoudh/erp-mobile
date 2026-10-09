/**
 * The drawer and the floats as the counter shows them (docs/73 §4.4–4.5, §5.3).
 *
 * Every position is the server's: an anchor plus everything recorded after it.
 * The phone adds one thing, and says it: while this phone still holds
 * exchanges the server has not accepted, each known figure is the server's
 * plus the legs those exchanges will post, labelled *Provisional* — and an
 * unknown one stays Unknown, with the day's movement beside it (D152's rule):
 * a movement, queued or recorded, is never turned into a balance.
 *
 *   node lib/agent-positions.test.ts
 */

export interface MovementLike {
  businessDate: string;
  inflows: number;
  outflows: number;
  net: number;
}

export interface FloatLike {
  providerId: string;
  providerLabel: string;
  accountKind: 'provider' | 'commission_held';
  known: boolean;
  position: number | null;
  movement: MovementLike | null;
}

export interface PositionsLike {
  cash: { known: boolean; position: number | null; movement: MovementLike | null };
  floats: FloatLike[];
  commissionHeld: FloatLike[];
}

export interface PositionRow {
  /** `cash`, `provider:<id>`, `commission_held:<id>` — the same keys the queued legs use. */
  key: string;
  kind: 'cash' | 'provider' | 'commission_held';
  /** The provider's name; empty for the drawer, which the phone names in its own language. */
  label: string;
  known: boolean;
  /** The server's figure, or the server's plus the queued legs; null when unknown — never 0. */
  position: number | null;
  /** The figure includes exchanges this phone has not sent yet. */
  provisional: boolean;
  /** What moved through the account on the business day, as the server says — beside an unknown figure. */
  movement: MovementLike | null;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The drawer first, then each float in the server's order, then each commission a provider holds. */
export function positionRows(positions: PositionsLike, queuedNet: Readonly<Record<string, number>> = {}): PositionRow[] {
  const row = (key: string, kind: PositionRow['kind'], label: string, known: boolean, position: number | null, movement: MovementLike | null): PositionRow => {
    const queued = queuedNet[key] ?? 0;
    const provisional = known && position !== null && queued !== 0;
    return { key, kind, label, known, position: known && position !== null ? round2(position + queued) : null, provisional, movement };
  };
  return [
    row('cash', 'cash', '', positions.cash.known, positions.cash.position, positions.cash.movement),
    ...positions.floats.map((f) => row(`provider:${f.providerId}`, 'provider', f.providerLabel, f.known, f.position, f.movement)),
    ...positions.commissionHeld.map((f) => row(`commission_held:${f.providerId}`, 'commission_held', f.providerLabel, f.known, f.position, f.movement)),
  ];
}
