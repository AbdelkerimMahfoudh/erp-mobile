import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import { invalidateMoney } from './money-invalidation';
import type { DayStanding, ReopenMode } from './home-day';
import type { OpeningMoneyInput, OpeningStep } from './opening-money';

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
  /** The money services counter's cash on the drawer's row (D154); 0 on an account, absent on an older server. */
  agentIn?: number;
  agentOut?: number;
  expected: number;
  /** `null` means genuinely not counted yet — never the same as counted zero. */
  counted: number | null;
  difference: number | null;
  isSkipped: boolean;
  skipReason: string | null;
  countedAt: string | null;
  /** Counted, and its expected figure moved since (D159): count it again; absent on an older server. */
  movedSinceCount?: boolean;
  /** What the channel was expected to hold at the instant it was counted. */
  expectedAtCount?: number | null;
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
  /** The day's own amount set when the shop opened, as the drawer's figure uses it (docs/63). */
  cashSet?: CashSet | null;
  /** What the opening step shows (docs/63) — the current day only; absent on an older server. */
  openingMoney?: OpeningStep | null;
  /** The provider floats of an agent branch, counted beside the drawer (D154); empty or absent for a shop. */
  floats?: FloatCount[];
}

/**
 * One provider float at the closing of an agent branch (docs/73 §4.5): what the
 * app tracked at the count instant — null while the float is unknown, never a
 * fabricated figure — what the provider's app showed, and the difference only
 * when both are known. Skipped with a reason, or not counted at all.
 */
export interface FloatCount {
  providerId: string;
  label: string;
  expected: number | null;
  counted: number | null;
  difference: number | null;
  explanation: string | null;
  isSkipped: boolean;
  skipReason: string | null;
  countedAt: string | null;
  countedByName: string | null;
  /** Counted, and money moved through the float since (D159): count it again; absent on an older server. */
  movedSinceCount?: boolean;
  expectedAtCount?: number | null;
}

/**
 * An amount set for the drawer on the day (docs/63): from `at` the drawer holds it plus what the day recorded after.
 * `adjustment` is what that adds to the day's equation; `tracked` what the app expected just before.
 */
export interface CashSet {
  kind: 'opening' | 'owner_review';
  decision: 'keep' | 'set' | 'carried';
  awaitingOwnerReview: boolean;
  amount: number;
  at: string;
  localTime: string;
  byName: string | null;
  tracked: number;
  adjustment: number;
}

export function useOpenClosing(date?: string, options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.openClosing(branchId, date ?? 'today'),
    queryFn: () => api.get<OpenClosing>(`/closings/open/view${date ? `?date=${date}` : ''}`),
    // The expected figures move as the day's work is confirmed, so a stale view
    // would show somebody a shortage they do not have.
    staleTime: 0,
    // Only for those the view is for (`closing.count`): Home and the Sell/Receive guard ask for it too.
    enabled: (options.enabled ?? true) && Boolean(branchId),
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

export type RecordFloatCountBody =
  | { providerId: string; counted: number; explanation?: string }
  | { providerId: string; skip: true; skipReason: string };

/**
 * One float's count (`POST closings/:date/float-counts`, `closing.count`): the
 * same act as a channel's count — the day stays open and correctable, a
 * difference opens a question for the closing. `viewDate` is the date the
 * screen keys its view on (undefined for the current day); the business date
 * itself is always sent, as the route needs it.
 */
export function useRecordFloatCount(viewDate?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: ({ date, body }: { date: string; body: RecordFloatCountBody }) =>
      api.post<OpenClosing & { float: FloatCount | null }>(`/closings/${encodeURIComponent(date)}/float-counts`, body),
    onSuccess: (fresh) => {
      // The response is the day's view: written straight in, as a channel's count is.
      qc.setQueryData(qk.openClosing(branchId, viewDate ?? 'today'), fresh);
      // The report's version follows the counts: the close must sign the figures it shows.
      void qc.invalidateQueries({ queryKey: qk.dailyReport(branchId, viewDate ?? 'today') });
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
    // With the money the shop reopens with (docs/63): the Owner's decision, or only the attempt's key for anybody else.
    mutationFn: ({ mode, openingMoney }: { mode: ReopenMode; openingMoney?: OpeningMoneyInput }) =>
      api.post<OpenClosing>('/closings/reopen', { mode, ...(date ? { date } : {}), ...(openingMoney ? { openingMoney } : {}) }),
    // Returned, so the reopen finishes only once the day has been read again: the counter opens on the server's
    // answer, and Open store now cannot be pressed twice in between (docs/59 D76).
    onSuccess: () => {
      invalidateMoney(qc);
      return Promise.all([
        qc.invalidateQueries({ queryKey: qk.openClosing(branchId, date ?? 'today') }),
        qc.invalidateQueries({ queryKey: qk.businessDay(branchId) }),
        qc.invalidateQueries({ queryKey: ['home', branchId] }),
      ]);
    },
    // Refused — the day was reopened elsewhere, or 06:00 passed: read it again, so a stale lock clears itself.
    onError: () => {
      void qc.invalidateQueries({ queryKey: qk.openClosing(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
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
    mutationFn: ({ mode, openingMoney }: { mode?: ReopenMode; openingMoney?: OpeningMoneyInput } = {}) =>
      api.post<OpenClosing>('/closings/open', { ...(date ? { date } : {}), ...(mode ? { mode } : {}), ...(openingMoney ? { openingMoney } : {}) }),
    // Returned, so the opening finishes only once the day has been read again: the counter opens on the server's
    // answer, and the button cannot be pressed twice in between.
    onSuccess: (fresh) => {
      qc.setQueryData(qk.openClosing(branchId, date ?? 'today'), fresh);
      invalidateMoney(qc);
      return Promise.all([
        qc.invalidateQueries({ queryKey: qk.businessDay(branchId) }),
        qc.invalidateQueries({ queryKey: ['home', branchId] }),
      ]);
    },
    // Refused — opened elsewhere meanwhile, or 06:00 passed: read it again, so the screen shows the day as it is.
    onError: () => {
      void qc.invalidateQueries({ queryKey: qk.openClosing(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
    },
  });
}

/**
 * The Owner's review of an opening somebody else made with the tracked amounts (docs/63): keep them, or set the
 * drawer to what is in it now — true from the review's own instant.
 */
export function useReviewOpening() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (input: Required<Pick<OpeningMoneyInput, 'clientUuid' | 'decision'>> & Pick<OpeningMoneyInput, 'cashAmount'>) =>
      api.post<OpenClosing>('/closings/opening/review', input),
    onSuccess: (fresh) => {
      qc.setQueryData(qk.openClosing(branchId, 'today'), fresh);
      invalidateMoney(qc);
      return Promise.all([
        qc.invalidateQueries({ queryKey: qk.businessDay(branchId) }),
        qc.invalidateQueries({ queryKey: ['home', branchId] }),
      ]);
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
export function useAssignableTeam(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<{ id: string; name: string }[]>('/users'),
    // Only for someone who may name a person; anyone else would be refused the list.
    enabled: opts.enabled ?? true,
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
