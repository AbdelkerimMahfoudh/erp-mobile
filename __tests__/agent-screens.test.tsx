/// <reference types="jest" />
/**
 * The counter's screens as each role sees them (docs/73 §5, D155, D157):
 *
 *  - Home on an agent-only branch: no Sell, no Receive, no sales figures; one
 *    big New exchange; today's count and commission (the report's, for whoever
 *    reads it); the drawer and the floats — Unknown stays Unknown with its day's
 *    movement — and Provisional while the phone holds an exchange. On a combined
 *    branch, Receive and Sell and New exchange; on a shop, none of the counter.
 *  - The exchanges: the phone's own first, Pending synchronization; the server's
 *    masked, the search sent as the last four digits only.
 *  - One exchange: the number masked unless the server sent it whole; Report a
 *    mistake for the counter, Reverse for the Owner and a Manager; a reversal's
 *    counter-legs apart, and no action left on it.
 *
 * Every answer below is the backend's real serialized shape (2026-10-09).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { useI18n, t } from '../lib/i18n';
import type { QueueItem } from '../lib/offline/queue-rules';

jest.mock('expo-router', () => ({
  ...jest.requireActual('./mocks/expo-router'),
  useLocalSearchParams: () => ({ id: 't-1' }),
  // Home resets its period on each arrival at the tab; here it is simply mounted once.
  useRoute: () => ({ key: 'index', name: 'index' }),
  useNavigation: () => ({ setOptions: jest.fn(), canGoBack: () => false, goBack: jest.fn(), addListener: () => () => undefined }),
}));
jest.mock('../lib/offline/queue-store', () => ({
  readQueue: () => ({ items: [], quarantined: false }),
  writeQueue: () => undefined,
}));
jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
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
  useAuth: () => ({ user: { id: 'u-emp', companyId: 'c1', name: 'Employee Boutique 2' }, bootstrapping: false, signOut: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api } from '../lib/api-client';
import { useQueue } from '../lib/offline/queue';
import HomeScreen from '../app/(tabs)/index';
import AgentTransactionsTab from '../app/(tabs)/agent-transactions';
import ExchangeDetailScreen from '../app/agent/[id]';
import { QueuedExchange } from '../components/agent/QueuedExchange';

const AGENT_OWNER = ['agent.transaction.record', 'agent.transaction.view', 'agent.customer.reveal', 'agent.mistake.report', 'agent.transaction.reverse', 'agent.rebalance', 'agent.position.set', 'agent.report.view', 'agent.provider.manage'];
const OWNER = ['closing.count', 'closing.perform', 'report.view', 'sale.create', 'purchase.manage', 'consignment.view', 'connection.manage', 'expense.submit', ...AGENT_OWNER] as Permission[];
const MANAGER = ['closing.count', 'report.view', 'sale.create', 'purchase.manage', 'consignment.view', 'expense.submit', 'agent.transaction.record', 'agent.transaction.view', 'agent.customer.reveal', 'agent.mistake.report', 'agent.transaction.reverse', 'agent.rebalance', 'agent.report.view'] as Permission[];
const EMPLOYEE = ['closing.count', 'sale.create', 'purchase.manage', 'consignment.view', 'expense.submit', 'agent.transaction.record', 'agent.transaction.view', 'agent.mistake.report'] as Permission[];

type Activity = 'electronics' | 'money_agent' | 'both';
const entitlement = (activity: Activity) => ({
  state: 'active', canRead: true, canWrite: true, status: 'activated', isComplimentary: false, calculatedAt: '2026-10-09T11:00:00.000Z',
  seatsByStore: [{ branchId: 'b1', name: 'Boutique 2', activity, activityNext: null }],
});
const day = (inflows: number, outflows: number) => ({ businessDate: '2026-10-09', inflows, outflows, net: inflows - outflows });
const positions = {
  businessDate: '2026-10-09', asOf: '2026-10-09T11:33:48.463Z', branchId: 'b1',
  cash: { known: true, position: 99400, unknownReason: null, movement: day(132475, 43075), anchor: { source: 'opening', amount: 10000, at: '2026-10-09T11:11:00.417Z', businessDate: '2026-10-09', byName: 'Owner Boutique 2' } },
  floats: [
    { providerId: 'bankily', providerLabel: 'Bankily', providerKind: 'bankily', accountKind: 'provider', known: true, position: 12490, unknownReason: null, sinceAnchorNet: -37510, anchor: { amount: 50000, at: '2026-10-09T11:11:00.725Z', businessDate: '2026-10-09', byName: 'Owner Boutique 2', source: 'set' }, movement: day(8490, 46000) },
    { providerId: 'masrvi', providerLabel: 'Masrvi', providerKind: 'other', accountKind: 'provider', known: false, position: null, unknownReason: 'no_anchor', sinceAnchorNet: null, anchor: null, movement: day(10100, 9900) },
  ],
  commissionHeld: [],
  total: null,
  unknownKeys: ['provider:masrvi'],
};
const providers = {
  providers: [
    { id: 'bankily', kind: 'bankily', label: 'Bankily', isActive: true, sortOrder: 0, readyForTransactions: true, missing: [], config: { id: 'cfg-7', rateInBp: 200, rateOutBp: 200, sameRateBothDirections: true, commissionDestination: 'provider_float', principalFeeMode: 'separate', referenceRule: 'optional', effectiveFrom: '2026-10-09T11:11:02.585Z', recordedByName: 'Owner Boutique 2', reason: 'INVENTED fixture' } },
  ],
};
const report = { period: 'day', from: '2026-10-09', to: '2026-10-09', totals: { count: 13, volume: 64000, cashReceived: 51000, cashPaid: 13000, creditSent: 51000, creditReceived: 13000, commission: 740, reversals: { count: 1, volume: 15000, commission: 75 }, rebalancings: { count: 3, cashIn: 60000, cashOut: 15000, floatIn: 15000, floatOut: 10000 } } };
const tx = (over: Record<string, unknown> = {}) => ({
  id: 't-1', branchId: 'b1', providerId: 'bankily', providerLabel: 'Bankily', direction: 'cash_in_credit_out', amount: 10000, customerNumberMasked: '•••• 1234', providerReference: null,
  commission: { amount: 200, rateBp: 200, destination: 'provider_float', principalFeeMode: 'separate', configVersionId: 'cfg-7' },
  legs: [
    { account: 'cash', providerId: null, direction: 'inflow', amount: 10000, kind: 'principal' },
    { account: 'provider', providerId: 'bankily', direction: 'inflow', amount: 200, kind: 'commission' },
    { account: 'provider', providerId: 'bankily', direction: 'outflow', amount: 10000, kind: 'principal' },
  ],
  businessDate: '2026-10-09', recordedAt: '2026-10-09T11:11:02.660Z', deviceRecordedAt: null, recordedBy: { id: 'u-emp', name: 'Employee Boutique 2' }, status: 'completed', reversal: null, mistakes: [],
  ...over,
});

let activity: Activity = 'money_agent';
let dayView: Record<string, unknown> = { businessDate: '2026-10-09', localDate: '2026-10-09', door: 'open' };
let detail: Record<string, unknown> = tx();
function serve(path: string): unknown {
  if (path.startsWith('/entitlement')) return entitlement(activity);
  if (path.startsWith('/agent/positions')) return positions;
  if (path.startsWith('/agent/providers')) return providers;
  if (path.startsWith('/agent/reports')) return report;
  if (path.startsWith('/agent/transactions/')) return detail;
  if (path.startsWith('/agent/transactions')) return { rows: [tx()], nextCursor: null };
  if (path.startsWith('/closings/business-day')) return dayView;
  // The opening flow's own view is not these tests' subject: it stays loading.
  if (path.startsWith('/closings/open')) return new Promise(() => undefined);
  // Home's own figures are not this test's subject: they stay loading.
  if (path.startsWith('/home')) return new Promise(() => undefined);
  return { rows: [], nextCursor: null };
}

function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>,
  );
}

function signIn(role: string, granted: readonly Permission[], branchActivity: Activity) {
  activity = branchActivity;
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 2', role });
  usePermissionStore.setState({ granted: new Set(granted), branchId: 'b1', status: 'ready', error: null });
}

const queued = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'q1', kind: 'agent.exchange.record', clientUuid: 'k1', companyId: 'c1', branchId: 'b1', userId: 'u-emp', payloadVersion: 1,
  payload: { providerId: 'bankily', direction: 'cash_out_credit_in', amount: 5000, configVersionId: 'cfg-7', deviceRecordedAt: '2026-10-09T12:00:00.000Z' },
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 'Cash out, credit in · 5 000 MRU · Bankily', lastError: null, ...over,
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  await useI18n.getState().setLanguage('en');
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => serve(path));
  detail = tx();
  dayView = { businessDate: '2026-10-09', localDate: '2026-10-09', door: 'open' };
  useQueue.setState({ items: [], running: false, scope: { companyId: 'c1', branchId: 'b1', userId: 'u-emp' } });
});
afterEach(() => settle());

describe('Home', () => {
  it('an agent-only branch: one big New exchange, today’s count and commission, the drawer and the floats — nothing of the store', async () => {
    signIn('owner', OWNER, 'money_agent');
    mount(<HomeScreen />);
    expect(await screen.findByText(t('nav.agent.new'))).toBeTruthy();
    expect(screen.queryByText(t('home.shortcut.sell'))).toBeNull();
    expect(screen.queryByText(t('home.shortcut.receive'))).toBeNull();
    expect(await screen.findByText('13')).toBeTruthy();
    expect(screen.getByText(t('agent.today.commission'))).toBeTruthy();
    expect(screen.getByText(t('agent.today.reversed', { count: 1 }))).toBeTruthy();
    // The drawer and each float as tracked; Unknown stays Unknown, with what moved today beside it.
    expect(screen.getByText(t('agent.positions.cash'))).toBeTruthy();
    expect(screen.getByText(t('agent.positions.float', { provider: 'Bankily' }))).toBeTruthy();
    expect(screen.getByTestId('position-provider:masrvi')).toBeTruthy();
    expect(screen.getAllByText(t('moneyTab.held.unknown')).length).toBe(1);
    expect(screen.queryByTestId('positions-provisional')).toBeNull();
    // No sales figures and no phones on an agent counter.
    expect(screen.queryByText(t('home.arrivals.title'))).toBeNull();
  });

  it('while an exchange waits on the phone, the figures say Provisional and include it', async () => {
    signIn('store_employee', EMPLOYEE, 'money_agent');
    useQueue.setState({ items: [queued()] });
    mount(<HomeScreen />);
    expect(await screen.findByTestId('positions-provisional')).toBeTruthy();
    expect(screen.getByText(t('agent.today.pending', { count: 1 }))).toBeTruthy();
    // Give cash 5 000 / receive Bankily credit at 2 %: the drawer 99 400 − 5 000; the float 12 490 + 5 000 + 100.
    expect(within(screen.getByTestId('position-cash')).getByText(/^94\s400\sMRU$/)).toBeTruthy();
    expect(within(screen.getByTestId('position-provider:bankily')).getByText(/^17\s590\sMRU$/)).toBeTruthy();
    // The unknown float stays Unknown, whatever is queued for it.
    expect(within(screen.getByTestId('position-provider:masrvi')).getByText(t('moneyTab.held.unknown'))).toBeTruthy();
    // Without the report key there is no count at all — never a zero.
    expect(screen.queryByText(t('agent.today.commission'))).toBeNull();
  });

  it('a combined branch: Receive and Sell side by side, New exchange on its own row', async () => {
    signIn('owner', OWNER, 'both');
    mount(<HomeScreen />);
    expect(await screen.findByText(t('nav.agent.new'))).toBeTruthy();
    expect(screen.getByText(t('home.shortcut.sell'))).toBeTruthy();
    expect(screen.getByText(t('home.shortcut.receive'))).toBeTruthy();
  });

  it('a counter not opened yet says what waits in its own words — exchanges, never selling or receiving', async () => {
    signIn('owner', OWNER, 'money_agent');
    dayView = { businessDate: '2026-10-09', localDate: '2026-10-09', door: 'never_opened', standing: 'open' };
    mount(<HomeScreen />);
    expect(await screen.findByText('The counter has not been opened for 9 Oct 2026. Open it to record exchanges.')).toBeTruthy();
    expect(screen.queryByText(/to sell or receive/)).toBeNull();
  });

  it('a shop: nothing of the counter', async () => {
    signIn('owner', OWNER, 'electronics');
    mount(<HomeScreen />);
    expect(await screen.findByText(t('home.shortcut.sell'))).toBeTruthy();
    await settle();
    expect(screen.queryByText(t('nav.agent.new'))).toBeNull();
    expect(screen.queryByText(t('agent.today.title'))).toBeNull();
  });
});

describe('the exchanges', () => {
  it('the phone’s own come first as Pending synchronization; the server’s are masked; the search sends the last four digits only', async () => {
    signIn('store_employee', EMPLOYEE, 'money_agent');
    useQueue.setState({ items: [queued()] });
    mount(<AgentTransactionsTab />);
    expect(await screen.findByText(t('agent.list.onThisPhone'))).toBeTruthy();
    expect(screen.getByText(t('agent.pending'))).toBeTruthy();
    expect(screen.getByText('Gave cash, received Bankily credit')).toBeTruthy();
    expect(await screen.findByText('Received cash, sent Bankily credit')).toBeTruthy();
    expect(screen.getByText('•••• 1234')).toBeTruthy();
    // Today, on the server's business day.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/agent/transactions?from=2026-10-09&to=2026-10-09'));

    fireEvent.changeText(screen.getByPlaceholderText(t('agent.search.number')), '3456');
    await waitFor(() => expect((api.get as jest.Mock).mock.calls.some(([p]) => String(p).includes('last4=3456'))).toBe(true), { timeout: 3000 });
    // A whole number is never sent: the list stays masked.
    fireEvent.changeText(screen.getByPlaceholderText(t('agent.search.number')), '36123456');
    expect(await screen.findByText(t('agent.search.number.hint'), {}, { timeout: 3000 })).toBeTruthy();
    expect((api.get as jest.Mock).mock.calls.some(([p]) => String(p).includes('36123456'))).toBe(false);
  });
});

describe('one exchange', () => {
  it('for the counter: the number masked, a mistake may be reported, no reversal', async () => {
    signIn('store_employee', EMPLOYEE, 'money_agent');
    mount(<ExchangeDetailScreen />);
    expect(await screen.findByText('•••• 1234')).toBeTruthy();
    expect(screen.queryByText('00001234')).toBeNull();
    // Awaited: the action waits for the entitlement's activity, which may answer after the exchange (seen under load).
    expect(await screen.findByText(t('agent.mistake.action'))).toBeTruthy();
    expect(screen.queryByText(t('agent.reverse.action'))).toBeNull();
    expect(screen.getByText('Commission (2 %)')).toBeTruthy();
    expect(screen.getByText('Credited to your Bankily float.')).toBeTruthy();
  });

  it('for a Manager the server sends the number whole, and the exchange may be reversed once', async () => {
    signIn('store_manager', MANAGER, 'both');
    detail = tx({ customerNumber: '00001234' });
    mount(<ExchangeDetailScreen />);
    expect(await screen.findByText('00001234')).toBeTruthy();
    expect(screen.getByText(t('agent.detail.numberRevealed'))).toBeTruthy();
    // Awaited for the same reason: the action waits for the entitlement's activity.
    expect(await screen.findByText(t('agent.reverse.action'))).toBeTruthy();
  });

  it('a number a cached answer still carries is never shown without agent.customer.reveal (review)', async () => {
    signIn('store_employee', EMPLOYEE, 'money_agent');
    // What a Manager's read left in a cache: the whole number. The Employee is shown the masked one.
    detail = tx({ customerNumber: '00001234' });
    mount(<ExchangeDetailScreen />);
    expect(await screen.findByText('•••• 1234')).toBeTruthy();
    expect(screen.queryByText('00001234')).toBeNull();
    expect(screen.queryByText(t('agent.detail.numberRevealed'))).toBeNull();
  });

  it('a reversed exchange shows its counter-legs apart, and offers nothing more', async () => {
    signIn('owner', OWNER, 'money_agent');
    detail = tx({
      status: 'reversed',
      reversal: { at: '2026-10-09T12:30:00.000Z', byName: 'Owner Boutique 2', reason: 'wrong direction' },
      legs: [
        ...(tx().legs as object[]),
        { account: 'cash', providerId: null, direction: 'outflow', amount: 10000, kind: 'reversal' },
        { account: 'provider', providerId: 'bankily', direction: 'outflow', amount: 200, kind: 'reversal' },
        { account: 'provider', providerId: 'bankily', direction: 'inflow', amount: 10000, kind: 'reversal' },
      ],
    });
    mount(<ExchangeDetailScreen />);
    expect(await screen.findByTestId('exchange-reversal')).toBeTruthy();
    expect(screen.getByText(t('agent.detail.reversalReason', { reason: 'wrong direction' }))).toBeTruthy();
    expect(within(screen.getByTestId('exchange-reversal')).getAllByText(t('agent.leg.kind.reversal'))).toHaveLength(3);
    expect(screen.queryByText(t('agent.reverse.action'))).toBeNull();
    expect(screen.queryByText(t('agent.mistake.action'))).toBeNull();
  });
});

describe('an exchange whose answer was lost (review)', () => {
  it('is "Not confirmed yet": checked again under the same key or removed after a look at the list — never "cancelled, nothing sent"', async () => {
    signIn('store_employee', EMPLOYEE, 'money_agent');
    const item = queued({ attempts: 1, lastError: { kind: 'timeout_uncertain', message: 'timeout' }, mayBeRecorded: true });
    useQueue.setState({ items: [item] });
    mount(<QueuedExchange item={item} />);
    expect(await screen.findByText(t('agent.uncertain.title'))).toBeTruthy();
    expect(screen.getByText(t('agent.outcome.uncertain.body'))).toBeTruthy();
    expect(screen.getByText(t('agent.action.checkAgain'))).toBeTruthy();
    expect(screen.getByText(t('agent.action.remove'))).toBeTruthy();
    expect(screen.queryByText(t('agent.action.cancel'))).toBeNull();
  });

  it('a key that already holds a record leads to the list, never to a new confirmation', async () => {
    signIn('store_employee', EMPLOYEE, 'money_agent');
    const item = queued({ state: 'needs_attention', attempts: 2, lastError: { kind: 'conflict', message: 'conflict', status: 409, code: 'idempotency_conflict' }, mayBeRecorded: true });
    useQueue.setState({ items: [item] });
    mount(<QueuedExchange item={item} onPrepareAgain={() => undefined} />);
    expect(await screen.findByText(t('agent.refusal.idempotency_conflict'))).toBeTruthy();
    expect(screen.getByText(t('agent.outcome.list'))).toBeTruthy();
    expect(screen.queryByText(t('agent.action.prepareAgain'))).toBeNull();
    expect(screen.queryByText(t('agent.action.cancel'))).toBeNull();
  });
});
