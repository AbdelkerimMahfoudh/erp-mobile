/**
 * What a notification says, in the reader's language (D225) — pure, for tests.
 *
 *   node lib/notification-copy.test.ts
 *
 * Every catalogued event has a title and a body in English, French and Arabic, composed from the fields the server
 * stored with it: the reference, the amount, the count, the store and the person, in the script the reader reads. The
 * server's stored text is English and is never shown to a French or Arabic reader; a row stored before its fields
 * existed says "open it to see the details" in the reader's language rather than nothing. Values that read
 * left-to-right — references, amounts, dates — and names are isolated (FSI … PDI), so a figure inside an Arabic
 * sentence keeps its own order and does not drag the punctuation around it.
 *
 * The catalogue below mirrors the server's (`src/notifications/notification-catalog.ts`); the parity test holds every
 * entry to a title and a body in all three languages.
 */

export const NOTIFICATION_TYPES = [
  'sale.recorded',
  'stock.received',
  'price.changed',
  'closing.completed',
  'closing.reopened',
  'closing.reclosed',
  'closing.sale',
  'debt.charged',
  'loan.proposed',
  'consignment.requested',
  'discount_approval.requested',
  'discount_approval.approved',
  'discount_approval.rejected',
  'return.requested',
  'return.custody_received',
  'return.under_review',
  'return.approved',
  'return.rejected',
  'return.refund_reported',
  'return.refund_corrected',
  'return.refund_confirmed',
  'transfer.requested',
  'transfer.created_approved',
  'transfer.approved',
  'transfer.rejected',
  'transfer.shipped',
  'transfer.received',
  'transfer.cancelled',
  'anomaly.overdue_debt',
  'anomaly.cash_shortfall',
  'anomaly.below_cost_cluster',
  'staff.role_changed',
  'acting_owner.appointed',
  'acting_owner.revoked',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface CopyFormat {
  money: (amount: number) => string;
  date: (value: string) => string;
  dateTime: (value: string) => string;
}

export interface CopyInput {
  type: string;
  payload: Record<string, unknown> | null;
  /** The store it is about, in both names. */
  branch?: { name: string; nameAr?: string | null } | null;
}

/** First strong isolate … pop directional isolate: the value keeps its own direction inside any sentence. */
export const isolate = (value: string | number): string => `⁨${value}⁩`;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
/** The name in the reader's script, when the Arabic one exists; isolated. */
const named = (latin: unknown, arabic: unknown, language: string): string | null => {
  const name = language === 'ar' ? (str(arabic) ?? str(latin)) : str(latin);
  return name ? isolate(name) : null;
};

/** The key of each type's title. */
export const titleKey = (type: string): string => (NOTIFICATION_TYPES as readonly string[]).includes(type) ? `notifications.kind.${type}` : 'notifications.kind.other';

/**
 * The body for one event, or null when its fields are missing: the caller then says "open it to see the details".
 * Each case names exactly the fields it needs.
 */
function bodyOf(input: CopyInput, t: Translate, language: string, fmt: CopyFormat): string | null {
  const p = input.payload ?? {};
  const items = (count: number) => (count === 1 ? t('transfers.items.one') : t('transfers.items', { count }));
  const money = (v: unknown) => {
    const n = num(v);
    return n === null ? null : isolate(fmt.money(n));
  };
  const event = input.type.split('.').slice(1).join('.');

  switch (input.type) {
    case 'sale.recorded': {
      const ref = str(p.invoiceNo);
      const total = money(p.total);
      const count = num(p.items);
      return ref && total && count !== null ? t('notifications.body.sale.recorded', { ref: isolate(ref), amount: total, items: items(count) }) : null;
    }
    case 'stock.received': {
      const count = num(p.items);
      return count !== null ? t('notifications.body.stock.received', { items: items(count) }) : null;
    }
    case 'price.changed': {
      const product = str(p.product) ? isolate(str(p.product)!) : t('notifications.body.price.aProduct');
      const actor = named(p.actor, p.actorAr, language) ?? t('notifications.body.someone');
      const previous = money(p.previous);
      const next = money(p.next);
      if (next && previous) return t('notifications.body.price.changed', { actor, product, previous, next });
      if (next) return t('notifications.body.price.set', { actor, product, next });
      if (previous) return t('notifications.body.price.removed', { actor, product, previous });
      return null;
    }
    case 'closing.completed': {
      const date = str(p.date);
      const check = str(p.check);
      return date && (check === 'counted' || check === 'attested' || check === 'unverified') ? t(`notifications.body.closing.completed.${check}`, { date: isolate(fmt.date(date)) }) : null;
    }
    case 'closing.reopened':
    case 'closing.reclosed': {
      const date = str(p.businessDate) ?? str(p.date);
      const time = str(p.time);
      return date && time ? t(`notifications.body.closing.${event}`, { date: isolate(fmt.date(date)), time: isolate(time) }) : null;
    }
    case 'closing.sale': {
      const date = str(p.businessDate) ?? str(p.date);
      const time = str(p.time);
      if (!date || !time) return null;
      const total = money(p.total);
      return total ? t('notifications.body.closing.saleAmount', { date: isolate(fmt.date(date)), time: isolate(time), amount: total }) : t('notifications.body.closing.sale', { date: isolate(fmt.date(date)), time: isolate(time) });
    }
    case 'debt.charged': {
      const amount = money(p.amount);
      return amount ? t('notifications.body.debt.charged', { amount }) : null;
    }
    case 'loan.proposed': {
      const from = named(p.from, p.fromAr, language);
      const amount = money(p.amount);
      return from && amount ? t('notifications.body.loan.proposed', { from, amount }) : null;
    }
    case 'consignment.requested': {
      const from = named(p.from, p.fromAr, language);
      const amount = money(p.amount);
      const count = num(p.units);
      return from && amount && count !== null ? t('notifications.body.consignment.requested', { from, amount, items: items(count) }) : null;
    }
    case 'discount_approval.requested': {
      const requested = money(p.requestedPrice);
      const configured = money(p.configuredPrice);
      return requested && configured ? t('notifications.approval.requested.body', { requested, configured }) : null;
    }
    case 'discount_approval.approved': {
      const price = money(p.approvedPrice);
      return price ? t('notifications.approval.approved.body', { price }) : null;
    }
    case 'discount_approval.rejected':
      // The Owner's note is the part worth reading; it is shown as written.
      return str(p.note) ?? t('notifications.approval.rejected.body');
    case 'return.requested':
    case 'return.custody_received':
    case 'return.under_review':
    case 'return.approved':
    case 'return.rejected':
    case 'return.refund_reported':
    case 'return.refund_corrected':
    case 'return.refund_confirmed': {
      const ref = str(p.invoiceNo);
      return ref ? t(`notifications.body.return.${event}`, { ref: isolate(ref) }) : null;
    }
    case 'transfer.requested':
    case 'transfer.created_approved':
    case 'transfer.approved':
    case 'transfer.rejected':
    case 'transfer.shipped':
    case 'transfer.received':
    case 'transfer.cancelled': {
      const count = num(p.units);
      const ref = str(p.transferNo);
      const from = named(p.fromBranch, p.fromBranchAr, language);
      const to = named(p.toBranch, p.toBranchAr, language);
      const actor = named(p.actor, p.actorAr, language) ?? t('notifications.body.someone');
      if (count === null || !ref || !from || !to) return null;
      const body = t(`notifications.transfer.${event}.body`, { ref: isolate(ref), actor, from, to, count: items(count) });
      // A refusal or a cancellation carries why, and that is the part worth reading.
      return str(p.reason) ? `${body} ${str(p.reason)}` : body;
    }
    case 'anomaly.overdue_debt': {
      const count = num(p.count);
      const amount = money(p.amount);
      return count !== null && amount ? t('notifications.body.anomaly.overdue_debt', { count: isolate(count), amount }) : null;
    }
    case 'anomaly.cash_shortfall': {
      const count = num(p.count);
      const days = num(p.days);
      const amount = money(p.amount);
      return count !== null && days !== null && amount ? t('notifications.body.anomaly.cash_shortfall', { count: isolate(count), days: isolate(days), amount }) : null;
    }
    case 'anomaly.below_cost_cluster': {
      const seller = named(p.seller, p.sellerAr, language);
      const count = num(p.count);
      const days = num(p.days);
      return seller && count !== null && days !== null ? t('notifications.body.anomaly.below_cost_cluster', { seller, count: isolate(count), days: isolate(days) }) : null;
    }
    case 'staff.role_changed':
      return p.role === 'store_manager' ? t('notifications.body.staff.manager') : p.role === 'store_employee' ? t('notifications.body.staff.employee') : null;
    case 'acting_owner.appointed': {
      const from = str(p.startsAt);
      if (!from) return null;
      const until = str(p.endsAt);
      return until
        ? t('notifications.body.acting_owner.window', { from: isolate(fmt.dateTime(from)), until: isolate(fmt.dateTime(until)) })
        : t('notifications.body.acting_owner.open', { from: isolate(fmt.dateTime(from)) });
    }
    case 'acting_owner.revoked':
      return t('notifications.body.acting_owner.revoked');
    default:
      return null;
  }
}

/**
 * The title and body, in the reader's language. A type this build does not know reads as "New activity" with the
 * details one tap away — never as a key, never in English to a French or Arabic reader.
 */
export function notificationCopy(input: CopyInput, t: Translate, language: string, fmt: CopyFormat): { title: string; body: string; store: string | null } {
  const known = (NOTIFICATION_TYPES as readonly string[]).includes(input.type);
  const body = (known ? bodyOf(input, t, language, fmt) : null) ?? t('notifications.body.open');
  const store = input.branch ? named(input.branch.name, input.branch.nameAr, language) : null;
  return { title: titleOf(input, t, language) ?? t(titleKey(input.type)), body, store };
}

/** A title that names the record — the transfer's reference and destination, a price decision — when the fields are there. */
function titleOf(input: CopyInput, t: Translate, language: string): string | null {
  const p = input.payload ?? {};
  const event = input.type.split('.').slice(1).join('.');
  if (input.type.startsWith('transfer.') && (NOTIFICATION_TYPES as readonly string[]).includes(input.type)) {
    const ref = str(p.transferNo);
    const to = named(p.toBranch, p.toBranchAr, language);
    return ref && to ? t(`notifications.transfer.${event}.title`, { ref: isolate(ref), to }) : null;
  }
  if (input.type.startsWith('discount_approval.') && (NOTIFICATION_TYPES as readonly string[]).includes(input.type)) return t(`notifications.approval.${event}.title`);
  return null;
}
