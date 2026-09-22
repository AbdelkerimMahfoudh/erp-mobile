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

/**
 * The API origin.
 *
 * `EXPO_PUBLIC_API_ORIGIN` overrides everything — scheme and port included. A
 * deployed environment serves the website and the API from ONE origin
 * (`https://host/` and `https://host/api/v1`), so there is no port to guess and
 * no second site for a session cookie to be withheld across. That is the exact
 * failure Phase 2 lost time to, when the page was on `localhost` and the API on
 * `127.0.0.1`: different sites, so `SameSite=Lax` withheld the cookie precisely
 * as designed.
 *
 * With nothing configured the development default is unchanged: the API beside
 * this app on port 3010.
 */
function resolveOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_API_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `http://${resolveHost()}:3010`;
}

export const API_BASE = resolveOrigin();
export const API_V1_URL = `${API_BASE}/api/v1`;

/**
 * Which environment this build talks to.
 *
 * A tester must never have to wonder whether the shop on screen is the real
 * one. Unset means production: no label, no banner, nothing extra on the
 * shopkeeper's screen.
 */
export function appEnvironment(): 'staging' | 'production' {
  return process.env.EXPO_PUBLIC_APP_ENV?.trim().toLowerCase() === 'staging'
    ? 'staging'
    : 'production';
}

export function isStagingBuild(): boolean {
  return appEnvironment() === 'staging';
}

/*
 * No website address lives here any more. Registration happens in the app,
 * and a shop's subscription is activated and extended by the platform's
 * administrators — the app shows the server's state and says whom to contact.
 * The control website is a separate product and is not included from here
 * (docs/21, 2026-09-22).
 */

export const TOKEN_KEYS = {
  ACCESS_TOKEN: 'erp.accessToken',
  REFRESH_TOKEN: 'erp.refreshToken',
  USER: 'erp.user',
  BRANCH: 'erp.branch',
} as const;
