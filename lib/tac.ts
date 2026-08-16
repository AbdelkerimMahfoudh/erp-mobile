import { useQuery } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { tacOf } from './imei';

/**
 * What this company knows about a TAC (Milestone C).
 *
 * Two layers with different authority, and the app must show which one answered:
 *
 *   `company_confirmed`  somebody with authority in THIS shop said this TAC is
 *                        this product. The only source that names a product.
 *   `company_proposed`   an employee suggested it and nobody has agreed yet.
 *                        **Never auto-selected** — the server returns no product
 *                        id at all, so there is nothing to select by accident.
 *   `global_catalog`     the shared reference table. Manufacturer and model
 *                        only; it can never name one shop's product.
 *   `none`               nobody knows. The user chooses.
 *
 * Storage, colour, condition, cost and price are never inferred from a TAC.
 */

export type TacSource = 'company_confirmed' | 'company_proposed' | 'global_catalog' | 'none';

export interface TacMappingRow {
  id: string;
  productId: string;
  product: string;
  status: 'proposed' | 'confirmed' | 'superseded';
  proposedBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  evidenceSource: string | null;
  timesSeen: number;
  version: number;
}

export interface TacResolution {
  tac: string;
  source: TacSource;
  /** Set ONLY by a confirmed company mapping. */
  productId: string | null;
  brand: string | null;
  model: string | null;
  variant: string | null;
  /** True when a human must decide before anything is selected. */
  needsReview: boolean;
  reviewReason: 'unconfirmed_proposal' | 'conflicting_mappings' | null;
  product: { id: string; brand: string; model: string; variant: string | null } | null;
  mappings: TacMappingRow[];
}

/** Resolve the TAC of an IMEI. Disabled until there is a valid one to resolve. */
export function useTacResolution(imei: string | null | undefined) {
  const branchId = useBranch((s) => s.branchId);
  const tac = imei ? tacOf(imei) : null;

  return useQuery({
    queryKey: ['tac', branchId, tac ?? ''],
    queryFn: () => api.get<TacResolution>(`/tac-mappings/${tac}`),
    enabled: Boolean(tac),
    // A TAC mapping changes only when somebody teaches it, which is rare.
    staleTime: 5 * 60_000,
  });
}

/**
 * Reconcile the two TACs of a dual-SIM phone.
 *
 * Mirrors the server's rule, because the screen has to show the outcome before
 * anything is submitted: agreeing is one strong suggestion, one resolving is
 * still usable, and **disagreeing blocks automatic selection** — two TACs
 * naming different products means the read is wrong, the phone is unusual, or
 * the mappings are, and picking one would create a record for a device that
 * does not exist.
 */
export function reconcileTacs(
  primary: TacResolution | undefined,
  secondary: TacResolution | undefined,
): { resolution: TacResolution | null; conflict: boolean } {
  if (!primary && !secondary) return { resolution: null, conflict: false };
  if (!secondary) return { resolution: primary ?? null, conflict: primary?.needsReview ?? false };
  if (!primary) return { resolution: secondary, conflict: secondary.needsReview };

  const a = primary.productId;
  const b = secondary.productId;

  if (a && b && a !== b) return { resolution: null, conflict: true };
  if (a && !b) return { resolution: primary, conflict: primary.needsReview };
  if (b && !a) return { resolution: secondary, conflict: secondary.needsReview };

  const chosen = primary.source !== 'none' ? primary : secondary;
  return { resolution: chosen, conflict: chosen.needsReview };
}
