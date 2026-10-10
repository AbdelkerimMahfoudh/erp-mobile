import { ApiError } from './api-client';
import { agentRefusal, QUEUE_ONLY_REFUSALS } from './agent-rules';
import { IncompatibleResponse } from './contract';
import { t, type TranslationKey } from './i18n';

/**
 * Turn any thrown value into something a shop employee can act on.
 *
 * UX rule: no cryptic errors or codes. The backend speaks problem+json and its
 * `message` is already written for humans, so we prefer it — but we never let a
 * raw status code, a stack trace or `[object Object]` reach the screen.
 */

export interface FriendlyError {
  titleKey: TranslationKey;
  title: string;
  /** The specific, actionable line. Server wording wins when it has some. */
  body: string;
  /** Retrying can plausibly succeed — controls whether we offer the button. */
  retryable: boolean;
  /** Blocked by role rather than broken; the UI shows this differently. */
  permissionDenied: boolean;
  status?: number;
}

function generic(titleKey: TranslationKey, bodyKey: TranslationKey, retryable: boolean): FriendlyError {
  return {
    titleKey,
    title: t(titleKey),
    body: t(bodyKey),
    retryable,
    permissionDenied: false,
  };
}

/** The server answered in a shape this app cannot read — its figures are withheld, not zeroed (docs/54). */
export function isIncompatible(error: unknown): boolean {
  return error instanceof IncompatibleResponse;
}

export function toFriendlyError(error: unknown): FriendlyError {
  // A server older than the app: nothing it sent is shown, and the fix is on the server, not a retry (docs/54).
  if (error instanceof IncompatibleResponse) {
    return generic('contract.incompatible.title', 'contract.incompatible.body', true);
  }

  if (error instanceof ApiError) {
    // The business's access has ended (docs/21, 2026-10-05): not a role, not a
    // fault. The code is matched, never the English; the app's own words say
    // what still works.
    if (error.status === 403 && error.code === 'ENTITLEMENT_WRITE_BLOCKED') {
      return {
        titleKey: 'access.blocked.title',
        title: t('access.blocked.title'),
        body: t('access.blocked.body'),
        retryable: false,
        permissionDenied: false,
        status: error.status,
      };
    }

    // 403 is a role boundary, not a fault. Saying "something went wrong" here
    // teaches employees to distrust the app; say what is actually true.
    if (error.status === 403) {
      return {
        titleKey: 'state.error.permission.title',
        title: t('state.error.permission.title'),
        body: error.message || t('state.error.permission.body'),
        retryable: false,
        permissionDenied: true,
        status: error.status,
      };
    }

    if (error.status === 404) {
      return {
        titleKey: 'state.error.notFound.title',
        title: t('state.error.notFound.title'),
        body: error.message || t('state.error.body'),
        retryable: false,
        permissionDenied: false,
        status: error.status,
      };
    }

    // 4xx carries a specific, already-human reason from the server — surface it
    // verbatim ("This IMEI has already been sold"). 5xx messages are internal.
    const serverSpoke = error.status < 500 && Boolean(error.message);
    return {
      titleKey: 'state.error.title',
      title: t('state.error.title'),
      body: serverSpoke ? error.message : t('state.error.body'),
      retryable: error.status >= 500 || error.status === 429,
      permissionDenied: false,
      status: error.status,
    };
  }

  // fetch() rejects with a TypeError when the device cannot reach the server —
  // the shop's internet dropped, or the backend is down.
  if (error instanceof TypeError) {
    return generic('state.error.offline.title', 'state.error.offline.body', true);
  }

  return generic('state.error.title', 'state.error.body', true);
}

/**
 * A refusal of the money services counter, in the counter's own words (D155):
 * a newer rate, a closed store, a branch not set up for the activity, a number
 * or a reference the server would not take — each named by its code, never by
 * the server's English, and each saying whether trying again can help. Anything
 * else is the ordinary friendly error.
 */
export function toAgentError(error: unknown): FriendlyError {
  const refusal = error instanceof ApiError && !QUEUE_ONLY_REFUSALS.includes(error.code ?? '') ? agentRefusal(error.code) : null;
  if (!refusal || !(error instanceof ApiError)) return toFriendlyError(error);
  return {
    titleKey: 'agent.refusal.title',
    title: t('agent.refusal.title'),
    body: t(refusal.key as TranslationKey),
    retryable: refusal.action === 'send_again',
    permissionDenied: false,
    status: error.status,
  };
}

/** One-line form, for toasts where a title and body would be too much. */
export function toErrorMessage(error: unknown): string {
  return toFriendlyError(error).body;
}
