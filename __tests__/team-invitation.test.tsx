/// <reference types="jest" />
/**
 * The Owner's side of an employee's invitation (D214): adding a person sends them nothing — no WhatsApp message, no
 * email — and shows the invitation reference once, to copy or share from the Owner's own phone. A pending account
 * shows where its invitation stands and until when, never the reference again; a new invitation replaces it and is
 * shown once. A WhatsApp number is required.
 */
import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import type { TeamUser } from '../types/api';

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
import { CreateMemberSheet } from '../components/team/CreateMemberSheet';
import { PendingPanel } from '../components/team/PendingPanel';
import { textInputs } from './tree';

const REF = 'K7QM-9XRT-2CHD';
const ISSUED = { reference: REF, link: `dukanerp://join?ref=${REF}`, expiresAt: '2026-10-22T08:00:00.000Z' };

async function wrap(node: React.ReactNode) {
  await render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } })}>{node}</QueryClientProvider>
    </ThemeProvider>,
  );
}
const press = async (label: string) => {
  await act(async () => {
    await fireEvent.press(screen.getByText(label));
  });
};

beforeEach(() => {
  (api.get as jest.Mock).mockReset().mockImplementation(async (path: string) => (path === '/auth/branches' ? [{ id: 'b-main', name: 'Main' }] : []));
  (api.post as jest.Mock).mockReset();
  (Clipboard.setStringAsync as jest.Mock).mockClear();
  (dialog.confirm as jest.Mock).mockClear();
});

afterEach(() => jest.restoreAllMocks());

describe('adding a person', () => {
  async function fill(phone: string, nameAr = 'فاطمة') {
    await wrap(<CreateMemberSheet open onClose={() => undefined} />);
    await screen.findByText('Main');
    // D225: the name in the Latin alphabet, then in Arabic, then the number.
    const [name, arabic, number] = textInputs();
    await fireEvent.changeText(name, 'Fatima');
    await fireEvent.changeText(arabic, nameAr);
    await fireEvent.changeText(number, phone);
    await act(async () => {
      await fireEvent(screen.getByText('Main'), 'press');
    });
  }

  it('a new person needs an Arabic name too (D225): without one, nothing is created', async () => {
    await fill('+222 33 44 55 66', '');
    await press(t('team.create.submit'));
    expect(screen.getByText(t('names.error.blank'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a WhatsApp number is required: without one, nothing is created', async () => {
    await fill('');
    await press(t('team.create.submit'));
    expect(screen.getByText(t('team.create.error.phone'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('created: nothing was sent — the reference is shown once, to copy or share; the request names no message language', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      created: true,
      user: { id: 'u-fatima', name: 'Fatima', email: null, phone: '+22233445566', status: 'pending', stores: [] },
      invitation: ISSUED,
      seats: [],
      activation: { activated: false, pending: ['phone_verification'] },
    });
    await fill('+222 33 44 55 66');
    await press(t('team.create.submit'));
    const [path, body] = (api.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/users');
    expect(body).toMatchObject({ name: 'Fatima', nameAr: 'فاطمة', phone: '+22233445566', role: 'store_employee' });
    expect(body).not.toHaveProperty('language');
    expect(await screen.findByText(REF)).toBeTruthy();
    expect(screen.getByText(t('team.invite.once'))).toBeTruthy();
    expect(screen.getByText(t('team.invite.explain', { name: 'Fatima' }))).toBeTruthy();

    await press(t('team.invite.copy'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(REF);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await press(t('team.invite.share'));
    expect(share).toHaveBeenCalledWith({ message: t('team.invite.shareMessage', { reference: REF, open: ISSUED.link }) });
    // One request: nothing else went out on the Owner's behalf.
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('already waiting: no new reference is issued silently, and the Owner is told how to make one', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      created: false,
      user: { id: 'u-fatima', name: 'Fatima', email: null, phone: '+22233445566', status: 'pending', stores: [] },
      invitation: null,
      seats: [],
      activation: { activated: false, pending: ['phone_verification'] },
    });
    await fill('+22233445566');
    await press(t('team.create.submit'));
    expect(await screen.findByText(t('team.create.done.existing', { name: 'Fatima' }))).toBeTruthy();
    expect(screen.queryByTestId('invitation-reference')).toBeNull();
  });
});

describe('a pending account', () => {
  const fatima = (state: 'none' | 'open' | 'code_requested' | 'expired') =>
    ({
      id: 'u-fatima',
      name: 'Fatima',
      login: 'staff-x',
      phone: '+22233445566',
      email: 'fatima@shop.test',
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      isActive: false,
      status: 'pending',
      invitedAt: '2026-10-19T08:00:00.000Z',
      pending: { phone: 'awaiting', email: 'awaiting', invitation: { state, expiresAt: state === 'none' ? null : ISSUED.expiresAt }, seats: [] },
    }) as unknown as TeamUser;

  it('shows where the invitation stands — never the reference — and offers no code to send', async () => {
    await wrap(<PendingPanel user={fatima('code_requested')} onCancelled={() => undefined} />);
    expect(screen.getByText(t('team.pending.invitation.code_requested'))).toBeTruthy();
    expect(screen.queryByText(REF)).toBeNull();
    expect(screen.getByText(`fatima@shop.test · ${t('team.pending.email.optional')}`)).toBeTruthy();
    expect(screen.queryByText(t('join.again'))).toBeNull();
  });

  it('a new invitation replaces a live one only once confirmed, and its reference is shown this once', async () => {
    (api.post as jest.Mock).mockResolvedValue({ invitation: ISSUED });
    await wrap(<PendingPanel user={fatima('open')} onCancelled={() => undefined} />);
    await press(t('team.pending.invitation.new'));
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: t('team.pending.invitation.newConfirm.title') }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/users/u-fatima/invitation'));
    expect(await screen.findByText(REF)).toBeTruthy();
    expect(screen.getByText(t('team.invite.once'))).toBeTruthy();
  });

  it('an account from before invitations, or an expired one: a new invitation is issued without a confirmation', async () => {
    (api.post as jest.Mock).mockResolvedValue({ invitation: ISSUED });
    await wrap(<PendingPanel user={fatima('none')} onCancelled={() => undefined} />);
    expect(screen.getByText(t('team.pending.invitation.none'))).toBeTruthy();
    await press(t('team.pending.invitation.new'));
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(await screen.findByText(REF)).toBeTruthy();
  });

  it('withdrawing the account asks first, then ends it on the server', async () => {
    (api.post as jest.Mock).mockResolvedValue({ cancelled: true });
    const done = jest.fn();
    await wrap(<PendingPanel user={fatima('open')} onCancelled={done} />);
    await press(t('team.pending.cancel'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/users/u-fatima/cancel-invitation'));
    expect(done).toHaveBeenCalled();
    for (const [path] of (api.post as jest.Mock).mock.calls) expect(path).not.toMatch(/resend|verify|request-code/);
  });
});
