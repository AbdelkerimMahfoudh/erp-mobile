import { useCallback, useRef, useState } from 'react';
import { openAccountPortal, type PortalOutcome } from '../lib/portal';
import { useTranslation } from '../lib/i18n';

/**
 * Opening the subscription portal, signed in, from anywhere in the app.
 *
 * There is exactly one way to reach that page and this is it. The security is
 * all in {@link openAccountPortal} — a fresh single-use ticket per attempt, an
 * origin taken from build configuration rather than any response, no token in
 * the URL — and duplicating that reasoning at a second call site is how two
 * implementations become one secure and one nearly secure.
 *
 * The pending screen used to open `accountPortalUrl()` directly. It is the one
 * screen where somebody actually taps "manage my subscription", and it was the
 * one place that skipped the handoff entirely: an authenticated Owner arrived
 * at the website and was shown a password form.
 *
 * ## The guard is a ref, not state
 *
 * `if (busy) return; setBusy(true)` reads a value React has not updated yet.
 * Two taps in the same frame both see `false`, both pass, and both mint a
 * ticket — one of which is then abandoned unspent. A ref changes on the
 * assignment, so the second tap sees the first.
 *
 * ## Failure is never fatal
 *
 * By the time this runs the caller is authenticated. A refused browser, a
 * missing configuration or a dead ticket must leave that alone and say so.
 * Nothing here signs anybody out, clears storage or loads shop data.
 */
export interface AccountPortalState {
  /** Open the portal. Safe to call from an `onPress` without awaiting. */
  open: () => Promise<PortalOutcome>;
  /** True while a ticket is being minted or a browser opened. */
  opening: boolean;
  /** Localized, and only set when something went wrong. */
  message: string | null;
  /** Clear the message — for a screen that shows it inline. */
  dismiss: () => void;
}

export function useAccountPortal(): AccountPortalState {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const open = useCallback(async (): Promise<PortalOutcome> => {
    // Synchronous, so two taps in one frame cannot both get through.
    if (inFlight.current) return 'refused';
    inFlight.current = true;
    setOpening(true);
    setMessage(null);

    try {
      /*
       * Every attempt asks for a NEW ticket. A ticket whose fate is uncertain —
       * the browser may or may not have spent it — is treated as spent, because
       * asking again costs one request and removes the whole question.
       */
      const outcome = await openAccountPortal();
      if (outcome !== 'opened') {
        /*
         * One message for every failure. The distinctions that matter to us —
         * unconfigured, untrusted, refused, unavailable — are all the same
         * sentence to a shopkeeper: it did not open, nothing is broken, try
         * again. Naming which one would only invite the wrong fix.
         */
        setMessage(t('register.portal.failed'));
      }
      return outcome;
    } finally {
      inFlight.current = false;
      setOpening(false);
    }
  }, [t]);

  const dismiss = useCallback(() => setMessage(null), []);

  return { open, opening, message, dismiss };
}
