/// <reference types="jest" />
/**
 * The counter's reports (D157), as the server sends them (captured 2026-10-09):
 * count, volume and commission of the completed exchanges; reversals and
 * rebalancings each on their own line, never inside them; by provider and by
 * employee; the year month by month; the floats at the period's end; expected
 * against counted at the closings, Unknown kept Unknown. Days, weeks, months
 * and years are stepped through on the server's periods, never past the
 * branch's business day; only those who read the reports see them.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { useI18n, t } from '../lib/i18n';
import * as layoutDirection from '../lib/design/layout-direction';

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

import { api } from '../lib/api-client';
import AgentReportsTab from '../app/(tabs)/agent-reports';
import AgentReportsScreen from '../app/agent/reports';

const OWNER = ['closing.count', 'closing.perform', 'report.view', 'agent.transaction.view', 'agent.report.view', 'agent.rebalance'] as Permission[];
const EMPLOYEE = ['closing.count', 'agent.transaction.record', 'agent.transaction.view', 'agent.mistake.report'] as Permission[];

const day = (inflows: number, outflows: number) => ({ businessDate: '2026-10-09', inflows, outflows, net: inflows - outflows });
const figures = (over: Record<string, unknown> = {}) => ({ count: 0, volume: 0, cashReceived: 0, cashPaid: 0, creditSent: 0, creditReceived: 0, commission: 0, reversals: { count: 0, volume: 0, commission: 0 }, ...over });
const totals = {
  ...figures({ count: 13, volume: 64000, cashReceived: 51000, cashPaid: 13000, creditSent: 51000, creditReceived: 13000, commission: 740, reversals: { count: 1, volume: 15000, commission: 75 } }),
  rebalancings: { count: 3, cashIn: 60000, cashOut: 15000, floatIn: 15000, floatOut: 10000 },
};
const report = (period: string, from: string, to: string) => ({
  period,
  from,
  to,
  totals,
  byProvider: [
    { providerId: 'bankily', label: 'Bankily', ...figures({ count: 10, volume: 39000, cashReceived: 36000, cashPaid: 3000, creditSent: 36000, creditReceived: 3000, commission: 490 }) },
    { providerId: 'sedad', label: 'Sedad', ...figures({ reversals: { count: 1, volume: 15000, commission: 75 } }) },
  ],
  byEmployee: [
    { userId: 'u-emp', name: 'Employee Boutique 2', count: 9, volume: 51000, commission: 610, reversals: { count: 1 } },
    { userId: 'u-owner', name: 'Owner Boutique 2', count: 4, volume: 13000, commission: 130, reversals: { count: 0 } },
  ],
  ...(period === 'year' ? { byMonth: [{ month: '2026-10', ...totals }] } : {}),
  positions: {
    floats: [
      { providerId: 'bankily', providerLabel: 'Bankily', providerKind: 'bankily', accountKind: 'provider', known: true, position: 12490, unknownReason: null, sinceAnchorNet: -37510, anchor: null, movement: day(8490, 46000) },
      { providerId: 'masrvi', providerLabel: 'Masrvi', providerKind: 'other', accountKind: 'provider', known: false, position: null, unknownReason: 'no_anchor', sinceAnchorNet: null, anchor: null, movement: day(10100, 9900) },
    ],
    discrepancies: [
      { businessDate: '2026-10-09', providerId: 'bankily', label: 'Bankily', expected: 15100, counted: 15000, difference: -100, explanation: 'provider app shows 15 000', status: 'pending_investigation' },
      { businessDate: '2026-10-08', providerId: 'masrvi', label: 'Masrvi', expected: null, counted: 900, difference: 0, explanation: null, status: null },
    ],
  },
});

function serve(path: string): unknown {
  if (path.startsWith('/closings/business-day')) return { businessDate: '2026-10-09', localDate: '2026-10-09', door: 'open' };
  if (path.startsWith('/agent/reports')) {
    const q = new URLSearchParams(path.split('?')[1]);
    const period = q.get('period') ?? 'day';
    const date = q.get('date') ?? '2026-10-09';
    if (period === 'year') return report('year', '2026-01-01', '2026-12-31');
    if (period === 'month') return report('month', '2026-10-01', '2026-10-31');
    if (period === 'week') return report('week', '2026-10-05', '2026-10-11');
    return report('day', date, date);
  }
  return new Promise(() => undefined);
}

function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>,
  );
}

function signIn(granted: readonly Permission[]) {
  useBranch.setState({ branchId: 'b1', branchName: 'Annexe', role: 'owner' });
  usePermissionStore.setState({ granted: new Set(granted), branchId: 'b1', status: 'ready', error: null });
}

const reportCalls = () => (api.get as jest.Mock).mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('/agent/reports'));

beforeEach(async () => {
  await useI18n.getState().setLanguage('en');
  (api.get as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation(async (path: string) => serve(path));
});

describe('the counter’s reports', () => {
  it('the day: exchanges and commission; reversals and rebalancings on their own lines; by provider and employee; floats and counts', async () => {
    signIn(OWNER);
    mount(<AgentReportsTab />);
    const head = await screen.findByTestId('agent-report-totals');
    expect(within(head).getByText('13')).toBeTruthy();
    expect(within(head).getByText(t('agent.reports.commission'))).toBeTruthy();
    expect(within(head).getByText(t('agent.reports.cashReceived'))).toBeTruthy();
    expect(within(screen.getByTestId('agent-report-reversals')).getByText(t('agent.reports.reversals', { count: 1 }))).toBeTruthy();
    expect(within(screen.getByTestId('agent-report-rebalancings')).getByText(t('agent.reports.rebalancings', { count: 3 }))).toBeTruthy();
    expect(within(screen.getByTestId('agent-report-provider-bankily')).getByText('Bankily')).toBeTruthy();
    expect(within(screen.getByTestId('agent-report-employee-u-emp')).getByText(t('agent.reports.reversedBy', { count: 1 }))).toBeTruthy();
    // The floats as they stood: Unknown stays Unknown.
    expect(within(screen.getByTestId('position-provider:masrvi')).getByText(t('moneyTab.held.unknown'))).toBeTruthy();
    // Expected against counted: a shortage in words; an unknown expected stays Unknown, never a figure.
    const short = screen.getByTestId('agent-report-discrepancy-bankily');
    expect(within(short).getByText(t('agent.difference.short'))).toBeTruthy();
    expect(within(short).getByText(t('agent.reports.discrepancy.open'))).toBeTruthy();
    expect(within(screen.getByTestId('agent-report-discrepancy-masrvi')).getByText(t('moneyTab.held.unknown'))).toBeTruthy();
    expect(reportCalls()).toEqual(['/agent/reports?period=day']);
    // No PDF and no receipt in this version.
    expect(screen.queryByText(/PDF/)).toBeNull();
  });

  it('a year is shown month by month', async () => {
    signIn(OWNER);
    mount(<AgentReportsScreen />);
    await screen.findByTestId('agent-report-totals');
    fireEvent.press(screen.getByText(t('agent.reports.period.year')));
    expect(await screen.findByTestId('agent-report-month-2026-10')).toBeTruthy();
    expect(reportCalls()).toContain('/agent/reports?period=year');
  });

  it('steps back a period and forward again — never past the business day', async () => {
    signIn(OWNER);
    mount(<AgentReportsScreen />);
    await screen.findByTestId('agent-report-totals');
    // The current period offers nothing later.
    expect(screen.getByLabelText(t('agent.reports.later')).props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText(t('agent.reports.earlier')));
    await waitFor(() => expect(reportCalls()).toContain('/agent/reports?period=day&date=2026-10-08'));
    expect(await screen.findByText(t('agent.reports.count'))).toBeTruthy();
    // The same date in another period: the week holding the 8th is the current week, so the current one is asked.
    fireEvent.press(screen.getByText(t('agent.reports.period.week')));
    await waitFor(() => expect(reportCalls()).toContain('/agent/reports?period=week'));
    expect(reportCalls().some((p) => p.includes('period=week&date='))).toBe(false);
  });

  it('only those who read the reports see them', async () => {
    signIn(EMPLOYEE);
    mount(<AgentReportsTab />);
    expect(await screen.findByText(t('agent.reports.permission'))).toBeTruthy();
    expect(reportCalls()).toEqual([]);
  });

  it('reads the same in Arabic, laid out right to left, the figures in a line isolated left to right', async () => {
    await useI18n.getState().setLanguage('ar');
    const rtl = jest.spyOn(layoutDirection, 'layoutIsRTL').mockReturnValue(true);
    try {
      signIn(OWNER);
      mount(<AgentReportsTab />);
      const head = await screen.findByTestId('agent-report-totals');
      expect(within(head).getByText('العمولة المكتسبة')).toBeTruthy();
      expect(within(screen.getByTestId('agent-report-provider-bankily')).getByText(/^10 مبادلات · \u2066.+\u2069$/)).toBeTruthy();
    } finally {
      rtl.mockRestore();
    }
  });
});
