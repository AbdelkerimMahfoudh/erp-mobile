import { displayName, type BilingualName } from './display-name.ts';

/**
 * An account's stores in one line (D227): `Boutique Centre + 2 more`, backed by the full list. Most shops have no company
 * name, so this is what a person reads for an account. The first store is a presentation choice only, never a claim
 * about which store took part in anything. Pure:
 *
 *   node lib/store-list.test.ts
 */
export type MoreKey = 'stores.more.one' | 'stores.more.two' | 'stores.more.few' | 'stores.more.many';

/** Which wording `n` further stores take. Arabic needs all four; English and French say the same in the last three. */
export function moreKey(n: number): MoreKey {
  if (n === 1) return 'stores.more.one';
  if (n === 2) return 'stores.more.two';
  return n <= 10 ? 'stores.more.few' : 'stores.more.many';
}

/** First Strong Isolate: a Latin store name keeps its shape inside an Arabic sentence, and the reverse. */
const isolated = (value: string) => `⁨${value}⁩`;

export function compactStores(
  stores: readonly BilingualName[],
  language: string,
  t: (key: MoreKey, vars: { count: number }) => string,
): string {
  if (stores.length === 0) return '';
  const first = isolated(displayName(stores[0], language));
  return stores.length === 1 ? first : `${first} ${t(moreKey(stores.length - 1), { count: stores.length - 1 })}`;
}

/** Every store, for a screen with room: an invitation lists exactly what it assigns. */
export function storesLine(stores: readonly BilingualName[], language: string): string {
  return stores.map((s) => isolated(displayName(s, language))).join(language === 'ar' ? '، ' : ', ');
}

/** An account across a connection: its trading name, or its stores in one line, or the one string a search preview has. */
export function accountTitle(
  account: { name: string; nameAr?: string | null; tradingName?: string | null; tradingNameAr?: string | null; stores?: readonly BilingualName[] },
  language: string,
  t: (key: MoreKey, vars: { count: number }) => string,
): string {
  if (account.tradingName) return displayName({ name: account.tradingName, nameAr: account.tradingNameAr }, language);
  if (account.stores?.length) return compactStores(account.stores, language, t);
  return displayName({ name: account.name, nameAr: account.nameAr }, language);
}
