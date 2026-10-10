/// <reference types="jest" />
/**
 * A refused offline exchange has a clear outcome (D161), as the phone shows it:
 * the six states of a queued exchange, each in words beside its colour, with
 * the actions that state allows — and the queue engine behind them: "Check
 * again" asks the server's status lookup (never a blind resend), "Send again"
 * resends unchanged under the same key, "Review and send" / "Edit and send"
 * prepare it again, and "Remove" is asked twice.
 *
 * The lookup's answers are the shape of `GET agent/transactions/client/:key`;
 * numbers and rates are INVENTED fixtures.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { useI18n, t } from '../lib/i18n';
import { useConnectivity } from '../lib/connectivity';
import { api, ApiError } from '../lib/api-client';
import { useQueue } from '../lib/offline/queue';
import { numberKey, sealNumber } from '../lib/offline/agent-exchange';
import { QueuedExchange } from '../components/agent/QueuedExchange';
import type { QueueItem } from '../lib/offline/queue-rules';

// `jest.mock` is hoisted above these imports; the factories read the `mock…` stores only when called.
const mockStore = new Map<string, string>();
const mockWrites: string[] = [];

jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../lib/offline/queue-store', () => ({
  readQueue: () => ({ items: [], quarantined: false }),
  writeQueue: (_scope: unknown, items: unknown) => void mockWrites.push(JSON.stringify(items)),
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

const SCOPE = { companyId: 'c1', branchId: 'b1', userId: 'u1' };
const KEY = '11111111-1111-4111-8111-111111111111';
const NUMBER = '36123456';
const EMPLOYEE = ['agent.transaction.record', 'agent.transaction.view'] as Permission[];

const queued = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: 'q1', kind: 'agent.exchange.record', clientUuid: KEY, ...SCOPE, payloadVersion: 1,
  payload: { providerId: 'bankily', direction: 'cash_in_credit_out', amount: 10000, configVersionId: 'cfg-7', deviceRecordedAt: '2026-10-10T09:00:00.000Z' },
  state: 'waiting_for_connection', createdAt: 1, lastAttemptAt: null, attempts: 0, summary: 'Cash in, credit out · 10 000 MRU · Bankily', lastError: null, ...over,
});
const serverTx = (over: Record<string, unknown> = {}) => ({
  id: 't-9', branchId: 'b1', status: 'completed', direction: 'cash_in_credit_out', providerId: 'bankily', providerLabel: 'Bankily', amount: 10000, commission: 200,
  customerNumberMasked: '•••• 3456', businessDate: '2026-10-10', recordedAt: '2026-10-10T09:00:02.000Z', recordedByName: 'Employee Boutique 2', configVersionId: 'cfg-7',
  deviceRecordedAt: '2026-10-10T09:00:00.000Z', ...over,
});
const recordedAnswer = (over: Record<string, unknown> = {}) => ({
  id: 't-9', recordedAt: '2026-10-10T09:00:02.000Z', businessDate: '2026-10-10', recordedBy: { id: 'u1', name: 'Employee Boutique 2' }, commission: { amount: 200 }, customerNumberMasked: '•••• 3456', ...over,
});

/** One exchange in the queue, its number sealed under its scoped key, and its block on screen. */
function show(item: QueueItem, onPrepareAgain?: () => void) {
  useQueue.setState({ items: [item] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Live() {
    const current = useQueue((s) => s.items.find((i) => i.id === item.id)) ?? item;
    return <QueuedExchange item={current} onPrepareAgain={onPrepareAgain} />;
  }
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <Live />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
const stateOf = () => useQueue.getState().items[0];

beforeEach(async () => {
  await useI18n.getState().setLanguage('en');
  mockStore.clear();
  mockWrites.length = 0;
  mockStore.set(numberKey(SCOPE, KEY), sealNumber(SCOPE, NUMBER));
  useConnectivity.setState({ online: true });
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 2 Annexe', role: 'store_employee' });
  usePermissionStore.setState({ granted: new Set(EMPLOYEE), branchId: 'b1', status: 'ready', error: null });
  useQueue.setState({ items: [], running: false, checking: [], scope: SCOPE });
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.startsWith('/auth/permissions')) return { branchId: 'b1', permissions: EMPLOYEE };
    throw new Error(`unexpected GET ${path}`);
  });
});
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

describe('pending and synchronizing', () => {
  it('pending: Pending synchronization, cancelled only after a second tap — nothing is sent, its number leaves the phone', async () => {
    useConnectivity.setState({ online: false });
    show(queued());
    expect(screen.getByTestId('exchange-pending')).toBeTruthy();
    expect(screen.getByText(t('agent.pending'))).toBeTruthy();
    expect(screen.getByText(t('agent.outcome.pending.body'))).toBeTruthy();
    expect(screen.queryByText(t('agent.action.remove'))).toBeNull();
    fireEvent.press(screen.getByText(t('agent.action.cancel')));
    expect(stateOf().state).toBe('waiting_for_connection');
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.cancelConfirm')));
    });
    expect(stateOf().state).toBe('cancelled');
    expect(await screen.findByText(t('agent.outcome.cancelled'))).toBeTruthy();
    await waitFor(() => expect(mockStore.has(numberKey(SCOPE, KEY))).toBe(false));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('synchronizing: on its way, nothing to cancel', () => {
    show(queued({ state: 'sending', attempts: 1, lastAttemptAt: 1 }));
    expect(screen.getByText(t('agent.pending'))).toBeTruthy();
    expect(screen.getByText(t('agent.outcome.sending'))).toBeTruthy();
    expect(screen.queryByText(t('agent.action.cancel'))).toBeNull();
    expect(screen.queryByText(t('agent.action.remove'))).toBeNull();
  });
});

describe('confirmed', () => {
  it('the server’s record: its time, business day, recorder and commission — no action left', () => {
    show(queued({ state: 'synced', result: { id: 't-9', recordedAt: '2026-10-10T09:00:02.000Z', businessDate: '2026-10-10', recordedByName: 'Employee Boutique 2', commission: 200 } }));
    expect(screen.getByTestId('exchange-recorded')).toBeTruthy();
    expect(screen.getByText(t('agent.outcome.recorded.title'))).toBeTruthy();
    expect(screen.getByText(/Recorded by the server at \d\d:\d\d, business day 10 Oct 2026, by Employee Boutique 2\./)).toBeTruthy();
    expect(screen.getByText(/Commission recorded: 200/)).toBeTruthy();
    expect(screen.queryByText(t('agent.action.cancel'))).toBeNull();
    expect(screen.queryByText(t('agent.action.remove'))).toBeNull();
  });
});

describe('uncertain — the status lookup decides, never a blind resend', () => {
  const uncertain = () => queued({ state: 'uncertain', attempts: 1, lastAttemptAt: 1, lastError: { kind: 'timeout_uncertain', message: 'timeout' } });

  it('recorded and matching: Check again confirms it with the server’s record, and the number leaves the phone', async () => {
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path === `/agent/transactions/client/${KEY}`) return { recorded: true, transaction: serverTx() };
      return { branchId: 'b1', permissions: EMPLOYEE };
    });
    show(uncertain());
    expect(screen.getByText(t('agent.state.uncertain'))).toBeTruthy();
    expect(screen.queryByText(t('agent.action.cancel'))).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.checkAgain')));
    });
    expect(api.get).toHaveBeenCalledWith(`/agent/transactions/client/${KEY}`);
    expect(api.post).not.toHaveBeenCalled();
    expect(stateOf().state).toBe('synced');
    expect(stateOf().result).toEqual({ id: 't-9', recordedAt: '2026-10-10T09:00:02.000Z', businessDate: '2026-10-10', recordedByName: 'Employee Boutique 2', commission: 200 });
    expect(await screen.findByText(t('agent.outcome.recorded.title'))).toBeTruthy();
    await waitFor(() => expect(mockStore.has(numberKey(SCOPE, KEY))).toBe(false));
  });

  it('not recorded: pending again and sent under the SAME key, then confirmed', async () => {
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/agent/transactions/client/')) return { recorded: false };
      return { branchId: 'b1', permissions: EMPLOYEE };
    });
    (api.post as jest.Mock).mockResolvedValue(recordedAnswer());
    show(uncertain());
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.checkAgain')));
    });
    await waitFor(() => expect(stateOf().state).toBe('synced'));
    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = (api.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/agent/transactions');
    expect(body.clientUuid).toBe(KEY);
    expect(body.customerNumber).toBe(NUMBER);
  });

  it('recorded and different: Not recorded here, with the server’s masked record beside this exchange’s details', async () => {
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/agent/transactions/client/')) return { recorded: true, transaction: serverTx({ amount: 9000, customerNumberMasked: '•••• 9999' }) };
      return { branchId: 'b1', permissions: EMPLOYEE };
    });
    show(uncertain());
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.checkAgain')));
    });
    expect(stateOf().state).toBe('rejected_reenter');
    expect(stateOf().lastError?.code).toBe('idempotency_conflict');
    expect(await screen.findByTestId('exchange-rejected-reenter')).toBeTruthy();
    const other = screen.getByTestId('exchange-other-record');
    expect(within(other).getByText(t('agent.rejected.other'))).toBeTruthy();
    expect(within(other).getByText('•••• 9999')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('the lookup unreachable: still uncertain, said plainly, Check again stays', async () => {
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/agent/transactions/client/')) throw new TypeError('Network request failed');
      return { branchId: 'b1', permissions: EMPLOYEE };
    });
    show(uncertain());
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.checkAgain')));
    });
    expect(stateOf().state).toBe('uncertain');
    expect(await screen.findByText(t('agent.uncertain.unreachable'))).toBeTruthy();
    expect(screen.getByText(t('agent.action.checkAgain'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('removed from this phone only after a second tap', async () => {
    show(uncertain());
    fireEvent.press(screen.getByText(t('agent.action.remove')));
    expect(stateOf().state).toBe('uncertain');
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.removeConfirm')));
    });
    expect(stateOf().state).toBe('cancelled');
    expect(stateOf().result?.removed).toBe(1);
    expect(await screen.findByText(t('agent.outcome.removed'))).toBeTruthy();
    await waitFor(() => expect(mockStore.has(numberKey(SCOPE, KEY))).toBe(false));
  });
});

describe('rejected — to fix and send', () => {
  it('a closed store: Not recorded, Send again resends it unchanged under the same key', async () => {
    (api.post as jest.Mock).mockResolvedValue(recordedAnswer());
    show(queued({ state: 'rejected_resubmit', attempts: 1, lastAttemptAt: 1, lastError: { kind: 'conflict', status: 409, code: 'store_closed', message: 'closed' } }));
    expect(screen.getByTestId('exchange-rejected-resubmit')).toBeTruthy();
    expect(screen.getByText(t('agent.refusal.title'))).toBeTruthy();
    expect(screen.getByText(t('agent.refusal.store_closed'))).toBeTruthy();
    expect(screen.queryByText(t('agent.pending'))).toBeNull();
    expect(screen.queryByText(t('agent.action.reviewAndSend'))).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.sendAgain')));
    });
    await waitFor(() => expect(stateOf().state).toBe('synced'));
    expect((api.post as jest.Mock).mock.calls[0][1].clientUuid).toBe(KEY);
  });

  it('a newer rate: Review and send prepares it again; an unaccepted number: Edit and send — never sent unchanged', () => {
    const prepare = jest.fn();
    const view = show(queued({ state: 'rejected_resubmit', lastError: { kind: 'conflict', status: 409, code: 'stale_configuration', message: 'stale' } }), prepare);
    expect(screen.getByText(t('agent.refusal.stale_configuration'))).toBeTruthy();
    expect(screen.queryByText(t('agent.action.sendAgain'))).toBeNull();
    fireEvent.press(screen.getByText(t('agent.action.reviewAndSend')));
    expect(prepare).toHaveBeenCalledTimes(1);
    view.unmount();

    show(queued({ state: 'rejected_resubmit', lastError: { kind: 'validation', status: 400, code: 'customer_number_invalid', message: 'bad' } }), prepare);
    expect(screen.getByText(t('agent.refusal.customer_number_invalid'))).toBeTruthy();
    fireEvent.press(screen.getByText(t('agent.action.editAndSend')));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(screen.getByText(t('agent.action.remove'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('rejected — to enter elsewhere', () => {
  it('a permission removed: Not recorded here, why and what to do, its details (never the full number), removed after a second tap', async () => {
    show(queued({ state: 'rejected_reenter', lastError: { kind: 'permission_denied', status: 403, code: 'permission_denied', message: 'no' } }));
    expect(screen.getByText(t('agent.state.rejectedHere'))).toBeTruthy();
    expect(screen.getByText(t('agent.refusal.permission_denied'))).toBeTruthy();
    const details = screen.getByTestId('exchange-details');
    expect(within(details).getByText('Cash in, credit out · 10 000 MRU · Bankily')).toBeTruthy();
    expect(within(details).getByText(/Saved on this phone at \d\d:\d\d/)).toBeTruthy();
    expect(screen.queryByText(/3612|3456/)).toBeNull();
    for (const absent of ['agent.action.sendAgain', 'agent.action.reviewAndSend', 'agent.action.editAndSend', 'agent.action.cancel', 'agent.action.checkAgain'] as const) {
      expect(screen.queryByText(t(absent))).toBeNull();
    }
    fireEvent.press(screen.getByText(t('agent.action.remove')));
    await act(async () => {
      fireEvent.press(screen.getByText(t('agent.action.removeConfirm')));
    });
    expect(stateOf().state).toBe('cancelled');
    await waitFor(() => expect(mockStore.has(numberKey(SCOPE, KEY))).toBe(false));
  });

  it('a key already used by another exchange: the engine shows the record the lookup found, masked', async () => {
    (api.post as jest.Mock).mockRejectedValue(new ApiError('conflict', 409, 'idempotency_conflict'));
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/agent/transactions/client/')) return { recorded: true, transaction: serverTx({ amount: 7000 }) };
      return { branchId: 'b1', permissions: EMPLOYEE };
    });
    show(queued());
    await act(async () => {
      await useQueue.getState().process();
    });
    expect(stateOf().state).toBe('rejected_reenter');
    expect(stateOf().serverRecord).toEqual(expect.objectContaining({ amount: 7000, numberMasked: '•••• 3456' }));
    expect(await screen.findByTestId('exchange-other-record')).toBeTruthy();
    for (const write of mockWrites) expect(write).not.toMatch(/36123456|customerNumber"/);
  });

  it('a timeout leaves it uncertain — never resent on its own; a suspended business answers Send again once access is back', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    show(queued());
    await act(async () => {
      await useQueue.getState().process();
    });
    expect(stateOf().state).toBe('uncertain');
    expect(api.post).toHaveBeenCalledTimes(1);
    (api.post as jest.Mock).mockRejectedValueOnce(new ApiError('suspended', 403, 'ENTITLEMENT_WRITE_BLOCKED', { state: 'suspended' }));
    await act(async () => {
      useQueue.setState({ items: [queued()] });
      await useQueue.getState().process();
    });
    expect(stateOf().state).toBe('rejected_resubmit');
    expect(await screen.findByText(t('agent.refusal.entitlement'))).toBeTruthy();
    expect(screen.getByText(t('agent.action.sendAgain'))).toBeTruthy();
  });
});
