import { deleteItem, getItem, setItem } from './storage';

/**
 * The registration continuation, while a registration is being finished.
 *
 * It is not a session and authorises no request, but it is the credential that
 * completes a registration — so it lives in the same secure storage as the
 * session tokens, and nowhere else. Never in AsyncStorage, a URL, a log, an
 * analytics event or a crash report.
 *
 * It is removed the moment it stops being needed: on success, on cancellation,
 * on any restart of the flow, and whenever the sign-in or sign-up screen is
 * shown — whoever is there is not in the middle of a code check, so a
 * registration left unfinished takes its continuation with it the next time
 * the app opens. A spent continuation is refused by the server anyway, but
 * leaving one on the device is leaving credential material lying around for
 * no reason.
 *
 * Why storage and not memory alone: the code check can be reopened without
 * passing through sign-in — a reload of the web build at its address, or a
 * link straight to it — because the sign-in guard leaves the screens of the
 * (auth) group alone (`lib/navigation/entry.ts`). Held only in memory, the
 * continuation would be gone there, and the person's only way on would be a
 * second registration.
 */

const CONTINUATION_KEY = 'erp.registration.continuation';

export async function rememberContinuation(token: string): Promise<void> {
  await setItem(CONTINUATION_KEY, token);
}

export async function readContinuation(): Promise<string | null> {
  return getItem(CONTINUATION_KEY);
}

export async function forgetContinuation(): Promise<void> {
  await deleteItem(CONTINUATION_KEY);
}
