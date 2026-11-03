/**
 * The Manager's money card (D227, the owner's option A): this store's tracked cash, read-only, with the Owner's figure
 * and words; nothing at all when cash is untracked; never an account, never the settings.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(p: string, e: 'utf8'): string };

jest.mock('../lib/api-client', () => ({ __esModule: true, api: { get: jest.fn() } }));

import { api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { usePermissionStore } from '../lib/permissions';
import { TrackedCashCard } from '../components/money/TrackedBalancesCard';

const get = api.get as jest.Mock;

async function show(answer: unknown, permissions: string[] = ['report.view']) {
  usePermissionStore.setState({ granted: new Set(permissions) as never, status: 'ready' } as never);
  useBranch.setState({ branchId: 'b1', branchName: 'Main' } as never);
  get.mockReset().mockResolvedValue(answer);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TrackedCashCard />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('the Manager’s tracked cash card', () => {
  it('tracked: the cash figure, said to come from Dukan’s records, and no way to the settings', async () => {
    await show({ asOf: '2026-11-03', on: true, effectiveDate: '2026-11-01', expected: 600 });
    expect(await screen.findByTestId('tracked-cash')).toBeTruthy();
    expect(screen.getByText(t('balances.cash'))).toBeTruthy();
    expect(screen.getByText(t('balances.notLive', { date: '2026-11-01' }))).toBeTruthy();
    // The heading is the Owner's words; there is no button to the balances settings.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(get).toHaveBeenCalledWith('/money/tracking/cash');
  });

  it('untracked: no card, so nothing is claimed', async () => {
    await show({ asOf: '2026-11-03', on: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('tracked-cash')).toBeNull();
  });

  it('without report.view (an Employee): nothing is asked of the server', async () => {
    await show({ asOf: '2026-11-03', on: true, expected: 1 }, []);
    expect(screen.queryByTestId('tracked-cash')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('Money shows the Owner every tracked location and everyone else this card; the old drawer card is gone', () => {
    const hub = readFileSync(`${__dirname}/../app/(tabs)/money-hub.tsx`, 'utf8');
    expect(hub).toContain("canSeeAllBalances ? <TrackedBalancesCard /> : <TrackedCashCard />");
    expect(hub).not.toContain('<ExpectedMoneyCard');
  });
});
