/// <reference types="jest" />
/**
 * "Invite someone to Dukan ERP" (0103, D221), as the screen renders it: the message in the language chosen for it,
 * with the person's own invitation address; shared through the phone's own share sheet or copied — Dukan ERP sends
 * nothing and reads no contact; stopped after a confirmation, so that sharing again makes a new one. Nothing on the
 * screen counts, promises or names anything for the person who invites.
 */
import React from 'react';
import { Share, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { ThemeProvider } from '../lib/design/theme';
import { t, translateIn } from '../lib/i18n';

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
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../lib/dialog', () => {
  const actual = jest.requireActual('../lib/dialog');
  return { ...actual, dialog: { ...actual.dialog, confirm: jest.fn(async () => true) } };
});

import { api } from '../lib/api-client';
import { dialog } from '../lib/dialog';
import InviteScreen from '../app/invite';

const linkFor = (language: string, n = 1) => `https://dukan.tsxmr.com/join?r=TOKEN-${language}-${n}`;

/** What the server answers: the person's own invitation in that language, a new one after a stop. */
function serveInvitations() {
  const issued: Record<string, number> = {};
  (api.post as jest.Mock).mockImplementation(async (path: string, body: { language?: string }) => {
    if (path === '/referral-invitations') {
      const language = body.language!;
      issued[language] = issued[language] ?? 1;
      return { id: `inv-${language}-${issued[language]}`, language, createdAt: '2026-10-25T10:00:00.000Z', link: linkFor(language, issued[language]) };
    }
    const revoked = /^\/referral-invitations\/inv-(\w+)-\d+\/revoke$/.exec(path);
    if (revoked) {
      issued[revoked[1]] += 1;
      return { revoked: true };
    }
    throw new Error(`unexpected ${path}`);
  });
}

async function renderScreen() {
  await render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InviteScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  (api.post as jest.Mock).mockReset();
  (api.get as jest.Mock).mockReset();
  (Clipboard.setStringAsync as jest.Mock).mockClear();
  (dialog.confirm as jest.Mock).mockClear();
  serveInvitations();
});

it('shows the message in the app’s language with the person’s own invitation address, and says it is not Team', async () => {
  await renderScreen();
  const message = await screen.findByTestId('invite-message');
  expect(message.props.children).toBe(translateIn('en', 'invite.message', { address: linkFor('en') }));
  expect(message.props.children).toBe(`Try Dukan ERP to manage stock, sales and daily store activity. Create your business here: ${linkFor('en')}`);
  expect(screen.getByText(t('invite.notTeam'))).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/referral-invitations', { language: 'en' });
});

it('writes the message in the language chosen for its reader — French or Arabic — with that language’s own address', async () => {
  await renderScreen();
  await screen.findByTestId('invite-message');
  fireEvent.press(screen.getByText('العربية'));
  await waitFor(() => expect(screen.getByTestId('invite-message').props.children).toBe(translateIn('ar', 'invite.message', { address: linkFor('ar') })));
  expect(StyleSheet.flatten(screen.getByTestId('invite-message').props.style)).toEqual(expect.objectContaining({ writingDirection: 'rtl' }));
  fireEvent.press(screen.getByText('Français'));
  await waitFor(() => expect(screen.getByTestId('invite-message').props.children).toBe(translateIn('fr', 'invite.message', { address: linkFor('fr') })));
});

it('shares through the phone’s own share sheet, or copies — nothing is sent by Dukan ERP', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  await renderScreen();
  await screen.findByTestId('invite-message');
  fireEvent.press(screen.getByText(t('invite.share')));
  expect(share).toHaveBeenCalledWith({ message: translateIn('en', 'invite.message', { address: linkFor('en') }) });
  await act(async () => {
    fireEvent.press(screen.getByText(t('invite.copy')));
  });
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(translateIn('en', 'invite.message', { address: linkFor('en') }));
  // The only requests: the person's own invitation. No message API, no contact, no recipient.
  expect((api.post as jest.Mock).mock.calls.map(([path]) => path)).toEqual(['/referral-invitations']);
  share.mockRestore();
});

it('stops an invitation after a confirmation; the next one is new', async () => {
  await renderScreen();
  await screen.findByTestId('invite-message');
  await act(async () => {
    fireEvent.press(screen.getByText(t('invite.stop')));
  });
  expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: t('invite.stop.title'), message: t('invite.stop.body') }));
  expect(api.post).toHaveBeenCalledWith('/referral-invitations/inv-en-1/revoke', {});
  await waitFor(() => expect(screen.getByTestId('invite-message').props.children).toContain(linkFor('en', 2)));
});

it('the screen’s words count nothing and promise nothing, in any language', () => {
  const PROMISE = /reward|commission|bonus|credit|points|discount|free month|récompense|remise|مكافأ|عمولة|خصم|نقاط/i;
  for (const lang of ['en', 'fr', 'ar'] as const) {
    for (const key of ['nav.invite', 'invite.subtitle', 'invite.notTeam', 'invite.message', 'invite.stop.body', 'invite.stopped'] as const) {
      expect(translateIn(lang, key)).not.toMatch(PROMISE);
    }
  }
});
