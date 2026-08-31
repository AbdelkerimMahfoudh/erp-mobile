import { Directory, File, Paths } from 'expo-file-system';
import { api } from './api-client';
import { isDurable } from './offline/durable-storage.ts';

/**
 * The phone brand and model catalogue, on the device.
 *
 * ## There is exactly one catalogue, and it lives on the server
 *
 * Nothing here holds a list of phones. This fetches the server's catalogue and
 * keeps the last copy it saw, so a shop in a back room with no signal can still
 * pick "Samsung" and "Galaxy A16". Bundling a second list in the app would mean
 * two catalogues drifting apart, and the one you could not fix without shipping
 * a release would be the one people were looking at.
 *
 * ## The cache is a convenience, never an authority
 *
 * A cached answer is used when the network cannot be reached. It is never
 * treated as proof of anything: IMEI uniqueness is decided by the server at
 * creation time, and a suggestion produced from a cached TAC mapping is
 * labelled as coming from a stored copy rather than a live lookup. Claiming a
 * lookup happened when it did not is the one thing this must not do.
 *
 * Written with the durable file storage the offline drafts use — the
 * **non-secret** mechanism. A brand list is not a credential and does not
 * belong in the secure store, where it would only make the credentials easier
 * to find.
 */

export interface CatalogueBrand {
  key: string;
  name: string;
  /** Recorded, not acted on: Redmi and POCO stay brands in their own right. */
  manufacturerKey: string | null;
}

export interface CatalogueModel {
  id: number;
  name: string;
  family: string;
  /** The release YEAR. Shown if ever useful; never used to order anything. */
  releaseYear: number;
  /**
   * The server's position for this model.
   *
   * Carried so the client can be CHECKED, not so it can sort. The order the
   * server sends is canonical — newest family first, premium variant first —
   * and re-sorting here would mean the list read one way on a phone and another
   * in the administration portal, with neither being the product decision.
   */
  displayRank: number;
}

/** One pickable storage capacity or colour. */
export interface AttributeOption {
  key: string;
  label: string;
}

export interface DeviceAttributes {
  storage: AttributeOption[];
  colour: AttributeOption[];
  /**
   * What `variant` records — `['storage', 'colour']`.
   *
   * Carried in the payload rather than assumed here, because a client that
   * guessed `variant` meant "region" would quietly file one phone under a
   * product row per market.
   */
  describes: string[];
  /** What joins the two halves inside the stored string. */
  separator: string;
}

export interface CatalogueVersion {
  updatedAt: string | null;
  brands: number;
  models: number;
  /** Always false. A starter catalogue, and it says so. */
  complete: boolean;
}

/** Where a list came from, so a screen can be honest about it. */
export type CatalogueOrigin = 'live' | 'cached' | 'unavailable';

export interface CatalogueResult<T> {
  items: T[];
  origin: CatalogueOrigin;
  /** When the cached copy was taken. Null for a live answer. */
  cachedAt: string | null;
}

const DIR = () => new Directory(Paths.document, 'catalogue');
const BRANDS_FILE = 'brands.json';
const modelsFile = (brandKey: string) => `models-${brandKey.replace(/[^a-z0-9_-]/gi, '_')}.json`;

interface Cached<T> {
  savedAt: string;
  items: T[];
}

function read<T>(name: string): Cached<T> | null {
  if (!isDurable()) return null;
  try {
    const file = new File(DIR(), name);
    if (!file.exists) return null;
    const parsed: unknown = JSON.parse(file.textSync());
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as Cached<T>).items) &&
      typeof (parsed as Cached<T>).savedAt === 'string'
    ) {
      return parsed as Cached<T>;
    }
    return null;
  } catch {
    // A corrupt cache is not an error worth showing anybody: the network path
    // still works, and the manual field always does.
    return null;
  }
}

function write<T>(name: string, items: T[]): void {
  if (!isDurable()) return;
  try {
    const dir = DIR();
    if (!dir.exists) dir.create({ intermediates: true });
    new File(dir, name).write(JSON.stringify({ savedAt: new Date().toISOString(), items }));
  } catch {
    /* a cache that cannot be written is a cache that is not used */
  }
}

/**
 * Fetch, and fall back to the last copy.
 *
 * The failure is swallowed deliberately. Every caller of this has a manual
 * entry path, so "the catalogue did not load" is a smaller problem than it
 * looks — and an error dialog in front of somebody receiving stock, when they
 * could simply type the model, would be the app getting in the way.
 */
async function fetchOrCache<T>(path: string, file: string): Promise<CatalogueResult<T>> {
  try {
    const items = await api.get<T[]>(path);
    write(file, items);
    return { items, origin: 'live', cachedAt: null };
  } catch {
    const cached = read<T>(file);
    if (cached) return { items: cached.items, origin: 'cached', cachedAt: cached.savedAt };
    return { items: [], origin: 'unavailable', cachedAt: null };
  }
}

export function fetchBrands(): Promise<CatalogueResult<CatalogueBrand>> {
  return fetchOrCache<CatalogueBrand>('/device-catalogue/brands', BRANDS_FILE);
}

export function fetchModels(brandKey: string): Promise<CatalogueResult<CatalogueModel>> {
  return fetchOrCache<CatalogueModel>(
    `/device-catalogue/brands/${encodeURIComponent(brandKey)}/models`,
    modelsFile(brandKey),
  );
}

const ATTRIBUTES_FILE = 'attributes.json';

/**
 * The storage and colour lists, from the server, with the last copy as backup.
 *
 * Same rule as brands and models: **the app holds no list of its own.** These
 * two are short and stable enough that bundling them would have been tempting,
 * and that is exactly how the second catalogue starts — one that cannot be
 * corrected without shipping a release, sitting next to one that can.
 *
 * A shop with no signal and no cached copy gets empty lists, and the `Other`
 * field is what carries them through: the selectors keep working with nothing
 * to select from, because typing has never been the failure case.
 */
export async function fetchAttributes(): Promise<{
  attributes: DeviceAttributes | null;
  origin: CatalogueOrigin;
  cachedAt: string | null;
}> {
  try {
    const attributes = await api.get<DeviceAttributes>('/device-catalogue/attributes');
    write(ATTRIBUTES_FILE, [attributes]);
    return { attributes, origin: 'live', cachedAt: null };
  } catch {
    const cached = read<DeviceAttributes>(ATTRIBUTES_FILE);
    if (cached?.items[0]) {
      return { attributes: cached.items[0], origin: 'cached', cachedAt: cached.savedAt };
    }
    return { attributes: null, origin: 'unavailable', cachedAt: null };
  }
}

export { normaliseSearch, matches, OTHER_BRAND_KEY } from './catalogue-search.ts';
