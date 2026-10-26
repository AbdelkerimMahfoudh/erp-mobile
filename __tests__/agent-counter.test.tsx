/// <reference types="jest" />
/**
 * The counter flow as the phone runs it (docs/73 §5.2–5.3, D155, D157, D164):
 * the direction as two cards in words, any provider switched on, the commission
 * the customer pays typed for the exchange — never an empty field read as zero —,
 * one review with the amount, the commission, the cash and the credit, then Confirm —
 * through the offline queue under the form's own key. The customer's number
 * reaches the server and nothing else: never the queue file, never the draft,
 * never the summary. Offline it waits as Pending synchronization; a refusal is
 * said in the counter's words and prepared again under a new key; the unsent
 * form survives a restart with its number.
 *
 * Providers and answers are the backend's serialized shapes (D164); figures are INVENTED.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { useI18n, t } from '../lib/i18n';
import { useConnectivity } from '../lib/connectivity';
import { formatDate, formatMoney, formatTime } from '../lib/format';
import * as layoutDirection from '../lib/design/layout-direction';

const mockStore = new Map<string, string>();
const mockQueueWrites: string[] = [];
const mockDrafts = new Map<string, string>();

jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../lib/offline/queue-store', () => ({
  readQueue: () => ({ items: [], quarantined: false }),
  writeQueue: (_scope: unknown, items: unknown) => void mockQueueWrites.push(JSON.stringify(items)),
}));
jest.mock('../lib/offline/drafts', () => ({
  saveDraft: (form: string, _scope: unknown, value: unknown, payloadVersion: number) => {
    mockDrafts.set(form, JSON.stringify({ value, payloadVersion, savedAt: 1 }));
    return { saved: true };
  },
  loadDraft: (form: string) => {
    const raw = mockDrafts.get(form);
    return raw ? { value: JSON.parse(raw).value, savedAt: 1 } : null;
  },
  clearDraft: (form: string) => void mockDrafts.delete(form),
}));
jest.mock('../lib/offline/kept-providers', () => ({
  keepProviders: jest.fn(),
  readKeptProviders: jest.fn(() => null),
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
  useAuth: () => ({ user: { id: 'u1', companyId: 'c1', name: 'Employee Boutique 2' }, bootstrapping: false, signOut: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api, ApiError } from '../lib/api-client';
import { useQueue } from '../lib/offline/queue';
import { numberKey } from '../lib/offline/agent-exchange';
import { keepProviders, readKeptProviders } from '../lib/offline/kept-providers';
import NewExchangeScreen from '../app/agent/new';

const NUMBER = '36123456';
const SCOPE = { companyId: 'c1', branchId: 'b1', userId: 'u1' };
const EMPLOYEE = ['agent.transaction.record', 'agent.transaction.view', 'agent.mistake.report', 'closing.count', 'expense.submit'] as Permission[];

const providers = {
  providers: [
    {
      id: 'bankily', kind: 'bankily', label: 'Bankily', isActive: true, sortOrder: 0, referenceRule: 'optional',
      config: { id: 'cfg-7', referenceRule: 'optional', effectiveFrom: '2026-10-09T11:11:02.585Z', recordedByName: 'Owner Boutique 2', reason: 'INVENTED fixture', legacy: null },
    },
    // Never configured: usable at once (D164).
    { id: 'sedad', kind: 'sedad', label: 'Sedad', isActive: true, sortOrder: 1, referenceRule: 'optional', config: null },
    { id: 'moov', kind: 'other', label: 'Moov', isActive: false, sortOrder: 2, referenceRule: 'optional', config: null },
  ],
};
const entitlement = {
  state: 'active', canRead: true, canWrite: true, status: 'activated', isComplimentary: false, calculatedAt: '2026-10-09T11:00:00.000Z',
  seatsByStore: [{ branchId: 'b1', name: 'Boutique 2 Annexe', activity: 'money_agent', activityNext: null }],
};
const recorded = (clientUuidBody: { amount: number }) => ({
  id: 't-1', branchId: 'b1', providerId: 'bankily', providerLabel: 'Bankily', direction: 'cash_in_credit_out', amount: clientUuidBody.amount, customerNumberMasked: '•••• 3456', providerReference: null,
  commission: { amount: 200, source: 'manual', legacy: null },
  legs: [], businessDate: '2026-10-09', recordedAt: '2026-10-09T11:11:02.660Z', deviceRecordedAt: null, recordedBy: { id: 'u1', name: 'Employee Boutique 2' }, status: 'completed', reversal: null, mistakes: [],
});

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <NewExchangeScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** Direction, provider, amount, commission and number — the whole form, as a person fills it. */
async function fillForm() {
  await fireEvent.press(await screen.findByText('Receive cash → send digital credit'));
  await fireEvent.press(await screen.findByText('Bankily'));
  await fireEvent.changeText(await screen.findByLabelText(t('agent.amount')), '10000');
  await fireEvent.changeText(screen.getByLabelText(t('agent.commission')), '200');
  await fireEvent.changeText(screen.getByLabelText(t('agent.number')), '36 12 34 56');
}

beforeEach(async () => {
  await useI18n.getState().setLanguage('en');
  mockStore.clear();
  mockQueueWrites.length = 0;
  mockDrafts.clear();
  useConnectivity.setState({ online: true });
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 2 Annexe', role: 'store_employee' });
  usePermissionStore.setState({ granted: new Set(EMPLOYEE), branchId: 'b1', status: 'ready', error: null });
  useQueue.setState({ items: [], running: false, scope: null });
  useQueue.getState().load({ companyId: 'c1', branchId: 'b1', userId: 'u1' });
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
  (keepProviders as jest.Mock).mockClear();
  (readKeptProviders as jest.Mock).mockReset().mockReturnValue(null);
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.startsWith('/agent/providers')) return providers;
    if (path.startsWith('/entitlement')) return entitlement;
    if (path.startsWith('/auth/permissions')) return { branchId: 'b1', permissions: EMPLOYEE };
    if (path.startsWith('/closings/business-day')) return { businessDate: '2026-10-09', localDate: '2026-10-09', standing: 'open', door: 'open' };
    return {};
  });
});

// Lets the cached reads settle inside act, so nothing updates after a test has ended.
afterEach(async () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

describe('the counter flow', () => {
  it('direction first in words, any provider switched on, the commission typed, one review, then Confirm — the number and the commission reach the server, never a person', async () => {
    (api.post as jest.Mock).mockImplementation(async (_path: string, body: { amount: number }) => recorded(body));
    await mount();
    // Two cards, each a whole sentence with the money arrows.
    expect(await screen.findByText('Receive cash → send digital credit')).toBeTruthy();
    expect(screen.getByText('Give cash → receive digital credit')).toBeTruthy();
    await fireEvent.press(screen.getByText('Receive cash → send digital credit'));

    // Every provider switched on is offered — one never configured too; one switched off is not.
    expect(await screen.findByText('Sedad')).toBeTruthy();
    expect(screen.queryByText('Moov')).toBeNull();
    await fireEvent.press(screen.getByText('Bankily'));
    // The cards now name the provider.
    expect(await screen.findByText('Receive cash → send Bankily credit')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText(t('agent.amount')), '10000');
    await fireEvent.changeText(screen.getByLabelText(t('agent.number')), '36 12 34 56');
    // No commission typed: no review — an empty field is never zero.
    await fireEvent.press(screen.getByText(t('agent.review.action')));
    expect(screen.queryByText(t('agent.review.confirm'))).toBeNull();
    // Digits only: whatever else is typed is dropped as typed.
    await fireEvent.changeText(screen.getByLabelText(t('agent.commission')), '2a00');
    expect(screen.getByDisplayValue('200')).toBeTruthy();
    await fireEvent.press(screen.getByText(t('agent.review.action')));

    // One review: the amount, the commission the customer pays, the cash received and the credit sent.
    expect(await screen.findByText(t('agent.review.cashReceived'))).toBeTruthy();
    expect(screen.getByText(t('agent.review.amount'))).toBeTruthy();
    expect(screen.getByText(t('agent.review.commission'))).toBeTruthy();
    expect(screen.getByText(t('agent.review.commissionNote', { provider: 'Bankily' }))).toBeTruthy();
    expect(screen.getByText('Bankily credit sent to the customer')).toBeTruthy();
    expect(screen.getByText(`+${formatMoney(10200, { decimals: 0 })}`)).toBeTruthy();
    expect(screen.getByText(NUMBER)).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByText(t('agent.review.confirm')));
    });

    // Recorded, with the server's own time and day — never the phone's.
    expect(await screen.findByText(t('agent.outcome.recorded.title'))).toBeTruthy();
    expect(screen.getByText(/Recorded by the server at \d\d:\d\d, business day 9 Oct 2026, by Employee Boutique 2\./)).toBeTruthy();

    // The server received the number, under the queue item's own key, and no person.
    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = (api.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/agent/transactions');
    expect(body).toEqual(expect.objectContaining({ providerId: 'bankily', direction: 'cash_in_credit_out', amount: 10000, commissionAmount: 200, customerNumber: NUMBER }));
    for (const forbidden of ['employeeId', 'userId', 'recordedBy', 'recordedById', 'recordedByName', 'configVersionId']) expect(body).not.toHaveProperty(forbidden);
    const item = useQueue.getState().items[0];
    expect(body.clientUuid).toBe(item.clientUuid);
    expect(item.state).toBe('synced');
    expect(item.summary).toBe(`Cash in, credit out · ${formatMoney(10000)} · Bankily`);

    // Never in the queue file, never in the draft, never in the summary; gone from SecureStore once recorded.
    expect(mockQueueWrites.length).toBeGreaterThan(0);
    for (const write of mockQueueWrites) expect(write).not.toMatch(/3612|3456|customerNumber/);
    for (const draft of mockDrafts.values()) expect(draft).not.toMatch(/3612|3456|customerNumber/);
    expect(mockStore.has(numberKey(SCOPE, item.clientUuid))).toBe(false);
  });

  it('offline, the exchange waits as Pending synchronization — kept apart in SecureStore, never shown as recorded', async () => {
    useConnectivity.setState({ online: false });
    await mount();
    await fillForm();
    await fireEvent.press(screen.getByText(t('agent.review.action')));
    await act(async () => {
      await fireEvent.press(await screen.findByText(t('agent.review.confirm')));
    });
    expect(await screen.findByText(t('agent.pending'))).toBeTruthy();
    expect(screen.queryByText(t('agent.outcome.recorded.title'))).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    const item = useQueue.getState().items[0];
    expect(item.state).toBe('waiting_for_connection');
    // The number is kept, sealed to this company, branch and person, under the item's key.
    expect(JSON.parse(mockStore.get(numberKey(SCOPE, item.clientUuid))!)).toEqual({ companyId: 'c1', branchId: 'b1', userId: 'u1', customerNumber: NUMBER });
    for (const write of mockQueueWrites) expect(write).not.toMatch(/3612|customerNumber/);

    // A mistake noticed before it is sent: cancelled, asked twice; nothing is sent and the number leaves the phone.
    await fireEvent.press(screen.getByText(t('agent.action.cancel')));
    await act(async () => {
      await fireEvent.press(screen.getByText(t('agent.action.cancelConfirm')));
    });
    expect(useQueue.getState().items[0].state).toBe('cancelled');
    expect(await screen.findByText(t('agent.outcome.cancelled'))).toBeTruthy();
    await waitFor(() => expect(mockStore.has(numberKey(SCOPE, item.clientUuid))).toBe(false));
  });

  it('with no network the counter still prepares an exchange from the providers kept on the phone, says so, and queues it (device run, 2026-10-10)', async () => {
    useConnectivity.setState({ online: false });
    (readKeptProviders as jest.Mock).mockReturnValue({ savedAt: '2026-10-11T04:00:00.000Z', providers: providers.providers });
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/agent/providers')) throw new TypeError('Network request failed');
      if (path.startsWith('/closings/business-day')) return { businessDate: '2026-10-09', localDate: '2026-10-09', standing: 'open', door: 'open' };
      if (path.startsWith('/entitlement')) return entitlement;
      return {};
    });
    await mount();
    await fillForm();
    expect(readKeptProviders).toHaveBeenCalledWith('b1');
    expect(screen.getByText(t('agent.provider.kept', { when: `${formatDate('2026-10-11T04:00:00.000Z')} ${formatTime('2026-10-11T04:00:00.000Z')}` }))).toBeTruthy();
    await fireEvent.press(screen.getByText(t('agent.review.action')));
    await act(async () => {
      await fireEvent.press(await screen.findByText(t('agent.review.confirm')));
    });
    expect(await screen.findByText(t('agent.pending'))).toBeTruthy();
    expect(useQueue.getState().items[0].state).toBe('waiting_for_connection');
  });

  it('a refusal is never answered from the kept list: a permission taken away is the server’s word', async () => {
    (readKeptProviders as jest.Mock).mockReturnValue({ savedAt: '2026-10-11T04:00:00.000Z', providers: providers.providers });
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/agent/providers')) throw new ApiError('Forbidden', 403, 'FORBIDDEN');
      if (path.startsWith('/closings/business-day')) return { businessDate: '2026-10-09', localDate: '2026-10-09', standing: 'open', door: 'open' };
      if (path.startsWith('/entitlement')) return entitlement;
      return {};
    });
    await mount();
    await fireEvent.press(await screen.findByText('Receive cash → send digital credit'));
    await waitFor(() => expect(screen.queryByText('Bankily')).toBeNull());
    expect(readKeptProviders).not.toHaveBeenCalled();
  });

  it('each list the server sends is kept for the branch', async () => {
    await mount();
    await fireEvent.press(await screen.findByText('Receive cash → send digital credit'));
    await screen.findByText('Bankily');
    expect(keepProviders).toHaveBeenCalledWith('b1', providers.providers);
  });

  it('a refusal is said in the counter’s words — Not recorded, with Edit and send — and prepared again under a new key with its number and commission (D161)', async () => {
    (api.post as jest.Mock).mockRejectedValue(new ApiError('Bankily issues a reference for every exchange.', 400, 'reference_required'));
    await mount();
    await fillForm();
    await fireEvent.press(screen.getByText(t('agent.review.action')));
    await act(async () => {
      await fireEvent.press(await screen.findByText(t('agent.review.confirm')));
    });
    expect(await screen.findByText(t('agent.refusal.reference_required'))).toBeTruthy();
    const refused = useQueue.getState().items[0];
    expect(refused.state).toBe('rejected_resubmit');
    expect(refused.lastError?.code).toBe('reference_required');
    expect(screen.getByText(t('agent.refusal.title'))).toBeTruthy();
    // Nothing rejected is sent again on its own, and never unchanged when its terms changed.
    expect(screen.queryByText(t('agent.action.sendAgain'))).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      await fireEvent.press(screen.getByText(t('agent.action.editAndSend')));
    });
    // Back on the form with the same words and figures — the commission too — and the number carried to the new key.
    expect(await screen.findByDisplayValue('10000')).toBeTruthy();
    expect(screen.getByDisplayValue('200')).toBeTruthy();
    expect(screen.getByDisplayValue(NUMBER)).toBeTruthy();
    expect(useQueue.getState().items[0].state).toBe('cancelled');
    expect(mockStore.has(numberKey(SCOPE, refused.clientUuid))).toBe(false);
  });

  it('the unsent form survives a restart, its number restored from SecureStore — and the draft file never holds it', async () => {
    const first = await mount();
    await fillForm();
    await waitFor(() => expect([...mockStore.keys()].some((k) => k.startsWith('agent.exchange.number.'))).toBe(true));
    await waitFor(() => expect(mockDrafts.get('agent.exchange')).toMatch(/"amount":"10000"/));
    await first.unmount();

    await mount();
    expect(await screen.findByDisplayValue('10000')).toBeTruthy();
    expect(await screen.findByDisplayValue('36 12 34 56')).toBeTruthy();
    expect(screen.getByText(t('draft.restored.hint'))).toBeTruthy();
    for (const draft of mockDrafts.values()) expect(draft).not.toMatch(/3612|customerNumber/);
  });

  it('while the business day is closed, the store is opened first — no form to fill', async () => {
    (api.get as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/closings/business-day')) return { businessDate: '2026-10-09', localDate: '2026-10-09', standing: 'closed', door: 'closed' };
      if (path.startsWith('/entitlement')) return entitlement;
      return providers;
    });
    await mount();
    expect(await screen.findByText(t('gate.closed.title'))).toBeTruthy();
    expect(screen.queryByText('Receive cash → send digital credit')).toBeNull();
  });

  it('in Arabic, laid out right-to-left, the direction reads its way and the number stays left-to-right', async () => {
    await useI18n.getState().setLanguage('ar');
    const rtl = jest.spyOn(layoutDirection, 'layoutIsRTL').mockReturnValue(true);
    try {
      await mount();
      // The money arrow points the reading way: ←, never →.
      const card = await screen.findByText('استلام النقد ← إرسال رصيد رقمي');
      await fireEvent.press(card);
      await fireEvent.press(await screen.findByText('Bankily'));
      await fireEvent.changeText(await screen.findByLabelText(t('agent.amount')), '10000');
      // Arabic-Indic digits are the same digits.
      await fireEvent.changeText(screen.getByLabelText(t('agent.commission')), '٢٠٠');
      expect(screen.getByDisplayValue('200')).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText(t('agent.number')), '36 12 34 56');
      await fireEvent.press(screen.getByText(t('agent.review.action')));
      expect(await screen.findByText(t('agent.review.cashReceived'))).toBeTruthy();
      expect(screen.getByText(`\u2066${NUMBER}\u2069`)).toBeTruthy();
      expect(screen.getByText('العمولة التي يدفعها الزبون')).toBeTruthy();
    } finally {
      rtl.mockRestore();
    }
  });

  it('a branch without the money services activity offers no form', async () => {
    (api.get as jest.Mock).mockImplementation(async (path: string) =>
      path.startsWith('/entitlement') ? { ...entitlement, seatsByStore: [{ branchId: 'b1', name: 'Boutique 1', activity: 'electronics', activityNext: null }] } : providers,
    );
    await mount();
    expect(await screen.findByText(t('agent.notSubscribed.title'))).toBeTruthy();
    expect(screen.queryByText('Receive cash → send digital credit')).toBeNull();
  });
});
