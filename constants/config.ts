import { Platform } from 'react-native';

/**
 * API host resolution:
 *  - EXPO_PUBLIC_API_HOST wins (set it to your machine's LAN IP for a physical
 *    device in Expo Go, e.g. 192.168.100.100).
 *  - On web, use the host the page was served from — so localhost AND the LAN IP
 *    (phone browser) both just work with no config.
 *  - Android emulator reaches the host machine at 10.0.2.2.
 */
function resolveHost(): string {
  if (process.env.EXPO_PUBLIC_API_HOST) return process.env.EXPO_PUBLIC_API_HOST;
  if (Platform.OS === 'web') {
    const h = (globalThis as { location?: { hostname?: string } }).location?.hostname;
    if (h) return h;
  }
  if (Platform.OS === 'android') return '10.0.2.2';
  return 'localhost';
}

export const API_BASE = `http://${resolveHost()}:3010`;
export const API_V1_URL = `${API_BASE}/api/v1`;


/**
 * Where somebody goes to create an account.
 *
 * Configured, never hardcoded to a localhost or a production domain: the same
 * build runs against a developer machine, a LAN address and, eventually, a real
 * site, and baking one of those in would make the button wrong for the other
 * two.
 *
 * Returns null when nothing is configured, so the caller can say so plainly
 * rather than opening a URL that does not exist.
 */
export function signupUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_SIGNUP_URL?.trim();
  if (configured) return configured;

  /*
   * A sensible development fallback: the control website beside this API, on
   * the same host. Deliberately NOT a production guess — if this resolves to
   * something that is not running, the caller reports it.
   */
  const host = resolveHost();
  if (!host) return null;
  return `http://${host}:5173/public/register`;
}

/** Where an Owner manages their subscription. Same rules as above. */
export function accountPortalUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_PORTAL_URL?.trim();
  if (configured) return configured;
  const host = resolveHost();
  if (!host) return null;
  return `http://${host}:5173/account`;
}

export const TOKEN_KEYS = {
  ACCESS_TOKEN: 'erp.accessToken',
  REFRESH_TOKEN: 'erp.refreshToken',
  USER: 'erp.user',
  BRANCH: 'erp.branch',
} as const;
