/**
 * Which receiving accounts a person may pick for a NEW payment.
 *
 * An Owner's `/settings` includes deactivated accounts, so the Owner can manage
 * them. Offering one at the till only leads to a refusal from the server, which
 * still rejects an inactive account on its own. Labels of payments already made
 * are read from the full list instead: a snapshot must keep naming the account
 * it was paid into, active or not.
 */
export function selectableAccounts<T extends { isActive?: boolean }>(accounts: readonly T[] | undefined): T[] {
  return (accounts ?? []).filter((a) => a.isActive !== false);
}
