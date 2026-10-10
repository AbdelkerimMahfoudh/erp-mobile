/// <reference types="jest" />
/**
 * The daily closing of a branch with the money services counter (docs/73
 * §4.5, D155): one drawer, counted once, and each provider float beside it —
 * expected or Unknown, counted, the difference in words — counted by whoever
 * counts the drawer (`closing.count`), or skipped with a reason; the close
 * waits for every float; and while this phone still holds an exchange for the
 * branch, the day is not closed and no float is counted, and the screen says
 * why. A shop's closing shows none of it.
 *
 * The report and the day's view are the backend's real shapes (2026-10-09).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { useI18n, t } from '../lib/i18n';
import type { QueueItem } from '../lib/offline/queue-rules';

jest.mock('../lib/offline/queue-store', () => ({
  readQueue: () => ({ items: [], quarantined: false }),
  writeQueue: () => undefined,
}));
jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    body?: unknown;
    constructor(message: string, status = 500, code?: string, body?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.body = body;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});
jest.mock('../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 'u-owner', companyId: 'c1', name: 'Owner Boutique 2' }, bootstrapping: false, signOut: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api, ApiError } from '../lib/api-client';
import { useQueue } from '../lib/offline/queue';
import DailyClosingScreen from '../app/closing/index';

const OWNER = ['closing.count', 'closing.perform', 'report.view', 'money.anchor.record', 'agent.transaction.view', 'agent.position.set'] as Permission[];
const EMPLOYEE = ['closing.count', 'agent.transaction.record', 'agent.transaction.view'] as Permission[];

type FloatRow = { providerId: string; label: string; expected: number | null; counted: number | null; difference: number | null; explanation: string | null; isSkipped: boolean; skipReason: string | null; countedAt: string | null; countedByName: string | null };
const float = (providerId: string, label: string, expected: number | null, over: Partial<FloatRow> = {}): FloatRow => ({
  providerId, label, expected, counted: null, difference: null, explanation: null, isSkipped: false, skipReason: null, countedAt: null, countedByName: null, ...over,
});

let floats: FloatRow[] = [];
let agentCash = { agentIn: 126075, agentOut: 43075 };
/** D159: money moved after the drawer and the Bankily float were counted; each clears once counted again. */
let moved = { money: false, cash: false, bankily: false };
const version = () => (moved.money ? (moved.cash || moved.bankily ? 'v2' : 'v3') : 'v1');
const movedFloats = () => floats.map((f) => (f.providerId === 'bankily' && moved.bankily ? { ...f, movedSinceCount: true } : f));

const report = () => ({
  date: '2026-10-09', today: '2026-10-09', isToday: true, timezone: 'Africa/Nouakchott',
  window: { startsAt: '2026-10-09T06:00:00.000Z', endsAt: '2026-10-10T06:00:00.000Z' },
  standing: 'open',
  sales: null,
  money: {
    channels: [
      {
        key: 'cash:NONE', channel: 'cash', accountId: null, label: 'CASH', isUnattributed: false, countable: true,
        in: { todaysSales: 6400, olderDebts: 0, correctionsIn: 0, agentIn: agentCash.agentIn, total: 6400 + agentCash.agentIn },
        out: { refunds: 0, stockPurchases: 0, expenses: 0, correctionsOut: 0, agentOut: agentCash.agentOut, total: agentCash.agentOut },
        net: 6400 + agentCash.agentIn - agentCash.agentOut,
      },
    ],
    totals: { in: 6400 + agentCash.agentIn, out: agentCash.agentOut, net: 6400 + agentCash.agentIn - agentCash.agentOut, todaysSales: 6400, olderDebts: 0 },
    pending: null,
  },
  expenses: null,
  result: { status: 'hidden' },
  expected: {
    cash: { opening: { amount: 10000, anchorDate: '2026-10-09', anchorVerified: false, carriedDays: 0 }, in: 132475, out: 43075, expected: 99400, counted: null, difference: null, verification: 'not_counted', countedAt: null, ...(moved.cash ? { movedSinceCount: true } : {}) },
    accounts: [],
    floats: movedFloats(),
  },
  warnings: moved.cash || moved.bankily ? [{ code: 'money_moved_after_count', severity: 'warning', section: 'money', params: { count: 2, exchanges: 3, reversals: 1, rebalancings: 0 } }] : [],
  close: { kind: 'first', requiresAcknowledgement: true, unverified: ['cash:NONE'], verified: [], attested: [], canClose: true },
  sections: { sales: false, expenses: false, result: false, close: true },
  reportVersion: version(), liveVersion: version(), source: 'live', snapshot: null, generatedAt: '2026-10-09T11:33:48.666Z',
});

const view = () => ({
  date: '2026-10-09', businessDate: '2026-10-09', today: '2026-10-09', timezone: 'Africa/Nouakchott',
  standing: 'open', status: 'counting', isLocked: false,
  channels: [
    { channel: 'cash', accountId: null, labelSnapshot: 'CASH', isUnattributed: false, salesIn: 6400, refundsOut: 0, supplierOut: 0, expensesOut: 0, correctionsIn: 0, correctionsOut: 0, agentIn: agentCash.agentIn, agentOut: agentCash.agentOut, openingBalance: 0, expected: 99400, countable: true, counted: moved.money ? 99000 : null, difference: moved.money ? -400 : null, isSkipped: false, skipReason: null, countedAt: moved.money ? '2026-10-09T11:20:00.000Z' : null, stale: false, ...(moved.cash ? { movedSinceCount: true, expectedAtCount: 99000 } : {}) },
  ],
  floats: movedFloats(),
  outstanding: 1, complete: false, freshCountRequired: false, stale: [], expectedCash: 99400, openingCash: 0,
  sinceLastCount: null, lastCountedAt: null, lastCountedLocalTime: null, firstClosedAt: null, closedAt: null, reopenedAt: null, reopenCount: 0,
  canReopen: false, reopenRefusal: 'not_closed', reopenChoices: [], openChoices: ['continue'], nextDate: '2026-10-10',
  history: [], door: 'open',
  opening: { kind: 'opened', at: '2026-10-09T11:11:00.417Z', actor: 'Owner Boutique 2', localDate: '2026-10-09', localTime: '11:11' },
  canOpen: false, openRefusal: 'already_open', localNow: '11:33', localNowDate: '2026-10-09', previousDay: null,
});

function serve(path: string): unknown {
  if (path.startsWith('/closings/report')) return report();
  if (path.startsWith('/closings/open/view')) return view();
  return new Promise(() => undefined);
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <DailyClosingScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function signIn(role: string, granted: readonly Permission[]) {
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 2', role });
  usePermissionStore.setState({ granted: new Set(granted), branchId: 'b1', status: 'ready', error: null });
}

const queued = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'q1', kind: 'agent.exchange.record', clientUuid: 'k1', companyId: 'c1', branchId: 'b1', userId: 'u-owner', payloadVersion: 1,
  payload: { providerId: 'bankily', direction: 'cash_out_credit_in', amount: 5000, configVersionId: 'cfg-7', deviceRecordedAt: '2026-10-09T12:00:00.000Z' },
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 'Cash out, credit in · 5 000 MRU · Bankily', lastError: null, ...over,
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  await useI18n.getState().setLanguage('en');
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => serve(path));
  floats = [float('bankily', 'Bankily', 12490), float('masrvi', 'Masrvi', null)];
  agentCash = { agentIn: 126075, agentOut: 43075 };
  moved = { money: false, cash: false, bankily: false };
  useQueue.setState({ items: [], running: false, scope: { companyId: 'c1', branchId: 'b1', userId: 'u-owner' } });
});
afterEach(() => settle());

describe('the closing of an agent branch', () => {
  it('the floats beside the drawer: expected or Unknown, not counted yet; the counter’s cash said inside the drawer’s line', async () => {
    signIn('owner', OWNER);
    mount();
    const card = await screen.findByTestId('closing-floats');
    const bankily = within(card).getByTestId('float-count-bankily');
    expect(within(bankily).getByText(t('agent.positions.float', { provider: 'Bankily' }))).toBeTruthy();
    expect(within(bankily).getByText(/^12\s490\sMRU$/)).toBeTruthy();
    expect(within(bankily).getByText(t('closing.float.state.not_counted'))).toBeTruthy();
    // Unknown stays Unknown: no figure is fabricated to compare a count against.
    const masrvi = within(card).getByTestId('float-count-masrvi');
    expect(within(masrvi).getByText(t('moneyTab.held.unknown'))).toBeTruthy();
    expect(within(masrvi).getByText(t('closing.float.unknown'))).toBeTruthy();
    expect(screen.getByTestId('closing-agent-cash')).toBeTruthy();
  });

  it('a store employee counts a float — why it differs asked only when it does — or skips one with its reason', async () => {
    signIn('store_employee', EMPLOYEE);
    (api.post as jest.Mock).mockImplementation(async () => ({ ...view(), float: null }));
    mount();
    const bankily = await screen.findByTestId('float-count-bankily');
    const field = within(bankily).getByLabelText(`${t('agent.positions.float', { provider: 'Bankily' })}, ${t('closing.float.prompt', { provider: 'Bankily' })}`);
    fireEvent.changeText(field, '12490');
    expect(within(bankily).queryByPlaceholderText(t('closing.float.explanation'))).toBeNull();
    fireEvent.changeText(field, '12390');
    fireEvent.changeText(within(bankily).getByPlaceholderText(t('closing.float.explanation')), 'app shows 12 390');
    fireEvent.press(within(bankily).getByText(t('closing.row.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post as jest.Mock).mock.calls[0]).toEqual(['/closings/2026-10-09/float-counts', { providerId: 'bankily', counted: 12390, explanation: 'app shows 12 390' }]);

    const masrvi = screen.getByTestId('float-count-masrvi');
    fireEvent.press(within(masrvi).getByText(t('closing.float.skip')));
    fireEvent.changeText(within(masrvi).getByPlaceholderText(t('closing.float.skipReason')), 'not used today');
    fireEvent.press(within(masrvi).getByText(t('closing.float.skipSave')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect((api.post as jest.Mock).mock.calls[1]).toEqual(['/closings/2026-10-09/float-counts', { providerId: 'masrvi', skip: true, skipReason: 'not used today' }]);
    // Counting is not closing: an employee is still told the close is not theirs.
    expect(screen.getByText(t('dailyReport.notYours'))).toBeTruthy();
  });

  it('a counted float says its difference in words; a skipped one says why', async () => {
    floats = [
      float('bankily', 'Bankily', 15100, { counted: 15000, difference: -100, explanation: 'provider app shows 15 000', countedAt: '2026-10-09T11:11:05.663Z', countedByName: 'Manager Boutique 2' }),
      float('masrvi', 'Masrvi', null, { isSkipped: true, skipReason: 'not used at the annex today', countedAt: '2026-10-09T11:11:05.958Z', countedByName: 'Manager Boutique 2' }),
    ];
    signIn('owner', OWNER);
    mount();
    const bankily = await screen.findByTestId('float-count-bankily');
    expect(within(bankily).getByText(t('agent.difference.short'))).toBeTruthy();
    expect(within(bankily).getByText(t('agent.count.explanationShown', { explanation: 'provider app shows 15 000' }))).toBeTruthy();
    expect(within(screen.getByTestId('float-count-masrvi')).getByText(t('closing.float.skippedBecause', { reason: 'not used at the annex today' }))).toBeTruthy();
  });

  it('while this phone holds an exchange the day is not closed and no float is counted — and the screen says why', async () => {
    signIn('owner', OWNER);
    useQueue.setState({ items: [queued({ state: 'needs_attention' })] });
    mount();
    const notice = await screen.findByTestId('closing-queue');
    expect(within(notice).getByText(t('closing.queue.body', { count: 1 }))).toBeTruthy();
    expect(within(notice).getByText(t('closing.queue.see'))).toBeTruthy();
    const close = screen.getByText(t('dailyReport.closeDay'));
    fireEvent.press(close);
    await settle();
    // The close never opened.
    expect(screen.queryByText(t('closeDay.question'))).toBeNull();
    // And no float can be counted meanwhile.
    expect(within(screen.getByTestId('float-count-bankily')).queryByText(t('closing.row.save'))).toBeNull();
  });

  it('the close waits for every float: counted or skipped, never covered by the person’s word', async () => {
    signIn('owner', OWNER);
    mount();
    fireEvent.press(await screen.findByText(t('dailyReport.closeDay')));
    fireEvent.press(await screen.findByText(t('closeDay.checked')));
    const floatsLine = await screen.findByTestId('close-floats');
    expect(within(floatsLine).getByText(t('closing.floats.waiting', { names: 'Bankily · Masrvi' }))).toBeTruthy();
    expect(within(floatsLine).getByText(t('closing.floats.count'))).toBeTruthy();
    const closeButtons = screen.getAllByLabelText(t('dailyReport.closeDay'));
    expect(closeButtons[closeButtons.length - 1].props.accessibilityState?.disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a shop’s closing shows no float and no counter line', async () => {
    floats = [];
    agentCash = { agentIn: 0, agentOut: 0 };
    signIn('owner', OWNER);
    mount();
    expect(await screen.findByText(t('dailyReport.movements'))).toBeTruthy();
    expect(screen.queryByTestId('closing-floats')).toBeNull();
    expect(screen.queryByTestId('closing-agent-cash')).toBeNull();
    expect(screen.queryByTestId('closing-queue')).toBeNull();
  });
});

describe('money that moved after counting began (D159)', () => {
  it('a refused close names the drawer and float to count again and what was recorded since, takes the person to count them, and sends the close only on the new version, under the same key', async () => {
    // Both floats counted (Bankily at 12 490, Masrvi skipped), the drawer counted at 99 000 — then money moved.
    floats = [
      float('bankily', 'Bankily', 12490, { counted: 12490, difference: 0, countedAt: '2026-10-09T11:21:00.000Z', countedByName: 'Owner Boutique 2' }),
      float('masrvi', 'Masrvi', null, { isSkipped: true, skipReason: 'not used today', countedAt: '2026-10-09T11:21:00.000Z', countedByName: 'Owner Boutique 2' }),
    ];
    signIn('owner', OWNER);
    const closes: Record<string, unknown>[] = [];
    (api.post as jest.Mock).mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === '/closings') {
        closes.push(body);
        if (closes.length === 1) {
          // Recorded after the counts: three exchanges and one reversal moved the drawer and the Bankily float.
          moved = { money: true, cash: true, bankily: true };
          throw new ApiError('Money moved after the count', 409, 'money_moved_after_count', {
            code: 'money_moved_after_count',
            channels: [{ key: 'cash:NONE', label: 'CASH' }],
            floats: [{ providerId: 'bankily', label: 'Bankily' }],
            report: report(),
          });
        }
        return { closingId: 'cl-1', date: '2026-10-09', kind: 'first', replayed: false, verification: { verified: ['cash:NONE'], unverified: [], attested: [], acknowledged: false, reason: null }, report: report() };
      }
      if (path === '/closings/count') {
        moved = { ...moved, cash: false };
        return view();
      }
      if (path === '/closings/2026-10-09/float-counts') {
        moved = { ...moved, bankily: false };
        return { ...view(), float: null };
      }
      throw new Error(`unexpected POST ${path}`);
    });
    mount();
    fireEvent.press(await screen.findByText(t('dailyReport.closeDay')));
    fireEvent.press(await screen.findByText(t('closeDay.checked')));
    await settle();
    const first = screen.getAllByLabelText(t('dailyReport.closeDay'));
    await act(async () => {
      fireEvent.press(first[first.length - 1]);
    });
    expect(closes).toHaveLength(1);
    expect(closes[0]).toEqual(expect.objectContaining({ date: '2026-10-09', reportVersion: 'v1' }));

    // Said plainly: what to count again, and what was recorded since — and the count step is open for it.
    const notice = await screen.findByTestId('closing-moved');
    expect(within(notice).getByText(t('closing.moved.title'))).toBeTruthy();
    expect(
      within(notice).getByText(
        `${t('closing.moved.recount', { names: `${t('closing.channel.cash')} · ${t('agent.positions.float', { provider: 'Bankily' })}` })} ${t('closing.moved.since', {
          list: `${t('closing.moved.exchanges', { count: 3 })}, ${t('closing.moved.reversals.one', { count: 1 })}`,
        })}`,
      ),
    ).toBeTruthy();
    expect(await screen.findByLabelText(`${t('closing.channel.cash')}, ${t('closing.countedLabel')}`)).toBeTruthy();
    // The popup's own row (the screen's float card shows the same marker behind it).
    const sheetFloat = () => screen.getAllByTestId('float-count-bankily').at(-1)!;
    expect(within(sheetFloat()).getByText(t('closing.moved.stale'))).toBeTruthy();
    expect(screen.getAllByText(t('closing.moved.stale')).length).toBeGreaterThanOrEqual(2);

    // The drawer counted again, then the float.
    fireEvent.changeText(screen.getByLabelText(`${t('closing.channel.cash')}, ${t('closing.countedLabel')}`), '99400');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(`${t('closing.row.save')}, ${t('closing.channel.cash')}`));
    });
    const field = within(sheetFloat()).getByLabelText(`${t('agent.positions.float', { provider: 'Bankily' })}, ${t('closing.float.prompt', { provider: 'Bankily' })}`);
    fireEvent.changeText(field, '12490');
    await act(async () => {
      fireEvent.press(within(sheetFloat()).getByText(t('closing.row.save')));
    });
    await waitFor(() => expect(screen.queryByTestId('closing-moved')).toBeNull());

    // Then the close again — on the new version, under the same key.
    fireEvent.press(screen.getByText(t('closeDay.count.continue')));
    await waitFor(() => {
      const buttons = screen.getAllByLabelText(t('dailyReport.closeDay'));
      expect(buttons[buttons.length - 1].props.accessibilityState?.disabled).toBe(false);
    });
    const again = screen.getAllByLabelText(t('dailyReport.closeDay'));
    await act(async () => {
      fireEvent.press(again[again.length - 1]);
    });
    expect(closes).toHaveLength(2);
    expect(closes[1].reportVersion).toBe('v3');
    expect(closes[1].clientUuid).toBe(closes[0].clientUuid);
  });

  it('a stale count says so on the closing screen too, and the report’s warning names how many counts to take again', async () => {
    floats = [float('bankily', 'Bankily', 12490, { counted: 12490, difference: 0, countedAt: '2026-10-09T11:21:00.000Z', countedByName: 'Owner Boutique 2' }), float('masrvi', 'Masrvi', null)];
    moved = { money: true, cash: true, bankily: true };
    signIn('owner', OWNER);
    mount();
    const bankily = await screen.findByTestId('float-count-bankily');
    expect(within(bankily).getByText(t('closing.moved.stale'))).toBeTruthy();
    expect(screen.getByText(t('dailyReport.warning.money_moved_after_count', { count: 2 }))).toBeTruthy();
  });
});
