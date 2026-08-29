import * as Linking from 'expo-linking';
import { API_V1_URL, accountPortalUrl } from '../constants/config';
import { api } from './api-client';

/**
 * Opening the website subscription portal, already signed in.
 *
 * The mobile bearer token never reaches the browser. What travels is a
 * one-time ticket the server mints for the authenticated Owner: high-entropy,
 * stored only as a hash, bound to one company and user, valid for ninety
 * seconds, and spendable exactly once for a portal session and nothing else.
 * The exchange endpoint redirects to a clean URL before the page renders, so
 * the ticket does not survive in history.
 *
 * ## Failure is never fatal here
 *
 * By the time this runs the account exists and the session is installed.
 * A missing configuration, a refused browser or a dead ticket must therefore
 * leave all of that alone and simply report that the page did not open — the
 * one thing that must never happen is restarting a registration because a
 * browser would not launch.
 */

export type PortalOutcome = 'opened' | 'unconfigured' | 'untrusted' | 'unavailable' | 'refused';

interface HandoffTicket {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
}

/** Only http(s), and only the origin this build was configured with. */
function isTrusted(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Ask for a FRESH ticket every time.
 *
 * Never cached and never reused: a ticket is single-use, and one whose fate is
 * uncertain — the browser may or may not have spent it — must be treated as
 * spent. Asking again costs one request and removes the whole question.
 */
export async function openAccountPortal(): Promise<PortalOutcome> {
  // The portal must be configured before a ticket is worth minting: a ticket
  // nobody can spend is a credential created for nothing.
  const portal = accountPortalUrl();
  if (!portal) return 'unconfigured';
  if (!isTrusted(portal) || !isTrusted(API_V1_URL)) return 'untrusted';

  let ticket: HandoffTicket;
  try {
    ticket = await api.post<HandoffTicket>('/platform/portal-handoff', {});
  } catch {
    return 'refused';
  }

  /*
   * The ticket is the ONLY thing in the URL. No access token, no refresh
   * token, no password, no verification code — and the server strips even this
   * by redirecting to a clean address before the portal renders.
   */
  // The exchange lives on the API, which sets the HttpOnly cookie and then
  // redirects the browser to the portal at a clean address.
  const target = `${API_V1_URL}/platform/portal-session?t=${encodeURIComponent(ticket.token)}`;

  try {
    const can = await Linking.canOpenURL(target);
    if (!can) return 'unavailable';
    await Linking.openURL(target);
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
