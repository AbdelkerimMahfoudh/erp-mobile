/// <reference types="jest" />
/**
 * The Owner's 3/2/1-day renewal reminder in the app (owner's brief, 2026-11-05): the server's count, the Owner only,
 * once per milestone on every device, nothing offline, EN/FR/AR — and no link, no price, no way to pay (App Store).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { ar } from '../lib/i18n/ar';
import { en } from '../lib/i18n/en';
import { fr } from '../lib/i18n/fr';

let mockUser: Record<string, unknown> | null = null;
let mockOnline = true;
const mockGet = jest.fn();
const mockPost = jest.fn(async () => ({}));
jest.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../lib/connectivity', () => ({ useConnectivity: (pick: (s: { online: boolean }) => unknown) => pick({ online: mockOnline }) }));
jest.mock('../lib/api-client', () => ({ api: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...(a as [])) } }));

import { RENEWAL_KEYS, RenewalReminderBanner } from '../components/ui/RenewalReminderBanner';

const owner = { id: 'u', name: 'Owner', account: { isOwner: true, activeStores: 1 } };
const reminder = (days: 1 | 2 | 3, seen = false) => ({ reminder: { id: 'n1', days, endsAt: '2026-11-20T10:00:00.000Z', timeZone: 'Africa/Nouakchott', seen } });

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RenewalReminderBanner />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUser = owner;
  mockOnline = true;
  mockGet.mockReset();
  mockPost.mockClear();
});

describe('the renewal reminder', () => {
  for (const days of [3, 2, 1] as const) {
    it(`${days} day(s) left: the server's number, in words`, async () => {
      mockGet.mockResolvedValue(reminder(days));
      await mount();
      expect(await screen.findByText(t(RENEWAL_KEYS[days]))).toBeTruthy();
      expect(mockGet).toHaveBeenCalledWith('/me/renewal-reminder');
    });
  }

  it('nothing when none is due (renewed, pending proof, grace, expired: the server answers null)', async () => {
    mockGet.mockResolvedValue({ reminder: null });
    await mount();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId('renewal-reminder')).toBeNull();
  });

  it('nothing once one of this Owner’s devices showed it', async () => {
    mockGet.mockResolvedValue(reminder(2, true));
    await mount();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId('renewal-reminder')).toBeNull();
  });

  it('dismissing it marks it read on the server, so every other device hears it was seen', async () => {
    mockGet.mockResolvedValue(reminder(1));
    await mount();
    fireEvent.press(await screen.findByTestId('renewal-reminder-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('renewal-reminder')).toBeNull());
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/notifications/n1/read'));
  });

  it('a Manager or an Employee never asks', async () => {
    mockUser = { id: 'm', name: 'Manager', account: { isOwner: false, activeStores: 1 } };
    await mount();
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('renewal-reminder')).toBeNull();
  });

  it('offline: nothing is asked and nothing is shown', async () => {
    mockOnline = false;
    await mount();
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('renewal-reminder')).toBeNull();
  });
});

describe('its words', () => {
  it('exist in English, French and Arabic, and Arabic words 2 and 1 as Arabic does', () => {
    for (const cat of [en, fr, ar] as Record<string, string>[]) for (const k of [...Object.values(RENEWAL_KEYS), 'renewal.banner.dismiss']) expect(cat[k]).toBeTruthy();
    expect(ar['renewal.banner.2']).toContain('يومين');
    expect(ar['renewal.banner.1']).toContain('يوم واحد');
  });

  it('carry no link, no price and no way to pay (App Store boundary)', () => {
    for (const cat of [en, fr, ar] as Record<string, string>[]) {
      for (const k of Object.values(RENEWAL_KEYS)) expect(cat[k]).not.toMatch(/https?:|www\.|\.com|MRU|renew|renouvel|تجديد|pay|pai|دفع/i);
    }
  });
});
