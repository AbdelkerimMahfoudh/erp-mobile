/**
 * The one thing somebody types to sign in (CP3).
 *
 * The **server** is the authority on what an identifier means — it classifies,
 * normalises and resolves it. This file exists for two much smaller jobs the
 * client genuinely owns:
 *
 * 1. Deciding whether the Sign in button may be pressed.
 * 2. Producing a stable namespace for the device credential, which has to be
 *    chosen *before* the server has said anything.
 *
 * It deliberately does **not** decide whether an identifier is valid. Guessing
 * that here would let the app refuse something the server would have accepted,
 * and the shopkeeper would have no way to argue with it.
 */

/**
 * A stable key for the device credential belonging to this identifier.
 *
 * Before CP3 the credential was namespaced by Store ID plus login, both known
 * before the request. Neither is now: the whole point is that nobody names
 * their shop to sign in. So the namespace is the identifier itself, folded to
 * one form so `4321 0987` and `43210987` are the same person's device.
 *
 * If somebody signs in by phone one day and by personal ID the next, the second
 * finds no credential and the server enrols a new device. That is safe —
 * enrolment happens only after the password is verified — and it is far better
 * than presenting a credential belonging to a different key, which the server
 * would fail closed on and which would lock them out.
 */
export function credentialNamespace(identifier: string): string {
  return identifier.trim().toUpperCase().replace(/[\s\-().+]/g, '');
}

/**
 * Whether there is enough here to bother asking the server.
 *
 * Deliberately generous: anything non-empty is worth a try. The server decides
 * what it recognises, and a client that pre-judged the format would eventually
 * reject a real identifier somebody actually holds.
 */
export function looksSubmittable(identifier: string): boolean {
  return identifier.trim().length > 0;
}
