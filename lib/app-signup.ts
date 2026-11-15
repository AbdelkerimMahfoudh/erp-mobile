import { Platform } from 'react-native';

/**
 * Whether this app may create a business account (owner, 2026-11-15).
 *
 * App Review refused iOS 1.0 under guideline 3.1.1: an app that registers businesses, whose access is then paid outside
 * In-App Purchase, offers an external purchase path. On iOS the app therefore only signs in — an existing Owner, or an
 * employee joining with the Owner's invitation — and a business is created on the web. Nothing on iOS says where or
 * how to sign up, or mentions a price. Android keeps the in-app registration.
 */
export const APP_SIGNUP_ENABLED: boolean = Platform.OS !== 'ios';
