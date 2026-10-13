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
 * and on any restart of the flow. A spent continuation is refused by the server
 * anyway, but leaving one on the device is leaving credential material lying
 * around for no reason.
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
