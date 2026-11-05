import { notificationRoute, type NotificationOpen, type NotificationTarget } from './notification-route.ts';

/**
 * Opening a notification without an intermediate screen (D225; the owner's Build 6 fix, 2026-11-05).
 *
 * The server decides, at the moment of opening, whether the record still exists and whether this person may open it
 * (`GET /notifications/:id/open`). That answer is awaited BEFORE any navigation, so the person goes straight from where
 * they are to the record — never through a screen that shows a skeleton and then gives way. While one opening is being
 * resolved a second tap does nothing, so a double tap cannot open the record twice.
 *
 * On success the notification is marked read (once it is really opened), the record's own store is made active when it
 * is another of the person's stores, and the record's screen is pushed onto the current stack: Back leads where it
 * always did. When it cannot be opened — removed, no longer the person's, a kind this build does not know, or the
 * server not answering — the person is taken to the notifications with a sentence saying why.
 *
 *   node lib/navigation/open-notification.test.ts
 */
export type OpenFailure = 'unavailable' | 'unauthorized' | 'failed';

export type OpenOutcome = { kind: 'opened'; route: string } | { kind: 'fallback'; reason: OpenFailure } | { kind: 'busy' };

export interface OpenDeps {
  /** `GET /notifications/:id/open`. */
  ask(id: string): Promise<NotificationOpen>;
  /** `POST /notifications/:id/read` — never awaited by the navigation, and a failure is ignored. */
  markRead(id: string): Promise<unknown>;
  /** The active store, and a way to make another of the person's stores active (false when it is not theirs). */
  activeBranch(): string | null;
  switchBranch(branchId: string): Promise<boolean>;
  /** The reader, for the kinds that open the reader's own record. */
  me(): string | null;
  /**
   * Navigation: push the record onto the current stack — given the server's target, whose route the caller derives
   * with `notificationRoute` (the registry the navigation rules check) — or show the notifications with the reason.
   */
  push(target: NotificationTarget): void;
  fallback(reason: OpenFailure): void;
}

/** One opener per app: its lock is the guard against a double tap, from the centre or from a push. */
export function createNotificationOpener(deps: OpenDeps) {
  let busy = false;
  return async function open(id: string): Promise<OpenOutcome> {
    if (busy) return { kind: 'busy' };
    busy = true;
    try {
      let answer: NotificationOpen;
      try {
        answer = await deps.ask(id);
      } catch {
        deps.fallback('failed');
        return { kind: 'fallback', reason: 'failed' };
      }
      if (answer.status === 'unauthorized') {
        deps.fallback('unauthorized');
        return { kind: 'fallback', reason: 'unauthorized' };
      }
      const route = answer.status === 'ok' ? notificationRoute(answer.target, deps.me()) : null;
      if (answer.status !== 'ok' || !route) {
        deps.fallback('unavailable');
        return { kind: 'fallback', reason: 'unavailable' };
      }
      void deps.markRead(id).catch(() => undefined);
      // The record belongs to one of the person's stores: it is opened there, as its screen reads the active store.
      if (answer.branchId && answer.branchId !== deps.activeBranch()) {
        await deps.switchBranch(answer.branchId).catch(() => false);
      }
      deps.push(answer.target);
      return { kind: 'opened', route };
    } finally {
      busy = false;
    }
  };
}
