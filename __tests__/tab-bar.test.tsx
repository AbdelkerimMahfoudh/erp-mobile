/// <reference types="jest" />
/**
 * The bottom bar per activity and role, as the layout draws it (docs/73 §5.1,
 * docs/21 D157) — and the proposal checked where it is tightest: five names at
 * 320 and 393 points, in English, French and Arabic, at ordinary and at 1.3×
 * text (Android, where the names grow with the system text).
 *
 * The names' widths are MEASURED, in a real browser (Chromium's canvas
 * `measureText`, 2026-10-09), in Liberation Sans at weight 600 — Arial's metrics,
 * wider than SF Pro Semibold and Roboto Medium, so an upper bound for the phone —
 * with DejaVu Sans drawing the Arabic. They are fed to the layout the way the
 * device feeds them (the hidden `TextMeasure` reporting each name's width), and
 * the layout's own rule (`labelScale`) decides each name's size. The assertions:
 * every name fits its share of the bar, none is drawn below 8 points, and with
 * ordinary text on a 393-point phone nothing shrinks at all. Not a device:
 * NOT DEVICE VERIFIED until a phone shows the bar (docs/70 §7).
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useBranch } from '../lib/branch';
import { usePermissionStore, type Permission } from '../lib/permissions';
import { useI18n, type Language } from '../lib/i18n';
import { tabLabelRoom } from '../lib/label-fit';
import type { Activity } from '../lib/activity';

const mockDimensions = { width: 393, height: 852, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDimensions }));
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
import TabsLayout from '../app/(tabs)/_layout';

/** The server's role definitions with the counter's keys (erp-backend role-permissions.ts, migration 0090). */
const OWNER = ['closing.count', 'closing.perform', 'connection.manage', 'consignment.view', 'expense.submit', 'loan.view', 'report.view', 'sale.create', 'purchase.manage', 'money.anchor.record', 'agent.transaction.record', 'agent.transaction.view', 'agent.customer.reveal', 'agent.mistake.report', 'agent.transaction.reverse', 'agent.rebalance', 'agent.position.set', 'agent.report.view', 'agent.provider.manage'] as Permission[];
const MANAGER = ['closing.count', 'closing.perform', 'consignment.view', 'expense.submit', 'loan.view', 'report.view', 'sale.create', 'purchase.manage', 'agent.transaction.record', 'agent.transaction.view', 'agent.customer.reveal', 'agent.mistake.report', 'agent.transaction.reverse', 'agent.rebalance', 'agent.report.view'] as Permission[];
const EMPLOYEE = ['closing.count', 'consignment.view', 'expense.submit', 'sale.create', 'purchase.manage', 'agent.transaction.record', 'agent.transaction.view', 'agent.mistake.report'] as Permission[];

/** Measured widths in points at 10 / 11 points (ordinary text) and 13 / 14.3 (1.3×), see above. */
const WIDTHS: Record<string, [number, number, number, number]> = {
  Home: [27.8, 30.6, 36.1, 39.7],
  Partners: [40.6, 44.6, 52.7, 58],
  Transactions: [61.7, 67.9, 80.2, 88.2],
  Exchanges: [52.8, 58.1, 68.6, 75.5],
  Money: [31.7, 34.8, 41.2, 45.3],
  Stock: [27.2, 30, 35.4, 38.9],
  Reports: [37.8, 41.6, 49.1, 54],
  More: [23.9, 26.3, 31.1, 34.2],
  Accueil: [35.6, 39.1, 46.2, 50.9],
  Partenaires: [54.5, 59.9, 70.8, 77.9],
  Échanges: [47.2, 52, 61.4, 67.5],
  Argent: [32.2, 35.4, 41.9, 46.1],
  Rapports: [43.9, 48.3, 57.1, 62.8],
  Plus: [21.1, 23.2, 27.5, 30.2],
  'الرئيسية': [41.6, 45.7, 54, 59.4],
  'الشركاء': [38.3, 42.1, 49.7, 54.7],
  'المعاملات': [47.1, 51.8, 61.3, 67.4],
  'المبادلات': [44.4, 48.8, 57.7, 63.4],
  'المال': [26.3, 29, 34.2, 37.6],
  'المخزون': [42.1, 46.3, 54.7, 60.1],
  'التقارير': [37.9, 41.7, 49.3, 54.3],
  'المزيد': [29.6, 32.6, 38.5, 42.4],
};

function entitlement(activity: Activity) {
  return {
    state: 'active', periodEnd: '2026-12-31', graceEnd: null, daysRemaining: 80, graceHoursRemaining: 0, subscribedBranchCount: 1, activeBranchCount: 1,
    includedSeats: 1, additionalSeats: 0, seatLimit: 1, seatsUsed: 1, overLimit: false, canRead: true, canWrite: true, isComplimentary: false, status: 'activated', calculatedAt: '2026-10-09T01:00:00.000Z',
    seatsByStore: [{ branchId: 'b1', name: 'Boutique 2', activity, activityNext: null, seatsUsed: 1, paidSeats: 0, grantedSeats: 0, includedSeats: 1, seatLimit: 1, seatsAvailable: 0, overLimit: false }],
  };
}

async function mountBar(activity: Activity | null, granted: readonly Permission[]) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path.startsWith('/entitlement')) {
      const body = entitlement(activity ?? 'electronics');
      // An older server: no activity at all on its lines.
      if (activity === null) body.seatsByStore = body.seatsByStore.map(({ activity: _a, activityNext: _n, ...rest }) => rest) as never;
      return body;
    }
    return { rows: [] };
  });
  useBranch.setState({ branchId: 'b1', branchName: 'Boutique 2', role: 'owner' });
  usePermissionStore.setState({ granted: new Set(granted), branchId: 'b1', status: 'ready', error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TabsLayout />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  await screen.findByTestId('tab-index');
}

/** The bar as drawn: each tab's route and title, in order. */
const bar = () => screen.getAllByTestId(/^tab-/).map((n) => [String(n.props.testID).slice(4), n.props.children as string]);

beforeEach(async () => {
  (api.get as jest.Mock).mockReset();
  mockDimensions.width = 393;
  await useI18n.getState().setLanguage('en');
});

describe('the bar per activity and role', () => {
  const cases: [Activity | null, string, readonly Permission[], string[]][] = [
    // A shop — and a server older than the activity — keep today's bar.
    ['electronics', 'Owner', OWNER, ['index', 'partners', 'money-hub', 'inventory', 'more']],
    [null, 'Owner', OWNER, ['index', 'partners', 'money-hub', 'inventory', 'more']],
    ['electronics', 'Employee', EMPLOYEE, ['index', 'partners', 'money-hub', 'inventory', 'more']],
    // An agent counter: Home · Transactions · Money · Reports · More; no Reports for whoever does not read them.
    ['money_agent', 'Owner', OWNER, ['index', 'agent-transactions', 'money-hub', 'agent-reports', 'more']],
    ['money_agent', 'Manager', MANAGER, ['index', 'agent-transactions', 'money-hub', 'agent-reports', 'more']],
    ['money_agent', 'Employee', EMPLOYEE, ['index', 'agent-transactions', 'money-hub', 'more']],
    // Both: Home · Exchanges · Money · Stock · More.
    ['both', 'Owner', OWNER, ['index', 'agent-transactions', 'money-hub', 'inventory', 'more']],
    ['both', 'Manager', MANAGER, ['index', 'agent-transactions', 'money-hub', 'inventory', 'more']],
    ['both', 'Employee', EMPLOYEE, ['index', 'agent-transactions', 'money-hub', 'inventory', 'more']],
  ];
  it.each(cases)('%s × %s', async (activity, _role, granted, expected) => {
    await mountBar(activity, granted);
    expect(bar().map(([route]) => route)).toEqual(expected);
  });

  it('names the counter’s tab Transactions on its own branch and Exchanges beside Stock', async () => {
    await mountBar('money_agent', OWNER);
    expect(screen.getByTestId('tab-agent-transactions').props.children).toBe('Transactions');
    expect(screen.getByTestId('tab-agent-reports').props.children).toBe('Reports');
  });

  it('…and Exchanges on a combined branch', async () => {
    await mountBar('both', OWNER);
    expect(screen.getByTestId('tab-agent-transactions').props.children).toBe('Exchanges');
  });
});

describe('the names fit, measured, at 320 and 393 points', () => {
  const matrix: [Language, Activity, number, 'normal' | 'large'][] = [];
  for (const lang of ['en', 'fr', 'ar'] as Language[]) {
    for (const activity of ['electronics', 'money_agent', 'both'] as Activity[]) {
      for (const width of [320, 393]) for (const text of ['normal', 'large'] as const) matrix.push([lang, activity, width, text]);
    }
  }
  it.each(matrix)('%s, %s, %i points, %s text', async (lang, activity, width, text) => {
    await useI18n.getState().setLanguage(lang);
    mockDimensions.width = width;
    await mountBar(activity, OWNER);
    const base = width < 360 ? 10 : 11;
    const column = (base === 10 ? 0 : 1) + (text === 'large' ? 2 : 0);
    // The device reports each hidden name's width; here, the measured one.
    const measures = screen.UNSAFE_root.findAll((n) => typeof n.props.onLayout === 'function' && typeof n.props.children === 'string' && n.props.children in WIDTHS);
    expect(measures.length).toBeGreaterThan(0);
    await act(async () => {
      for (const node of measures) fireEvent(node, 'layout', { nativeEvent: { layout: { width: WIDTHS[node.props.children as string][column], height: 14 } } });
    });
    const shown = bar();
    expect(shown).toHaveLength(5);
    const room = tabLabelRoom(width, shown.length);
    for (const [route, title] of shown) {
      const natural = WIDTHS[title];
      expect(natural).toBeDefined();
      const style = screen.getByTestId(`tab-${route}`).props.style as { fontSize: number };
      const drawn = (natural[column] * style.fontSize) / base;
      expect(drawn).toBeLessThanOrEqual(room);
      // Never too small to read: at worst "Transactions" at 320 points, about 8.5 points with these metrics.
      expect(style.fontSize * (text === 'large' ? 1.3 : 1)).toBeGreaterThanOrEqual(8);
      // With ordinary text on a 393-point phone every name is drawn as designed.
      if (width === 393 && text === 'normal') expect(style.fontSize).toBe(base);
    }
  });
});
