import type { en } from './en';

/**
 * Every valid translation key, derived from the English catalogue. Import this
 * anywhere a key is stored rather than rendered (e.g. the status registry) so
 * the key is validated at the point it is written down.
 */
export type TranslationKey = keyof typeof en;

/** A locale file must cover the full key set — no partial catalogues. */
export type Catalogue = Record<TranslationKey, string>;

/** Values interpolated into `{placeholders}` in a string. */
export type TranslationValues = Record<string, string | number>;
