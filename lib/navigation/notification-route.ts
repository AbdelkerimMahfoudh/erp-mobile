/**
 * The screen each kind of notification opens (D225) — a registry, like the tabs and the entry routes: the app's own
 * paths, written out here, with an id the server re-authorised a moment ago (`GET /notifications/:id/open`).
 *
 * The server sends a KIND and an id, never a path to follow. A kind this build does not know opens nothing, and the
 * id is used only when it has the shape of an id, so nothing the server says can lead out of the app or to a screen
 * that is not this kind's.
 *
 *   node lib/navigation/notification-route.test.ts
 */

export type NotificationTargetKind =
  | 'sale'
  | 'return'
  | 'approval'
  | 'transfer'
  | 'loan'
  | 'consignment'
  | 'discrepancy'
  | 'expense'
  | 'closing_day'
  | 'stock'
  | 'product'
  | 'analytics'
  | 'staff'
  | 'acting_owner';

export interface NotificationTarget {
  kind: string;
  id: string | null;
  detail: string | null;
}

/** What opening a notification found, decided by the server when it was opened. */
export type NotificationOpen =
  | { status: 'ok'; target: NotificationTarget; branchId: string | null }
  | { status: 'unavailable' }
  | { status: 'unauthorized' }
  | { status: 'no_destination' };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The screen for a destination, or null: an unknown kind, or an id that is not one. `me` is the reader's own id. */
export function notificationRoute(target: NotificationTarget, me: string | null): string | null {
  const id = target.id && ID.test(target.id) ? target.id : null;
  switch (target.kind) {
    case 'sale':
      return id ? `/sales/${id}` : null;
    case 'return':
      return id ? `/returns/${id}` : null;
    case 'approval':
      return id ? `/approvals/${id}` : null;
    case 'transfer':
      return id ? `/transfers/${id}` : null;
    case 'loan':
      return id ? `/loans/${id}` : null;
    case 'consignment':
      return id ? `/consignments/${id}` : null;
    case 'discrepancy':
      return id ? `/discrepancies/${id}` : null;
    case 'expense':
      return id ? `/expenses/${id}` : null;
    case 'closing_day':
      return target.detail && DAY.test(target.detail) ? `/closing?date=${target.detail}` : '/closing';
    case 'stock':
      return '/inventory';
    case 'product':
      return id ? (target.detail && ID.test(target.detail) ? `/catalog/${id}?unit=${target.detail}` : `/catalog/${id}`) : null;
    case 'analytics':
      return '/analytics';
    case 'staff':
      // Your own role change opens your account; somebody else's, the team.
      return id && id === me ? '/account' : '/team';
    case 'acting_owner':
      return '/acting-owner';
    default:
      return null;
  }
}

/** The notification a push carries, from its data — only an id of the right shape; everything else is ignored. */
export function pushedNotificationId(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as Record<string, unknown>).notificationId : null;
  return typeof id === 'string' && ID.test(id) ? id : null;
}

/**
 * Each notification opened once per tap. A push tapped in the background is reported by the listener AND by
 * "the last response" when the app starts; a cold start can be reported twice. The response's own identifier keys it,
 * so the same tap never navigates twice — and a later tap on the same notification does.
 */
export function createOpenGate(limit = 50) {
  const seen: string[] = [];
  return (key: string): boolean => {
    if (seen.includes(key)) return false;
    seen.push(key);
    if (seen.length > limit) seen.shift();
    return true;
  };
}
