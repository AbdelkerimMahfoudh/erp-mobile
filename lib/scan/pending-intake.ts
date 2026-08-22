/**
 * The scan that survives a detour (milestone O).
 *
 * Receiving a phone whose product does not exist yet means leaving intake,
 * creating the product, and coming back. Before this, `onCreateProduct` did
 * `setPending(null)` and pushed the form — the scanned identifier was simply
 * dropped, so the user returned to an empty screen and scanned the same phone
 * again.
 *
 * ## Two identifiers that must never be confused
 *
 * An **IMEI** identifies one physical phone and belongs in a unit's identifier
 * fields. A **product barcode** identifies a reusable model and belongs on the
 * product. Keeping them in separate fields here — rather than one `code` — is
 * what stops the lost-state defect being "solved" by writing the IMEI into the
 * Product barcode box, which would poison recognition for every unit of that
 * model.
 *
 * ## Scope
 *
 * A pending intake belongs to one person, in one company, at one branch. It is
 * read back only when all three still match, so switching branch or account
 * cannot surface somebody else's scan. Deliberately in memory only: it is a
 * hand-off between two screens in one session, and camera-derived data is not
 * something to leave on disk.
 */

export interface IntakeScope {
  readonly companyId: string;
  readonly userId: string;
  readonly branchId: string;
}

export interface PendingIntake {
  readonly scope: IntakeScope;
  /** The phone. Present whenever the scan was an IMEI. */
  readonly primaryImei: string | null;
  readonly secondaryImei: string | null;
  /** A GENUINE product barcode. Never an IMEI. */
  readonly productBarcode: string | null;
  /** Safe draft fields worth restoring — never a camera frame. */
  readonly cost: string | null;
  /** Set on the way BACK, once product creation succeeded. */
  readonly createdProductId: string | null;
  readonly at: number;
}

export function sameScope(a: IntakeScope, b: IntakeScope): boolean {
  return a.companyId === b.companyId && a.userId === b.userId && a.branchId === b.branchId;
}

/**
 * Build a pending intake from what the scanner accepted.
 *
 * The type of the scan decides which field it lands in, and there is no path
 * from an IMEI to `productBarcode`.
 */
export function pendingFrom(
  scope: IntakeScope,
  input: {
    imei?: { primary: string; secondary: string | null } | null;
    productBarcode?: string | null;
    cost?: string | null;
  },
  now: number = Date.now(),
): PendingIntake {
  return {
    scope,
    primaryImei: input.imei?.primary ?? null,
    secondaryImei: input.imei?.secondary ?? null,
    productBarcode: input.productBarcode ?? null,
    cost: input.cost ?? null,
    createdProductId: null,
    at: now,
  };
}

let held: PendingIntake | null = null;

/** Remember a scan across the Create-product detour. */
export function holdPendingIntake(intake: PendingIntake): void {
  held = intake;
}

/**
 * Read it back, but only for the same person, company and branch.
 *
 * A mismatch returns null rather than throwing: the caller's correct behaviour
 * is simply to start fresh, and a stranded scan is not an error worth a dialog.
 */
export function takePendingIntake(scope: IntakeScope): PendingIntake | null {
  if (!held) return null;
  if (!sameScope(held.scope, scope)) return null;
  const value = held;
  held = null;
  return value;
}

/** Look without consuming — for deciding whether to offer a return path. */
export function peekPendingIntake(scope: IntakeScope): PendingIntake | null {
  if (!held || !sameScope(held.scope, scope)) return null;
  return held;
}

/**
 * Record which product was just created, without consuming the scan.
 *
 * Creating a Product does NOT create the inventory Unit — the unit is still
 * made by the intake submission the user returns to.
 */
export function notePendingProduct(productId: string): void {
  if (held) held = { ...held, createdProductId: productId };
}

/** Cancelling product creation must not throw the scan away; clearing is explicit. */
export function clearPendingIntake(): void {
  held = null;
}
