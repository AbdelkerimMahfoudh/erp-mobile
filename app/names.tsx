import { Redirect } from 'expo-router';

/**
 * The old More → "Business and store names" screen (D225). Its names now live in Business settings, the one place the
 * Owner edits them (2026-10-31). The route stays so a bookmark or a deep link lands on that screen, never on a broken
 * page — this one answered "Invalid query parameters" (a server fault, fixed with it).
 */
export default function NamesRedirect() {
  return <Redirect href="/settings" />;
}
