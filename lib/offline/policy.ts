/**
 * What may happen without the server (Milestone J).
 *
 * This module is the whole safety argument for offline support, written as data
 * so it can be tested rather than remembered. Every mutation in the app appears
 * here exactly once, in one of three classes:
 *
 * - **`local_draft`** — the shop's own half-finished work. Kept on the device,
 *   never sent by itself, and never described as anything but saved here.
 * - **`queueable`** — an append-only *report* of something that already
 *   happened, safe to send late because the server is idempotent about it and
 *   because it moves no stock, settles no money and grants no authority.
 * - **`online_only`** — anything that decides something. It needs the server's
 *   answer to be true at all, so it simply does not happen while disconnected.
 *
 * **The binding decision behind all of it:** there is no server-issued
 * inventory lease. Nothing stops another phone, browser or branch selling the
 * same IMEI while this device is dark. So a sale may be *prepared* offline and
 * may never be *finalized* offline — the customer is not charged and the sale
 * is not shown as complete until the server accepts it. The same reasoning
 * governs every authoritative stock and money operation.
 *
 * A queued payment report means one thing: **waiting to tell the server.** It
 * never means the payment was confirmed.
 */

export type Classification = 'local_draft' | 'queueable' | 'online_only';

export interface OperationSpec {
  /** Stable key. Persisted in the queue, so renaming one is a schema change. */
  kind: string;
  classification: Classification;
  /** Why it is in that class — the sentence that has to survive a rewrite. */
  why: string;
  /**
   * Queueable operations only: the server must already refuse a replay that
   * carries the same key with a different payload. Queueing anything without
   * that is how an edited draft silently reports the old amount.
   */
  idempotency?: 'client_uuid_with_fingerprint' | 'naturally_idempotent';
}

const spec = (
  kind: string,
  classification: Classification,
  why: string,
  idempotency?: OperationSpec['idempotency'],
): OperationSpec => ({ kind, classification, why, idempotency });

/**
 * Every mutation the app can perform.
 *
 * Adding a mutation without adding it here is caught by a test, because an
 * unclassified operation defaults to nothing and `mayQueue` refuses it.
 */
export const OPERATIONS: readonly OperationSpec[] = [
  // ── Selling and stock: authority, all of it ───────────────────────────────
  spec('sale.create', 'online_only',
    'No inventory lease exists, so nothing can promise this IMEI is still unsold. Charging a customer for a phone another branch just sold is the failure this whole milestone exists to prevent'),
  spec('unit.quickAdd', 'online_only', 'Activating stock makes a phone sellable in every branch at once'),
  spec('purchase.create', 'online_only', 'Receiving finalization activates stock and commits what it cost'),
  spec('import.commit', 'online_only', 'Committing an import activates inventory in bulk, which is the largest single act in the app'),
  spec('product.create', 'online_only', 'The catalogue is shared truth; two devices inventing the same product offline makes two products'),
  spec('product.update', 'online_only', 'Editing a shared product changes what every branch sees, and two offline edits would silently overwrite each other'),
  spec('product.archive', 'online_only', 'Hiding a product from every branch at once is a decision, not a local preference'),
  spec('category.create', 'online_only', 'Two devices inventing the same category offline gives the shop two categories and no way to merge them'),
  spec('category.update', 'online_only', 'Renaming a category reorganises what everybody else is looking at'),
  spec('price.set', 'online_only', 'A price change is authority, and a stale replayed one silently undersells'),
  spec('price.remove', 'online_only', 'Dropping back to the default price is a live pricing decision, and a replayed one could undo a newer deliberate price'),
  spec('sale.belowCostOverride', 'online_only', 'A manager granting an exception must be a live decision, not one replayed an hour later'),

  // ── Transfers: every step moves stock ─────────────────────────────────────
  spec('transfer.create', 'online_only', 'Reserves units, and a reservation that is not the server\'s is not a reservation'),
  spec('transfer.approve', 'online_only', 'Approval commits the sending branch to give the stock up'),
  spec('transfer.ship', 'online_only', 'Shipping hands custody over, and both branches must agree when'),
  spec('transfer.receive', 'online_only', 'Receiving puts the phones back on a shelf and makes them sellable again'),
  spec('transfer.cancel', 'online_only', 'Cancelling frees reserved units for anybody to sell; doing that late frees stock twice'),

  // ── Consignment: crosses a company boundary ───────────────────────────────
  spec('consignment.create', 'online_only', 'Reserves units and notifies another company'),
  spec('consignment.decide', 'online_only', 'Acceptance binds two companies to an amount that then cannot change'),
  spec('consignment.custody', 'online_only', 'Custody is a physical fact both companies must agree on at the time'),
  spec('consignment.sold', 'online_only', 'Disposition is where profit is recognised, and it can only happen once'),
  spec('consignment.return', 'online_only', 'Moves stock back, and decides whether it is saleable'),
  spec('consignment.payment.confirm', 'online_only', 'Confirming settles money between two companies'),
  spec('consignment.payment.correct', 'online_only', 'Reverses money two companies had agreed was settled'),
  spec('consignment.forgive', 'online_only', 'Writing a debt off is authority, and it is not reversible by a retry'),
  spec('connection.request', 'online_only', 'Asking another company for trust should reach them while somebody is there to answer'),
  spec('connection.decide', 'online_only', 'Accepting a connection opens your shop to another company immediately'),
  spec('connection.block', 'online_only', 'Blocking must take effect the moment it is decided, not whenever the wifi returns'),
  spec('counterparty.create', 'online_only', 'Creates a record that other operations immediately reference by id, so a late one orphans them'),

  // ── Loans ─────────────────────────────────────────────────────────────────
  spec('loan.create', 'online_only', 'A proposal notifies the other side; a queued one would sit invisible to the person meant to answer it'),
  spec('loan.decide', 'online_only', 'Acceptance fixes a principal that is immutable from that moment'),
  spec('loan.payment.confirm', 'online_only', 'Confirming a repayment settles money and reduces a real debt'),
  spec('loan.payment.correct', 'online_only', 'Reverses a repayment the creditor had already accepted'),
  spec('loan.forgive', 'online_only', 'Writing a debt off is authority, and only the creditor holds it'),

  // ── Returns and refunds ───────────────────────────────────────────────────
  spec('return.create', 'online_only', 'Opens a case against a specific sale, and takes custody of a phone'),
  spec('return.custody', 'online_only', 'Taking a customer\'s phone in is a physical handover somebody is accountable for from that moment'),
  spec('return.investigation', 'online_only', 'Deciding whose fault a fault was determines who pays for it'),
  spec('return.approve', 'online_only', 'Authorises money back to a customer'),
  spec('return.reject', 'online_only', 'Refusing a refund is a decision the customer is standing there waiting for'),
  spec('return.adjustments', 'online_only', 'Changes what the shop owes the customer, item by item'),
  spec('return.refund.confirm', 'online_only', 'Confirming settles money that has actually left the till'),
  spec('return.refund.correct', 'online_only', 'Reverses a refund the shop has already recorded as paid'),

  // ── Money, closing and corrections ────────────────────────────────────────
  spec('closing.count', 'online_only',
    'The counted figure is compared against a server-computed expectation. Submitting blind would record a difference against the wrong day'),
  spec('closing.signOff', 'online_only', 'Locking a day is final, and a replayed lock would close the wrong day'),
  spec('discrepancy.resolve', 'online_only', 'Assigns responsibility, repayment or forgiveness for a shortage — all three name a person'),
  spec('correction.create', 'online_only', 'A financial correction rewrites what the books say happened'),
  spec('correction.approve', 'online_only', 'Approving one makes the rewrite real'),
  spec('correction.reject', 'online_only', 'Refusing one leaves the original standing, which is equally a decision'),
  spec('expense.confirm', 'online_only', 'Confirming an expense releases money from the shop'),
  spec('expense.reject', 'online_only', 'Refusing one is equally a decision somebody is waiting on'),
  spec('supplier.payment.confirm', 'online_only', 'Settles a payable, which is money that has left the business'),
  spec('supplier.payment.correct', 'online_only', 'Reverses a payable the shop had recorded as settled'),
  spec('supplier.create', 'online_only', 'Two offline devices adding the same supplier gives the shop two payable ledgers for one person'),
  spec('supplier.update', 'online_only', 'Supplier details are shared, and a stale replay would overwrite a newer correction'),

  // ── Goals, people, settings, identity ─────────────────────────────────────
  spec('goal.create', 'online_only', 'Sets a target other people are then measured against'),
  spec('goal.archive', 'online_only', 'Retiring a target changes what a whole branch is measured against'),
  spec('user.update', 'online_only', 'Changes who can do what, and a late replay could restore access somebody just removed'),
  spec('settings.update', 'online_only', 'Company-wide policy that every branch reads'),
  spec('receivingAccount.create', 'online_only', 'Where money is received is policy, not a local note'),
  spec('receivingAccount.update', 'online_only', 'Changing where money lands is exactly the setting an attacker would want replayed late'),
  spec('auth.login', 'online_only', 'Authentication is the server\'s answer, by definition'),
  spec('auth.logout', 'online_only', 'Revoking a session must reach the server to mean anything'),
  spec('device.adopt', 'online_only', 'Granting a device trust is the one thing that must never happen from an untrusted queue'),
  spec('device.revoke', 'online_only', 'Revoking a lost phone must reach the server to mean anything at all'),

  // ── The four that may wait ────────────────────────────────────────────────
  spec('expense.submit', 'queueable',
    'A report of money already spent. It grants nothing — somebody still has to confirm it — and the server refuses a replay whose payload changed',
    'client_uuid_with_fingerprint'),
  spec('loan.payment.report', 'queueable',
    'Says "I paid you". Balance effect is zero until the creditor confirms, so arriving late costs nothing but time',
    'client_uuid_with_fingerprint'),
  spec('consignment.payment.report', 'queueable',
    'The same claim, about consigned stock, with the same zero balance effect',
    'client_uuid_with_fingerprint'),
  spec('notification.read', 'queueable',
    'Sets a flag on the reader\'s own notification. Replaying it reaches the same state, and it touches no business record at all',
    'naturally_idempotent'),
] as const;

const BY_KIND = new Map(OPERATIONS.map((o) => [o.kind, o]));

export function specFor(kind: string): OperationSpec | undefined {
  return BY_KIND.get(kind);
}

/**
 * Fail closed. An operation nobody classified is treated as authority, because
 * the alternative — assuming a new mutation is safe to replay — is how a
 * milestone from now quietly queues something that moves stock.
 */
export function classify(kind: string): Classification {
  return BY_KIND.get(kind)?.classification ?? 'online_only';
}

export function mayQueue(kind: string): boolean {
  return classify(kind) === 'queueable';
}

export const QUEUEABLE_KINDS: readonly string[] = OPERATIONS.filter(
  (o) => o.classification === 'queueable',
).map((o) => o.kind);

/**
 * Forms a shop may fill in offline and keep.
 *
 * Separate from the operation list because a draft is not an operation — it is
 * the shop's own unfinished work, and the thing it will eventually become is
 * usually `online_only`. A Sell cart may be built offline; charging for it may
 * not. Both facts live here so neither can drift.
 */
export const DRAFTABLE_FORMS: readonly { form: string; becomes: string; note: string }[] = [
  { form: 'sell.cart', becomes: 'sale.create', note: 'Cart survives; Charge is disabled until the server can answer' },
  { form: 'receive.preparation', becomes: 'purchase.create', note: 'Scanned list survives; nothing is activated' },
  { form: 'import.preparation', becomes: 'import.commit', note: 'A chosen file and its preview are not an import' },
  { form: 'expense.form', becomes: 'expense.submit', note: 'The only draft whose submission may itself be queued' },
  { form: 'return.preparation', becomes: 'return.create', note: 'Details survive; opening the case does not' },
  { form: 'consignment.proposal', becomes: 'consignment.create', note: 'Drafting must not imply the other store was told' },
  { form: 'loan.proposal', becomes: 'loan.create', note: 'Same — nobody has been notified' },
  { form: 'closing.counts', becomes: 'closing.count', note: 'Counted values survive; the day cannot be closed' },
  { form: 'goal.form', becomes: 'goal.create', note: 'A target nobody has been set yet' },
] as const;

/**
 * The words a screen may use about work that has not reached the server.
 *
 * Listed so a test can refuse the ones that lie. "Sent", "reserved", "paid",
 * "approved" and "completed" all claim something the server has not agreed to,
 * and an employee who reads one of them stops checking.
 */
export const FORBIDDEN_DRAFT_WORDS: readonly string[] = [
  'sent',
  'reserved',
  'paid',
  'approved',
  'completed',
  'confirmed',
] as const;
