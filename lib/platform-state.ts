import type { PlatformState } from './platform-admin';

/** The colour that goes with each state — the word always travels beside it. */
export function platformStateTone(state: PlatformState): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (state) {
    case 'active':
    case 'complimentary':
      return 'success';
    case 'pending':
    case 'grace':
      return 'warning';
    case 'expired':
      return 'neutral';
    case 'suspended':
    case 'cancelled':
    case 'rejected':
      return 'danger';
    default:
      return 'info';
  }
}

export type PlatformAction = 'approve' | 'reject' | 'extend' | 'period' | 'suspend' | 'reinstate' | 'cancel' | 'invite';

/**
 * Which actions a business in this state offers. The server refuses the rest
 * anyway; showing only what applies is what keeps the screen readable.
 */
export function actionsFor(state: PlatformState): PlatformAction[] {
  switch (state) {
    case 'pending':
      return ['approve', 'reject', 'invite'];
    case 'rejected':
      return ['approve', 'invite'];
    case 'active':
    case 'grace':
    case 'expired':
    case 'complimentary':
      return ['extend', 'period', 'suspend', 'cancel', 'invite'];
    case 'suspended':
      return ['reinstate', 'cancel', 'invite'];
    case 'cancelled':
      return ['invite'];
    default:
      return [];
  }
}

/** The actions that take access away, and therefore need a reason and a harder confirmation. */
export function isHighImpact(action: PlatformAction): boolean {
  return action === 'reject' || action === 'suspend' || action === 'cancel' || action === 'period';
}

export function needsReason(action: PlatformAction): boolean {
  return isHighImpact(action);
}

export function needsMonths(action: PlatformAction): boolean {
  return action === 'approve' || action === 'extend';
}

export function needsDate(action: PlatformAction): boolean {
  return action === 'period';
}

/** A whole number of months, 1 to 60 — what the server accepts. */
export function monthsValid(value: string): boolean {
  return /^\d{1,2}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 60;
}

/** `YYYY-MM-DD`, a real calendar date, after today. Sent to the server as the end of that day, UTC. */
export function periodEndValid(value: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const at = new Date(`${value.trim()}T23:59:59.000Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value.trim() && at.getTime() > now.getTime();
}

export function periodEndInstant(value: string): string {
  return new Date(`${value.trim()}T23:59:59.000Z`).toISOString();
}

/**
 * The catalogue key that names an audit action in words. Actions that are
 * lifecycle acts reuse the action labels; the rest have their own. Unknown
 * actions fall back to the code itself, so nothing is hidden.
 */
export function auditActionKey(action: string): string | null {
  switch (action) {
    case 'subscription.approve':
      return 'platform.action.approve';
    case 'subscription.reject':
      return 'platform.action.reject';
    case 'subscription.extend':
      return 'platform.action.extend';
    case 'subscription.set_period':
      return 'platform.action.period';
    case 'subscription.suspend':
      return 'platform.action.suspend';
    case 'subscription.reinstate':
      return 'platform.action.reinstate';
    case 'subscription.cancel':
      return 'platform.action.cancel';
    case 'subscription.activate_grant':
      return 'platform.event.administrative_grant';
    case 'owner_invitation.issue':
      return 'platform.action.invite';
    case 'owner_invitation.accept':
      return 'platform.auditAction.invitationAccepted';
    case 'business.create':
      return 'platform.new.title';
    case 'admin.sign_in':
      return 'platform.auditAction.signIn';
    case 'payment.record':
    case 'payment.record_and_confirm':
      return 'platform.auditAction.paymentRecorded';
    case 'plan.schedule':
      return 'platform.auditAction.planScheduled';
    default:
      return null;
  }
}
