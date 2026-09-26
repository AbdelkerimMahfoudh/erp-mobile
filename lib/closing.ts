import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import { invalidateMoney } from './money-invalidation';
import type { DayStanding, ReopenMode } from './home-day';

/**
 * The progressive daily closing (Milestone E).
 *
 * Counting and signing off are two different acts by two possibly different
 * people. Whoever holds the drawer records what is in it (`closing.count`);
 * whoever is accountable for the day signs it off (`closing.perform`). Before
 * E these were one permission, so the person actually holding the money could
 * not report a count at all.
 *
 * The screens must never blur that line: recording a count locks nothing, and
 * nothing on the counting screen should suggest otherwise.
 */

export type ChannelKind = 'cash' | 'account';

export interface ChannelRow {
  channel: ChannelKind;
  accountId: string | null;
  labelSnapshot: string;
  /** Non-cash money that named no account. Reported, but not reconcilable. */
  isUnattributed: boolean;
  countable: boolean;
  salesIn: number;
  refundsOut: number;
  supplierOut: number;
  expensesOut: number;
  correctionsIn: number;
  /** A payment reclassified out of this channel (0078). */
  correctionsOut: number;
  expected: number;
  /** `null` means genuinely not counted yet — never the same as counted zero. */
  counted: number | null;
  difference: number | null;
  isSkipped: boolean;
  skipReason: string | null;
  countedAt: string | null;
}

export type ClosingStatus = 'counting' | 'counted' | 'locked' | 'reopened';

/**
 * One entry of the business day's timeline (0076, 0077): a count, a close, a
 * reopen, the boutique's opening, the first sale ("First activity"), a sale
 * after the close — each at its store-local date and time.
 */
export interface ClosingHistoryEntry {
  kind: 'count_saved' | 'closed' | 'reopened' | 'auto_reopened' | 'reclosed' | 'day_started_early' | 'opened' | 'first_activity' | 'sale' | string;
  at: string;
  /** The store's wall clock, YYYY-MM-DD and HH:mm — never the phone's zone. */
  localDate: string;
  localTime: string;
  actor: string | null;
  payload: Record<string, unknown>;
}

/** Whether the boutique is physically open on a date, from its recorded openings and closes (0077). */
export type DoorState = 'never_opened' | 'open' | 'closed';

export interface DayOpening {
  kind: 'opened' | 'reopened' | 'auto_reopened' | string;
  at: string;
  actor: string | null;
  localDate: string;
  localTime: string;
}

export interface OpenClosing {
  date: string;
  businessDate: string;
  /** The branch's current business date, which may differ from the day being viewed. */
  today: string;
  timezone: string;
  standing: DayStanding;
  status: ClosingStatus;
  isLocked: boolean;
  channels: (ChannelRow & { openingBalance: number; stale: boolean })[];
  outstanding: number;
  complete: boolean;
  /** The day was reopened and at least one count predates the reopen. */
  freshCountRequired: boolean;
  stale: string[];
  expectedCash: number;
  openingCash: number;
  sinceLastCount: number | null;
  lastCountedAt: string | null;
  /** The last count's store-local time, HH:mm. */
  lastCountedLocalTime: string | null;
  firstClosedAt: string | null;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
  canReopen: boolean;
  reopenRefusal: 'not_closed' | 'past_day' | 'future_day' | null;
  reopenChoices: ReopenMode[];
  /**
   * What "Open the boutique" may choose (docs/56): `start_new` joins `continue` before
   * 06:00 for the Owner alone. Absent on an older server, which offers no choice.
   */
  openChoices?: ReopenMode[];
  nextDate: string;
  history: ClosingHistoryEntry[];
  door: DoorState;
  /** The latest recorded opening of the date, or null: "No opening time recorded". */
  opening: DayOpening | null;
  canOpen: boolean;
  openRefusal: 'past_day' | 'future_day' | 'day_closed' | 'already_open' | null;
  /** The store's wall clock at the time of the read, HH:mm and YYYY-MM-DD. */
  localNow: string;
  localNowDate: string;
  previousDay: { businessDate: string; standing: DayStanding; needsReview: boolean } | null;
}

export function useOpenClosing(date?: string) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.openClosing(branchId, date ?? 'today'),
    queryFn: () => api.get<OpenClosing>(`/closings/open/view${date ? `?date=${date}` : ''}`),
    // The expected figures move as the day's work is confirmed, so a stale view
    // would show somebody a shortage they do not have.
    staleTime: 0,
  });
}

export interface RecordCountBody {
  channel: ChannelKind;
  accountId?: string;
  counted?: number;
  skip?: boolean;
  skipReason?: string;
  date?: string;
}

export function useRecordCount(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (body: RecordCountBody) =>
      api.post<OpenClosing>('/closings/count', { ...body, date: body.date ?? date }),
    onSuccess: (fresh) => {
      // Written straight into the cache: the response IS the new view, so
      // re-fetching would only make the screen flicker on a slow counter.
      qc.setQueryData(qk.openClosing(branchId, date ?? 'today'), fresh);
    },
  });
}

export function useSignOffDay(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (countedCash?: number) =>
      api.post<unknown>('/closings', { date, ...(countedCash == null ? {} : { countedCash }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.openClosing(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.discrepancies(branchId) });
      void qc.invalidateQueries({ queryKey: ['home', branchId] });
      invalidateMoney(qc);
    },
  });
}

/**
 * Reopen the current business day after a counted close, or — the Owner,
 * before 06:00 — start the next one now (0076). Same authority as closing.
 */
export function useReopenDay(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (mode: ReopenMode) => api.post<OpenClosing>('/closings/reopen', { mode, ...(date ? { date } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.openClosing(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
      void qc.invalidateQueries({ queryKey: ['home', branchId] });
      invalidateMoney(qc);
    },
  });
}

/**
 * "Open the boutique" (0077): records that a person opened, with the store's
 * time and their name. Anybody who may count may record it; a closed day is
 * reopened instead (`useReopenDay`). Before 06:00 the Owner says which business
 * day the opening is for (docs/56); the mode is sent only when a choice was
 * made, so an older server that offers none is never sent a field it refuses.
 */
export function useOpenDay(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (mode?: ReopenMode) => api.post<OpenClosing>('/closings/open', { ...(date ? { date } : {}), ...(mode ? { mode } : {}) }),
    onSuccess: (fresh) => {
      qc.setQueryData(qk.openClosing(branchId, date ?? 'today'), fresh);
      void qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
      void qc.invalidateQueries({ queryKey: ['home', branchId] });
    },
  });
}

// ── Discrepancies and the debt ledger ───────────────────────────────────────

export type DiscrepancyResolution = 'employee_debt' | 'store_absorbed' | 'error_corrected' | 'forgiven';

export interface Discrepancy {
  id: string;
  date: string;
  amount: number;
  /** In words as well as a sign — colour never carries meaning alone. */
  kind: 'shortage' | 'surplus';
  channel: { channel: ChannelKind; label: string; expected: number; counted: number | null } | null;
  status: 'pending_investigation' | 'resolved';
  resolution: DiscrepancyResolution | null;
  responsibleUserId: string | null;
  reason: string | null;
  openedAt: string;
  resolvedAt: string | null;
  version: number;
}

export interface DebtEntry {
  id: string;
  kind: 'charge' | 'repayment' | 'deduction' | 'forgiveness';
  amount: number;
  reason: string;
  method: 'cash' | 'account' | 'payroll' | null;
  reference: string | null;
  date: string;
}

export interface DebtLedger {
  userId: string;
  name: string;
  /** Derived from the entries every time; never stored. */
  outstanding: number;
  entries: DebtEntry[];
}

export function useDiscrepancies() {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.discrepancies(branchId),
    queryFn: () => api.get<{ rows: Discrepancy[] }>('/discrepancies'),
  });
}

export function useDiscrepancy(id: string | undefined) {
  return useQuery({
    queryKey: qk.discrepancy(id ?? ''),
    queryFn: () => api.get<Discrepancy & { ledger: DebtEntry[] }>(`/discrepancies/${id}`),
    enabled: Boolean(id),
  });
}

export interface ResolveBody {
  resolution: DiscrepancyResolution;
  /** Mandatory. There is no resolving a shortage silently. */
  reason: string;
  /** Required for `employee_debt` and `forgiven`; refused for the others. */
  responsibleUserId?: string;
  expectedVersion?: number;
}

export function useResolveDiscrepancy(id: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (body: ResolveBody) => api.post<Discrepancy>(`/discrepancies/${id}/resolve`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.discrepancy(id) });
      void qc.invalidateQueries({ queryKey: qk.discrepancies(branchId) });
    },
  });
}

/**
 * What the signed-in person owes.
 *
 * Deliberately available to everyone: being asked to repay money and not being
 * allowed to see the record of it is exactly the situation this replaces.
 */
export function useMyDebt() {
  return useQuery({
    queryKey: qk.myDebt(),
    queryFn: () => api.get<DebtLedger>('/debt/me'),
  });
}

/**
 * Who can be named responsible.
 *
 * Reads the same team list the Team screen does rather than inventing a
 * narrower one — the Owner picking a person should see the same people they
 * manage everywhere else, and a second source would drift from the first.
 */
export function useAssignableTeam() {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<{ id: string; name: string }[]>('/users'),
  });
}

/**
 * Which resolutions name a person. Kept beside the form that uses it so the
 * screen and the server cannot disagree about when a name is required.
 */
export function needsResponsiblePerson(resolution: DiscrepancyResolution): boolean {
  return resolution === 'employee_debt' || resolution === 'forgiven';
}

/** A surplus can never be charged to somebody: money was found, not lost. */
export function allowedResolutions(kind: 'shortage' | 'surplus'): DiscrepancyResolution[] {
  return kind === 'surplus'
    ? ['store_absorbed', 'error_corrected']
    : ['employee_debt', 'store_absorbed', 'error_corrected', 'forgiven'];
}
