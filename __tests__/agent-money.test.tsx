/// <reference types="jest" />
/**
 * The counter's money, as each role sees it (docs/73 §4.3–4.5, D155, D157):
 *
 *  - Money on an agent branch: the branch's floats on their own card, never
 *    among the company's accounts; Unknown stays Unknown with the day's
 *    movement; below zero in words; the drawer once — the top card's, or the
 *    floats card's for somebody without the figures; Provisional while the
 *    phone holds an exchange. A shop shows none of it.
 *  - The Owner sets a float's amount: this branch's float, one key per amount
 *    within an attempt, so a retry after a lost answer is the same record.
 *  - Rebalancing: the move typed once, the balance rule in view, the outside
 *    named for exactly the difference, a negative position refused by name and
 *    confirmable by the Owner alone.
 *  - Providers: each with how it stands; a blank shown as a blank, never a
 *    default; a version sent with its blanks as blanks.
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
import { isolateLtr } from '../lib/design/direction';
import type { QueueItem } from '../lib/offline/queue-rules';
import { push as routerPush } from './mocks/expo-router';

const mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('./mocks/expo-router'),
  useLocalSearchParams: () => mockParams,
  useRoute: () => ({ key: 'money-hub', name: 'money-hub' }),
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
import { RequestTimeout } from '../lib/offline/classify';
import { useQueue } from '../lib/offline/queue';
import MoneyTabScreen from '../app/(tabs)/money-hub';
import AgentRebalanceScreen from '../app/agent/rebalance';
import AgentProvidersScreen from '../app/agent/providers';
import AgentProviderScreen from '../app/agent/providers/[id]';

const AGENT_OWNER = ['agent.transaction.record', 'agent.transaction.view', 'agent.customer.reveal', 'agent.mistake.report', 'agent.transaction.reverse', 'agent.rebalance', 'agent.position.set', 'agent.report.view', 'agent.provider.manage'];
const OWNER = ['closing.count', 'closing.perform', 'report.view', 'expense.submit', 'loan.view', 'money.anchor.record', ...AGENT_OWNER] as Permission[];
const MANAGER = ['closing.count', 'closing.perform', 'report.view', 'expense.submit', 'loan.view', 'agent.transaction.record', 'agent.transaction.view', 'agent.customer.reveal', 'agent.mistake.report', 'agent.transaction.reverse', 'agent.rebalance', 'agent.report.view'] as Permission[];
const EMPLOYEE = ['closing.count', 'expense.submit', 'agent.transaction.record', 'agent.transaction.view', 'agent.mistake.report'] as Permission[];

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
    { providerId: 'sedad', providerLabel: 'Sedad', providerKind: 'sedad', accountKind: 'provider', known: true, position: -300, unknownReason: null, sinceAnchorNet: -300, anchor: { amount: 0, at: '2026-10-09T11:11:00.828Z', businessDate: '2026-10-09', byName: 'Owner Boutique 2', source: 'set' }, movement: day(0, 300) },
  ],
  commissionHeld: [
    { providerId: 'moov', providerLabel: 'Moov', providerKind: 'other', accountKind: 'commission_held', known: false, position: null, unknownReason: 'no_anchor', sinceAnchorNet: null, anchor: null, movement: day(50, 0) },
  ],
  total: null,
  unknownKeys: ['provider:masrvi', 'commission_held:moov'],
};
const config = (over: Record<string, unknown> = {}) => ({ id: 'cfg-7', rateInBp: 200, rateOutBp: 200, sameRateBothDirections: true, commissionDestination: 'provider_float', principalFeeMode: 'separate', referenceRule: 'optional', effectiveFrom: '2026-10-09T11:11:02.585Z', recordedByName: 'Owner Boutique 2', reason: 'INVENTED fixture', ...over });
const providers = {
  providers: [
    { id: 'bankily', kind: 'bankily', label: 'Bankily', isActive: true, sortOrder: 0, readyForTransactions: true, missing: [], config: config() },
    { id: 'blank', kind: 'other', label: 'Blank Co', isActive: true, sortOrder: 0, readyForTransactions: false, missing: ['rateInBp', 'rateOutBp', 'commissionDestination', 'principalFeeMode', 'referenceRule'], config: null },
    { id: 'moov', kind: 'other', label: 'Moov', isActive: false, sortOrder: 0, readyForTransactions: true, missing: [], config: config({ id: 'cfg-m', rateInBp: 100, rateOutBp: 100, commissionDestination: 'held_separately' }) },
    { id: 'sedad', kind: 'sedad', label: 'Sedad', isActive: true, sortOrder: 0, readyForTransactions: true, missing: [], config: config({ id: 'cfg-s', rateInBp: 150, rateOutBp: 50, sameRateBothDirections: false, commissionDestination: 'cash', referenceRule: 'required' }) },
  ],
};

let activity: Activity = 'money_agent';
function serve(path: string): unknown {
  if (path.startsWith('/entitlement')) return entitlement(activity);
  if (path.startsWith('/agent/positions')) return positions;
  if (path.startsWith('/agent/providers/') && path.endsWith('/configs')) return { configs: [] };
  if (path.startsWith('/agent/providers')) return providers;
  if (path.startsWith('/agent/rebalancings')) return { from: '2026-10-09', to: '2026-10-09', rows: [] };
  if (path.startsWith('/closings/business-day')) return { businessDate: '2026-10-09', localDate: '2026-10-09', door: 'open' };
  // Money's own figures are not this test's subject: they stay loading.
  return new Promise(() => undefined);
}

function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
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
  id: 'q1', kind: 'agent.exchange.record', clientUuid: 'k1', companyId: 'c1', branchId: 'b1', userId: 'u-owner', payloadVersion: 1,
  payload: { providerId: 'bankily', direction: 'cash_out_credit_in', amount: 5000, configVersionId: 'cfg-7', deviceRecordedAt: '2026-10-09T12:00:00.000Z' },
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 'Cash out, credit in · 5 000 MRU · Bankily', lastError: null, ...over,
});

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
/** A sheet's step waits for the one before it to be gone (`BottomSheet`'s dismissal report, at most 800 ms). */
const sheetGone = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 900)));

beforeEach(async () => {
  await useI18n.getState().setLanguage('en');
  for (const fn of [api.get, api.post, api.patch] as jest.Mock[]) fn.mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => serve(path));
  useQueue.setState({ items: [], running: false, scope: { companyId: 'c1', branchId: 'b1', userId: 'u-owner' } });
  mockParams.id = undefined;
});
afterEach(() => settle());

describe('Money on an agent branch', () => {
  it('the floats on their own card: each provider apart, Unknown with its day, below zero in words — the drawer left to the top card', async () => {
    signIn('owner', OWNER, 'money_agent');
    mount(<MoneyTabScreen />);
    const card = await screen.findByTestId('money-floats');
    expect(within(card).getByText(t('agent.money.title'))).toBeTruthy();
    expect(await within(card).findByText(t('agent.positions.float', { provider: 'Bankily' }))).toBeTruthy();
    expect(within(card).getByText(t('agent.positions.held', { provider: 'Moov' }))).toBeTruthy();
    // The drawer is the top card's line: never twice on Money.
    expect(within(card).queryByTestId('position-cash')).toBeNull();
    // Unknown stays Unknown, with what moved through it today beside it.
    const masrvi = within(card).getByTestId('position-provider:masrvi');
    expect(within(masrvi).getByText(t('moneyTab.held.unknown'))).toBeTruthy();
    expect(within(masrvi).getByText(/\+200/)).toBeTruthy();
    // Below zero is said in words beside the figure.
    expect(within(within(card).getByTestId('position-provider:sedad')).getByText(t('agent.positions.negative'))).toBeTruthy();
    expect(within(card).queryByTestId('positions-provisional')).toBeNull();
    // The Owner may set a float.
    expect(within(card).getByText(t('agent.setFloat.action'))).toBeTruthy();
  });

  it('without the figures, the floats card carries the drawer itself; nobody but the Owner sets a float', async () => {
    signIn('store_employee', EMPLOYEE, 'money_agent');
    mount(<MoneyTabScreen />);
    const card = await screen.findByTestId('money-floats');
    expect(await within(card).findByTestId('position-cash')).toBeTruthy();
    expect(within(card).queryByText(t('agent.setFloat.action'))).toBeNull();
  });

  it('while an exchange waits on the phone the floats say Provisional and include it', async () => {
    signIn('owner', OWNER, 'both');
    useQueue.setState({ items: [queued()] });
    mount(<MoneyTabScreen />);
    const card = await screen.findByTestId('money-floats');
    expect(await within(card).findByTestId('positions-provisional')).toBeTruthy();
    // Give cash 5 000 / receive Bankily credit at 2 %: the float 12 490 + 5 000 + 100.
    expect(within(within(card).getByTestId('position-provider:bankily')).getByText(/^17\s590\sMRU$/)).toBeTruthy();
  });

  it('a shop shows no float at all', async () => {
    signIn('owner', OWNER, 'electronics');
    mount(<MoneyTabScreen />);
    await settle();
    await settle();
    expect(screen.queryByTestId('money-floats')).toBeNull();
    expect((api.get as jest.Mock).mock.calls.some(([p]) => String(p).startsWith('/agent/'))).toBe(false);
  });
});

describe('the Owner sets a float', () => {
  it('this branch’s float, from the provider’s app; a retry after a lost answer is the same record', async () => {
    signIn('owner', OWNER, 'money_agent');
    mount(<MoneyTabScreen />);
    fireEvent.press(await screen.findByText(t('agent.setFloat.action')));
    // The list: each float and each held commission, Unknown kept Unknown — never the drawer.
    expect(await screen.findByText(t('agent.setFloat.title'))).toBeTruthy();
    fireEvent.press(screen.getAllByText(t('agent.positions.float', { provider: 'Masrvi' })).slice(-1)[0]);
    await sheetGone();
    expect(await screen.findByText(t('agent.setFloat.branchOnly', { provider: 'Masrvi' }))).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(t('agent.setFloat.amount'), { exact: false }), '1500');
    (api.post as jest.Mock).mockRejectedValueOnce(new RequestTimeout()).mockResolvedValueOnce({ position: {}, float: positions.floats[1] });
    fireEvent.press(screen.getByText(t('moneyTab.anchor.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await settle();
    fireEvent.press(screen.getByText(t('moneyTab.anchor.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const [[path, first], [, second]] = (api.post as jest.Mock).mock.calls;
    expect(path).toBe('/agent/positions');
    expect(first).toEqual({ clientUuid: expect.any(String), providerId: 'masrvi', accountKind: 'provider', amount: 1500 });
    expect(second.clientUuid).toBe(first.clientUuid);
  });
});

describe('rebalancing', () => {
  it('buying float with cash: the amount typed once, balanced, sent as two legs', async () => {
    signIn('store_manager', MANAGER, 'money_agent');
    (api.post as jest.Mock).mockResolvedValue({ rebalancing: { id: 'r1' } });
    mount(<AgentRebalanceScreen />);
    expect(await screen.findByTestId('rebalance-line-1')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText(t('agent.rebalance.reason.placeholder')), 'Bought float with cash');
    fireEvent.changeText(within(screen.getByTestId('rebalance-line-0')).getByPlaceholderText(t('agent.amount')), '10000');
    // The other line follows: one amount, typed once.
    expect(within(screen.getByTestId('rebalance-line-1')).getByDisplayValue(/10\s?000/)).toBeTruthy();
    expect(within(screen.getByTestId('rebalance-balance')).getByText(t('agent.rebalance.balanced'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('agent.rebalance.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = (api.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/agent/rebalancings');
    expect(body).toEqual({
      clientUuid: expect.any(String),
      reason: 'Bought float with cash',
      legs: [
        { account: 'cash', direction: 'outflow', amount: 10000 },
        { account: 'provider', providerId: 'bankily', direction: 'inflow', amount: 10000 },
      ],
    });
  });

  it('money from outside: the outside is named for exactly the difference, never typed', async () => {
    signIn('owner', OWNER, 'money_agent');
    (api.post as jest.Mock).mockResolvedValue({ rebalancing: { id: 'r2' } });
    mount(<AgentRebalanceScreen />);
    expect(await screen.findByTestId('rebalance-line-1')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('rebalance-line-1')).getByText(t('agent.rebalance.removeLine')));
    fireEvent.press(within(screen.getByTestId('rebalance-line-0')).getByText(t('agent.rebalance.in')));
    fireEvent.changeText(within(screen.getByTestId('rebalance-line-0')).getByPlaceholderText(t('agent.amount')), '50000');
    fireEvent.press(screen.getByText(t('agent.rebalance.reasons.cashIn')));
    // Unbalanced: sending is refused until the outside is named.
    fireEvent.press(screen.getByText(t('agent.rebalance.save')));
    expect(await screen.findByTestId('rebalance-problems')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText(t('agent.rebalance.outside.owner_capital')));
    fireEvent.press(screen.getByText(t('agent.rebalance.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post as jest.Mock).mock.calls[0][1]).toEqual({
      clientUuid: expect.any(String),
      reason: t('agent.rebalance.reasons.cashIn'),
      legs: [{ account: 'cash', direction: 'inflow', amount: 50000 }],
      externalCounterparty: 'owner_capital',
      externalAmount: 50000,
    });
  });

  it('a position taken below zero is refused by name; the Owner alone may record it anyway', async () => {
    signIn('owner', OWNER, 'money_agent');
    (api.post as jest.Mock)
      .mockRejectedValueOnce(new ApiError('Cash would go to -65000 MRU', 409, 'rebalancing_negative', { code: 'rebalancing_negative', problems: [{ account: 'cash', providerId: null, position: 35000, after: -65000 }] }))
      .mockResolvedValueOnce({ rebalancing: { id: 'r3' } });
    mount(<AgentRebalanceScreen />);
    expect(await screen.findByTestId('rebalance-line-1')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText(t('agent.rebalance.reason.placeholder')), 'buy float');
    fireEvent.changeText(within(screen.getByTestId('rebalance-line-0')).getByPlaceholderText(t('agent.amount')), '100000');
    fireEvent.press(screen.getByText(t('agent.rebalance.save')));
    const notice = await screen.findByTestId('rebalance-negative');
    expect(within(notice).getByText(/Cash in the drawer would go to/)).toBeTruthy();
    fireEvent.press(within(notice).getByText(t('agent.rebalance.negative.confirm')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const [[, refused], [, confirmed]] = (api.post as jest.Mock).mock.calls;
    expect(refused.confirmNegative).toBeUndefined();
    expect(confirmed.confirmNegative).toBe(true);
    expect(confirmed.clientUuid).not.toBe(refused.clientUuid);
  });

  it('a Manager is told only the Owner can record it below zero', async () => {
    signIn('store_manager', MANAGER, 'money_agent');
    (api.post as jest.Mock).mockRejectedValueOnce(new ApiError('x', 409, 'rebalancing_negative', { problems: [{ account: 'provider', providerId: 'bankily', position: 10, after: -90 }] }));
    mount(<AgentRebalanceScreen />);
    expect(await screen.findByTestId('rebalance-line-1')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText(t('agent.rebalance.reason.placeholder')), 'sell float');
    fireEvent.press(within(screen.getByTestId('rebalance-line-0')).getByText(t('agent.rebalance.in')));
    fireEvent.press(within(screen.getByTestId('rebalance-line-1')).getByText(t('agent.rebalance.out')));
    fireEvent.changeText(within(screen.getByTestId('rebalance-line-0')).getByPlaceholderText(t('agent.amount')), '100');
    fireEvent.press(screen.getByText(t('agent.rebalance.save')));
    const notice = await screen.findByTestId('rebalance-negative');
    expect(within(notice).getByText(/Bankily float would go to/)).toBeTruthy();
    expect(within(notice).queryByText(t('agent.rebalance.negative.confirm'))).toBeNull();
  });
});

describe('providers', () => {
  it('each with how it stands: ready with its rates, a blank named, switched off', async () => {
    signIn('owner', OWNER, 'money_agent');
    mount(<AgentProvidersScreen />);
    expect(await screen.findByText('Blank Co')).toBeTruthy();
    expect(screen.getByText(t('agent.providers.rate.both', { rate: isolateLtr('2') }))).toBeTruthy();
    expect(screen.getAllByText(t('agent.providers.status.ready')).length).toBe(2);
    expect(screen.getByText(t('agent.providers.status.not_set_up'))).toBeTruthy();
    expect(screen.getByText(t('agent.providers.status.switched_off'))).toBeTruthy();
    expect(screen.getByText(/^Not set: rate receiving cash · rate giving cash/)).toBeTruthy();
  });

  it('a Manager does not configure providers', async () => {
    signIn('store_manager', MANAGER, 'money_agent');
    mount(<AgentProvidersScreen />);
    expect(await screen.findByText(t('agent.providers.permission'))).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/agent/providers');
  });

  it('a blank is shown as a blank, and a version is sent with its blanks as blanks — never a default', async () => {
    signIn('owner', OWNER, 'money_agent');
    mockParams.id = 'blank';
    (api.post as jest.Mock).mockResolvedValue({ config: config({ rateInBp: 150 }), provider: providers.providers[1] });
    mount(<AgentProviderScreen />);
    const fields = await screen.findByTestId('provider-config');
    expect(within(fields).getAllByText(t('agent.config.blank'))).toHaveLength(6);
    fireEvent.press(screen.getByText(t('agent.config.change')));
    // Nothing is chosen for the Owner: every choice starts on Not set.
    expect(await screen.findByText(t('agent.config.sameRate.question'))).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(t('agent.config.rateIn'), { exact: false }), '1.5');
    fireEvent.changeText(screen.getByLabelText(t('agent.config.reason'), { exact: false }), 'Schedule of October');
    fireEvent.press(screen.getByText(t('agent.config.save')));
    // A rate typed: whether it is the same both ways is asked, never assumed.
    expect(await screen.findByText(t('agent.config.problem.same_rate_unanswered'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText(t('agent.config.sameRate.no')));
    fireEvent.press(screen.getByText(t('agent.config.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post as jest.Mock).mock.calls[0]).toEqual([
      '/agent/providers/blank/configs',
      // With its request key (D160): saved again after a lost answer, it is the same version, never a second one.
      { clientRequestId: expect.any(String), rateInBp: 150, rateOutBp: null, sameRateBothDirections: false, commissionDestination: null, principalFeeMode: null, referenceRule: null, reason: 'Schedule of October' },
    ]);
  });

  it('adding a provider sends one request key per submission: a retry after a lost answer reuses it, and a replayed answer is a success (D160)', async () => {
    signIn('owner', OWNER, 'money_agent');
    const created = { ...providers.providers[1], id: 'p-new', label: 'Sedad', kind: 'sedad' };
    (api.post as jest.Mock).mockRejectedValueOnce(new RequestTimeout()).mockResolvedValueOnce({ ...created, replayed: true });
    mount(<AgentProvidersScreen />);
    fireEvent.press(await screen.findByText(t('agent.providers.add')));
    // The sheet's chip (the list behind it names a Sedad too); choosing it fills its own name.
    await screen.findByText(t('agent.providers.kind.other'));
    fireEvent.press(screen.getAllByText(t('agent.providers.kind.sedad')).at(-1)!);
    fireEvent.press(screen.getByText(t('agent.providers.add.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await settle();
    // The answer was lost: Save again is the same submission, under the same key.
    fireEvent.press(screen.getByText(t('agent.providers.add.save')));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const [[path, first], [, second]] = (api.post as jest.Mock).mock.calls;
    expect(path).toBe('/agent/providers');
    expect(first).toEqual({ clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/), kind: 'sedad', label: 'Sedad' });
    expect(second.clientRequestId).toBe(first.clientRequestId);
    // Replayed by the server: the original provider, taken as added — straight to its configuration.
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/agent/providers/p-new'));
  });
});
