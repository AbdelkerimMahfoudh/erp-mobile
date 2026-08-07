import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api-client';
import { useBranch } from './branch';
import { dialog } from './dialog';
import { haptics } from './haptics';
import { t, type TranslationKey } from './i18n';
import { qk } from './query-keys';
import { money } from './theme';
import { toast } from './toast';
export { parsePrice, canSave, type ParsedPrice } from './price-input';
import { parsePrice } from './price-input';
import type {
  EffectivePrice,
  PriceHistoryPage,
  PriceSource,
  RemovePriceBody,
  SetPriceBody,
  UnitEffectivePrice,
} from '../types/api';

/**
 * The mobile side of pricing.
 *
 * **The server owns precedence.** Nothing here decides which price wins; it
 * reads `source`, `version` and `fallback` off the response and renders them.
 * The one piece of logic the client legitimately owns is turning what the user
 * typed into a number, and that is kept pure below so it can be tested.
 */

// ─────────────────────────── plain-language labels ───────────────────────────

/** Shop language for where a price came from. Backend names never reach the UI. */
export function sourceLabel(source: PriceSource): string {
  return t(`pricing.source.${source}` as TranslationKey);
}

export function sourceExplanation(source: PriceSource): string {
  return t(`pricing.source.explain.${source}` as TranslationKey);
}

/**
 * Status is shown by colour AND words, never colour alone — so this returns a
 * tone the caller pairs with `sourceLabel`, never uses on its own.
 */
export function sourceTone(source: PriceSource): 'brand' | 'warning' | 'neutral' {
  if (source === 'unpriced') return 'warning';
  if (source === 'unit_override' || source === 'branch_variant' || source === 'stock_item') return 'brand';
  return 'neutral';
}

// ─────────────────────────────── reads ───────────────────────────────

export function usePricingProduct(productId: string | undefined) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.pricingProduct(branchId, productId ?? ''),
    enabled: Boolean(productId),
    queryFn: () => api.get<EffectivePrice>(`/pricing/products/${productId}`),
  });
}

export function usePricingUnit(identifier: string | undefined) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.pricingUnit(branchId, identifier ?? ''),
    enabled: Boolean(identifier),
    retry: false, // a wrong identifier is an answer, not a fault to retry
    queryFn: () => api.get<UnitEffectivePrice>(`/pricing/units/${encodeURIComponent(identifier!)}`),
  });
}

export function usePriceHistory(productId: string | undefined, limit = 25) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.priceHistory(branchId, productId),
    enabled: Boolean(productId),
    queryFn: () =>
      api.get<PriceHistoryPage>(
        `/pricing/history?limit=${limit}${productId ? `&productId=${productId}` : ''}`,
      ),
  });
}

// ─────────────────────────────── writes ───────────────────────────────

/** Which thing is being priced. Decides the endpoint and the explanation shown. */
export type PriceScope =
  | { kind: 'branch_variant'; productId: string }
  | { kind: 'stock_item'; productId: string }
  | { kind: 'unit'; identifier: string };

function endpointFor(scope: PriceScope): string {
  switch (scope.kind) {
    case 'branch_variant':
      return `/pricing/products/${scope.productId}/branch-price`;
    case 'stock_item':
      return `/pricing/products/${scope.productId}/stock-price`;
    case 'unit':
      return `/pricing/units/${encodeURIComponent(scope.identifier)}/price`;
  }
}

/** A 409 always means: someone else got there first. Never retry it silently. */
export function isStaleEdit(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/**
 * The server asks for a reason when a price is below cost, and refuses outright
 * when the caller may not authorise one.
 *
 * A 400 carrying that demand is not a validation bug — it is the Owner being
 * asked to justify the decision. A 403 is a Manager being refused, and must not
 * offer any way around it.
 */
function needsBelowCostReason(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    /below cost|say why/i.test(error.message ?? '')
  );
}

/**
 * Invalidate exactly what a price change can have altered.
 *
 * Deliberately not a blanket `invalidateQueries()`: that reloads the whole app
 * — home, analytics, every list — for one price edit, on a phone, in a shop
 * with a slow connection.
 */
function invalidatePricing(
  queryClient: ReturnType<typeof useQueryClient>,
  branchId: string | null,
  productId?: string,
) {
  const keys: unknown[][] = [
    ['pricing'], // this product's price, the unit's price, and history
    [...qk.inventory(branchId)].slice(0, 2), // inventory list for this branch
  ];
  if (productId) keys.push([...qk.product(productId)]);
  for (const key of keys) {
    void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
  }
}

interface SaveArgs {
  scope: PriceScope;
  price: number;
  /** Exactly what the server last returned. Omitted only when creating. */
  expectedVersion: number | null;
  productId?: string;
}

/**
 * Save a price, handling the two things the server can legitimately come back
 * with: "that is below cost, justify it" and "someone else changed this".
 */
export function useSavePrice() {
  const queryClient = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: async ({ scope, price, expectedVersion }: SaveArgs) => {
      const body: SetPriceBody = {
        price,
        ...(expectedVersion !== null ? { expectedVersion } : {}),
      };
      try {
        return await api.put<EffectivePrice>(endpointFor(scope), body);
      } catch (error) {
        if (!needsBelowCostReason(error)) throw error;

        // Owner authorising a below-cost price. Same price, same version — the
        // retry must not become a different edit than the one just reviewed.
        const result = await dialog.confirmWithReason({
          title: t('pricing.belowCost.title'),
          message: t('pricing.belowCost.owner'),
          confirmLabel: t('pricing.belowCost.confirm'),
          reasonLabel: t('pricing.belowCost.reason'),
          tone: 'danger',
        });
        if (!result.confirmed || !result.reason?.trim()) throw error;

        return api.put<EffectivePrice>(endpointFor(scope), { ...body, reason: result.reason.trim() });
      }
    },
    onSuccess: (_data, variables) => {
      void haptics.success();
      toast.success(t('pricing.saved'));
      invalidatePricing(queryClient, branchId, variables.productId);
    },
    onError: () => {
      void haptics.error();
    },
  });
}

interface RemoveArgs {
  scope: PriceScope;
  expectedVersion: number;
  productId?: string;
}

export function useRemovePrice() {
  const queryClient = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return useMutation({
    mutationFn: ({ scope, expectedVersion }: RemoveArgs) => {
      const body: RemovePriceBody = { expectedVersion };
      return api.delete<EffectivePrice>(endpointFor(scope), body);
    },
    onSuccess: (_data, variables) => {
      void haptics.success();
      toast.success(t('pricing.removed'));
      invalidatePricing(queryClient, branchId, variables.productId);
    },
    onError: () => {
      void haptics.error();
    },
  });
}

/**
 * Explain a stale edit in terms of the two prices involved.
 *
 * The user is told what they tried and what it is now, then chooses. Refreshing
 * and resubmitting for them would overwrite a decision someone else just made.
 */
export function staleEditMessage(attempted: number, current: number | null): string {
  return t('pricing.conflict.body', {
    attempted: money(attempted),
    current: current === null ? t('pricing.source.unpriced') : money(current),
  });
}
