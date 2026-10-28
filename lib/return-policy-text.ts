/**
 * The written return conditions, as the app handles them (0108). Pure.
 *
 * The bound mirrors the server's `POLICY_TEXT_MAX`, which measures the text
 * after normalising its whitespace; the server is the authority.
 */
export const POLICY_TEXT_MAX = 1000;

export type PolicyLanguage = 'en' | 'fr' | 'ar';
