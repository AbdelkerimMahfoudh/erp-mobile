import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import type { DayStanding, HomePeriod } from './home-day';
import { periodRange, type DayRange, type PeriodKey } from './period';
import { checkHome, retryUnlessIncompatible } from './contract';

/**
 * Home's one read (`GET /home?period=`), the branch's business day and the
 * partner ranking (docs/50 §3.5).
 *
 * Everything here is the server's: the business date and the exact range, the
 * figures, the bars that already add up to the sales value, the masked
 * arrivals and the closing card. The phone chooses words and never a number.
 */

export interface HomeBar {
  key: string;
  label: string;
  from: string;
  to: string;
  value: number;
}

export interface HomeFigures {
  salesValue: number;
  salesCount: number;
  phonesSold: number;
  /**
   * Sales cancelled in the range, on the day each cancellation was approved (0079).
   * The sales value keeps a cancelled sale on the day it was sold, as its Daily
   * closing does; this is the same sale coming off again on its cancellation's day.
   */
  cancellations: { count: number; value: number; phones: number };
  /** Returns approved in the range, on their approval day, by their net refund due (docs/53). */
  returns: { count: number; value: number; phones: number };
  /** salesValue − returns − cancellations: the Daily closing's net sales over the range. */
  netSalesValue: number;
  collected: number;
  /** Confirmed expenses on their own dates, less reversals approved in the range — negative when only a reversal fell here. */
  expenses: number;
  expensesRecorded: number;
  expensesReversed: number;
  expensesCount: number;
  stillOwed: number;
  /** Always `these_sales`: outstanding today on the sales in the range. */
  stillOwedScope: 'these_sales';
  /**
   * The sales value against the window of equal length just before this one (docs/56).
   * `available: false` when that window sold nothing — a zero base is no comparison — and
   * the whole field is absent on an older server; either way no percentage is printed.
   */
  comparison?: {
    period: { from: string; to: string };
    salesValue: { available: true; previous: number; change: number; changePercent: number } | { available: false; previous: number; reason: string };
  };
}

export interface HomeArrival {
  unitId: string;
  label: string;
  variant: string | null;
  receivedAt: string;
  /** The store's calendar date and wall-clock time of the arrival — in the store's timezone, never the phone's. */
  receivedLocalDate: string;
  receivedLocalTime: string;
  status: string;
  identifierKind: 'imei' | 'serial';
  identifierLast4: string;
}

export interface ClosingCard {
  businessDate: string;
  standing: DayStanding;
  lastCountedAt: string | null;
  firstClosedAt: string | null;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
  previousDay: { businessDate: string; standing: DayStanding; needsReview: boolean };
}

export interface PartnerRankRow {
  rank: number;
  counterpartyId: string;
  name: string;
  completedTrades: number;
  value: number;
}

export interface HomeResponse {
  period: HomePeriod;
  range: { from: string; to: string };
  /** `localDate`: the store's calendar date now, in its timezone — what "Today" means on this screen. */
  businessDay: { businessDate: string; localDate: string; timezone: string; startsAt: string; endsAt: string; startedEarly: boolean };
  /** Null without `report.view`: hidden, never zero. */
  figures: HomeFigures | null;
  series: { unit: 'hour' | 'day' | 'week'; total: number; bars: HomeBar[] } | null;
  /** Null when there is no completed trade to rank, or without `consignment.view`. */
  topPartner: PartnerRankRow | null;
  partners: { available: boolean; partnersExist: boolean; ranked: number };
  arrivals: HomeArrival[];
  /** Null without `closing.count`. */
  closing: ClosingCard | null;
  generatedAt: string;
}

export function useHome(period: HomePeriod, options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.home(branchId, period),
    // A reply missing a figure is refused whole: the screen says the server needs updating (docs/54).
    queryFn: async () => checkHome(await api.get<HomeResponse>(`/home?period=${period}`)),
    retry: retryUnlessIncompatible,
    enabled: (options.enabled ?? true) && Boolean(branchId),
    // The counter looks at this between sales; a minute is fresh enough and
    // keeps the tab from hammering the server on every focus.
    staleTime: 60_000,
  });
}

export interface BusinessDayView {
  businessDate: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  canStartEarly: boolean;
  startedEarly: boolean;
  standing: DayStanding;
  previousDay: { businessDate: string; standing: DayStanding; needsReview: boolean };
}

/** Which business day it is at this branch — the server's answer, never the phone's clock. */
export function useBusinessDay(options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.businessDay(branchId),
    queryFn: () => api.get<BusinessDayView>('/closings/business-day'),
    enabled: (options.enabled ?? true) && Boolean(branchId),
    staleTime: 60_000,
  });
}

/** Money's period, ending on the branch's business date — the server's day, not the phone's. */
export function usePeriodRange(key: PeriodKey): DayRange {
  const day = useBusinessDay();
  return periodRange(key, new Date(), day.data?.businessDate);
}

export interface PartnerRankingPage {
  rows: PartnerRankRow[];
  total: number;
  page: number;
  pageSize: number;
  partnersExist: boolean;
  generatedAt: string;
}

export const RANKING_PAGE = 20;

export function usePartnerRanking(options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useInfiniteQuery({
    queryKey: qk.partnerRanking(branchId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<PartnerRankingPage>(`/partners/ranking?page=${pageParam}&limit=${RANKING_PAGE}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: (options.enabled ?? true) && Boolean(branchId),
  });
}
