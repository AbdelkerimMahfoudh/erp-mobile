import * as Linking from 'expo-linking';
import { signupUrl } from '../constants/config';

/**
 * Open the account-creation website.
 *
 * Three things can go wrong and each is reported distinctly, because "nothing
 * happened" is the worst possible answer to tapping a button:
 *
 *  - nothing is configured, so there is no site to open;
 *  - the device has no browser willing to handle the URL;
 *  - the handoff itself failed.
 *
 * Never throws. A failure here must not take the sign-in screen down with it.
 */
export type SignupOutcome = 'opened' | 'unconfigured' | 'unavailable';

/** Only http(s), and only a URL this build was configured with. */
function isSafe(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function openSignup(): Promise<SignupOutcome> {
  const url = signupUrl();
  if (!url || !isSafe(url)) return 'unconfigured';

  try {
    const can = await Linking.canOpenURL(url);
    if (!can) return 'unavailable';
    await Linking.openURL(url);
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
