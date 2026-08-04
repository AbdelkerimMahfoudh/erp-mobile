import { ApiError } from './api-client';
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

export function toFriendlyError(error: unknown): FriendlyError {
  if (error instanceof ApiError) {
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

/** One-line form, for toasts where a title and body would be too much. */
export function toErrorMessage(error: unknown): string {
  return toFriendlyError(error).body;
}
