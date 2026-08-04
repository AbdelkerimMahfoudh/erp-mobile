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

export const TOKEN_KEYS = {
  ACCESS_TOKEN: 'erp.accessToken',
  REFRESH_TOKEN: 'erp.refreshToken',
  USER: 'erp.user',
  BRANCH: 'erp.branch',
} as const;
