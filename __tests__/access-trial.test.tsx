/// <reference types="jest" />
/**
 * The free trial as the app shows it (0095; the owner's correction of 2026-10-13), rendered: what the Owner,
 * staff, and a business whose trial runs or has ended actually see — and that none of it can be pressed.
 *
 * - The Owner of a business that has not started sees a display-only card: eligible, not started, the server's
 *   number of days, the verified contacts as the server masks them, and one delivery line for each of `sent`,
 *   `waiting_for_contact`, `unavailable`, `failed` and `not_sent`. Nothing inside it is pressable, links anywhere
 *   or names a website; the screen keeps only Check again, Sign out and Delete account.
 * - Staff, refused the Owner's status by the server (403), see the neutral "not started" words only.
 * - A running trial says when it ends and an ended one when it ended — the server's UTC instant on the business's
 *   own clock, with the clock's name. The zones are Tokyo and New York, so neither GMT nor this machine's clock is
 *   what makes these pass (`lib/zoned-time.test.ts` reruns the formatting on phones set to five zones).
 */
import React from 'react';
import { format } from 'date-fns';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import type { TrialSetupStatus } from '../lib/trial-setup';

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
  useAuth: () => ({ user: { id: 'u1', name: 'Aicha', login: 'aicha', publicStoreId: 'S1' }, bootstrapping: false, signOut: jest.fn(), signIn: jest.fn(), chooseAccount: jest.fn(), adoptSession: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api, ApiError } from '../lib/api-client';
import AccessClosed from '../app/access-closed';
import AccessScreen from '../app/access';
import { AccessNotice } from '../components/access';

const ENDS = '2026-10-20T10:30:00.000Z';

const base = {
  periodEnd: null, graceEnd: null, daysRemaining: null, graceHoursRemaining: 0, subscribedBranchCount: 1, activeBranchCount: 1,
  includedSeats: 1, additionalSeats: 0, seatLimit: 1, seatsUsed: 0, overLimit: false, isComplimentary: false, status: 'pending_activation', calculatedAt: '2026-10-13T09:00:00.000Z',
};
const notStarted = { ...base, state: 'trial_available', canRead: false, canWrite: false, trial: { status: 'available', durationHours: 168, durationDays: 7, claimedAt: null, startedAt: null, endsAt: null, timeZone: 'Asia/Tokyo' } };
const running = (timeZone: string) => ({ ...base, state: 'trial_active', canRead: true, canWrite: true, trial: { status: 'active', durationHours: 168, durationDays: 7, claimedAt: '2026-10-13T10:30:00.000Z', startedAt: '2026-10-13T10:30:00.000Z', endsAt: ENDS, timeZone } });
const ended = (timeZone: string) => ({ ...running(timeZone), state: 'trial_expired', canWrite: false, trial: { ...running(timeZone).trial, status: 'expired' } });

const setup = (over: Partial<Extract<TrialSetupStatus, { eligible: true }>>): TrialSetupStatus => ({
  state: 'trial_available',
  eligible: true,
  durationHours: 168,
  durationDays: 7,
  requiredContacts: ['email', 'phone'],
  missingContacts: [],
  destinations: [
    { channel: 'email', masked: 'a•••@example.com' },
    { channel: 'whatsapp', masked: '+222••••1234' },
  ],
  delivery: 'sent',
  sentTo: ['email'],
  lastAttemptAt: '2026-10-13T10:00:00.000Z',
  timeZone: 'Asia/Tokyo',
  ...over,
});

/** The server: one entitlement, and the trial's setup status — or the refusal it gives anybody but the Owner. */
function serve(entitlement: object, trialSetup: TrialSetupStatus | Error) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/entitlement') return entitlement;
    if (path === '/account/trial-setup') {
      if (trialSetup instanceof Error) throw trialSetup;
      return trialSetup;
    }
    throw new Error(`unexpected read ${path}`);
  });
}

function renderScreen(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </ThemeProvider>,
  );
}

/** Every string inside an element: what a person can read in it. */
function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join(' ');
}

/** Anything that reacts to a press, or presents itself as a button or a link. */
function pressables(node: ReactTestInstance): ReactTestInstance[] {
  return node.findAll(
    (n) =>
      typeof n.props.onPress === 'function' ||
      typeof n.props.onLongPress === 'function' ||
      ['button', 'link', 'imagebutton', 'togglebutton'].includes(n.props.accessibilityRole) ||
      ['button', 'link'].includes(n.props.role) ||
      n.props.href !== undefined,
  );
}

/** What a trial action would say — none may be on screen, in any of the three languages. */
const TRIAL_ACTION = /start my|claim (my|your|the) |resend|\bsend (the )?(setup )?instructions|démarrer mon|renvoyer|إعادة إرسال|ابدأ فترتي/i;
const WEBSITE = /https?:|www\.|website|site web|\bsite\b|موقع/i;

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
});

describe('the Owner of a business that has not started', () => {
  it('sees the display-only card — eligible, not started, the server’s days, the masked contacts — and that the instructions were sent', async () => {
    serve(notStarted, setup({ delivery: 'sent' }));
    renderScreen(<AccessClosed />);

    const card = await screen.findByTestId('trial-setup-card');
    expect(screen.getByText('Your business is eligible for a 7-day free trial')).toBeTruthy();
    expect(screen.getByText('Your trial has not started yet.')).toBeTruthy();
    // Heard as available AND not started — never as a running trial.
    expect(screen.getByText('Trial status: Available').props.accessibilityLabel).toBe('Trial status: Available, not started');
    expect(screen.getByText('Duration after activation: 7 days')).toBeTruthy();
    expect(screen.getByText('Starts only after you claim it')).toBeTruthy();
    expect(screen.getByText('Verified contact: a•••@example.com')).toBeTruthy();
    expect(screen.getByText('Verified contact: +222••••1234')).toBeTruthy();
    expect(screen.getByText('We sent the instructions for completing your business setup to your verified contact.')).toBeTruthy();

    // Nothing inside the card can be pressed, links anywhere, or names a website.
    expect(pressables(card)).toHaveLength(0);
    expect(textOf(card)).not.toMatch(WEBSITE);
    expect(textOf(card)).not.toMatch(/price|MRU|\bpay|payment|QR/i);
    // The neutral staff words are not shown to the Owner.
    expect(screen.queryByText(t('access.closed.not_started.body'))).toBeNull();
  });

  it('keeps only the screen’s three general actions — none of them about the trial — and never writes anything', async () => {
    serve(notStarted, setup({ delivery: 'sent' }));
    renderScreen(<AccessClosed />);
    await screen.findByTestId('trial-setup-card');

    const labels = screen.getAllByRole('button').map((n) => textOf(n).replace(/\s+/g, ' ').trim());
    expect(labels).toEqual([t('access.recheck'), t('action.signOut'), t('account.delete.link')]);
    expect(textOf(screen.root)).not.toMatch(TRIAL_ACTION);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Check again reads the business’s access and the instructions’ status again — reads only', async () => {
    serve(notStarted, setup({ delivery: 'failed' }));
    renderScreen(<AccessClosed />);
    await screen.findByText('The setup instructions could not be sent. Your trial has not started. Please contact Dukan ERP support.');

    serve(notStarted, setup({ delivery: 'sent' }));
    await act(async () => {
      fireEvent.press(screen.getByText(t('access.recheck')));
    });
    expect(await screen.findByText('We sent the instructions for completing your business setup to your verified contact.')).toBeTruthy();
    const reads = (api.get as jest.Mock).mock.calls.map(([path]) => path);
    expect(reads.filter((p: string) => p === '/entitlement')).toHaveLength(2);
    expect(reads.filter((p: string) => p === '/account/trial-setup')).toHaveLength(2);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('waiting for the WhatsApp number: the instructions go automatically once it is verified — nothing to press', async () => {
    serve(notStarted, setup({ delivery: 'waiting_for_contact', missingContacts: ['phone'], destinations: [{ channel: 'email', masked: 'a•••@example.com' }], sentTo: [], lastAttemptAt: null }));
    renderScreen(<AccessClosed />);
    const card = await screen.findByTestId('trial-setup-card');
    expect(screen.getByText('The instructions will be sent automatically once your WhatsApp number is verified.')).toBeTruthy();
    expect(screen.queryByText('Verified contact: +222••••1234')).toBeNull();
    expect(pressables(card)).toHaveLength(0);
  });

  it('waiting for the email address says so in its own words', async () => {
    serve(notStarted, setup({ delivery: 'waiting_for_contact', missingContacts: ['email'], destinations: [{ channel: 'whatsapp', masked: '+222••••1234' }], sentTo: [], lastAttemptAt: null }));
    renderScreen(<AccessClosed />);
    expect(await screen.findByText('The instructions will be sent automatically once your email address is verified.')).toBeTruthy();
  });

  it('no working provider: the honest unavailable line, the trial not started, and support — no "try again" button', async () => {
    serve(notStarted, setup({ delivery: 'unavailable', sentTo: [] }));
    renderScreen(<AccessClosed />);
    const card = await screen.findByTestId('trial-setup-card');
    expect(
      screen.getByText('Your business is eligible for a 7-day free trial, but setup instructions cannot be sent right now. Your trial has not started. Please contact Dukan ERP support.'),
    ).toBeTruthy();
    expect(pressables(card)).toHaveLength(0);
  });

  it('refused by every provider: could not be sent', async () => {
    serve(notStarted, setup({ delivery: 'failed', sentTo: [] }));
    renderScreen(<AccessClosed />);
    expect(await screen.findByText('The setup instructions could not be sent. Your trial has not started. Please contact Dukan ERP support.')).toBeTruthy();
  });

  it('never attempted: have not been sent', async () => {
    serve(notStarted, setup({ delivery: 'not_sent', sentTo: [], lastAttemptAt: null }));
    renderScreen(<AccessClosed />);
    expect(await screen.findByText('The setup instructions have not been sent. Your trial has not started. Please contact Dukan ERP support.')).toBeTruthy();
  });

  it('the number of days is the server’s, never one the app works out', async () => {
    serve(notStarted, setup({ durationDays: 9 }));
    renderScreen(<AccessClosed />);
    expect(await screen.findByText('Duration after activation: 9 days')).toBeTruthy();
  });
});

describe('staff of a business that has not started', () => {
  it('are refused the Owner’s status (403) and see only the neutral words — never the trial or its instructions', async () => {
    serve(notStarted, new ApiError('Only the business owner can see this.', 403, 'owner_only'));
    renderScreen(<AccessClosed />);

    expect(await screen.findByText('The business owner is finishing the setup. Check again later.')).toBeTruthy();
    expect(screen.getByText('Access has not started yet')).toBeTruthy();
    expect(screen.queryByTestId('trial-setup-card')).toBeNull();
    expect(textOf(screen.root)).not.toMatch(/trial|instructions|verified contact/i);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('before the server has answered', () => {
  it('the closed screen waits for its word rather than guess a reason', async () => {
    (api.get as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    renderScreen(<AccessClosed />);
    await act(async () => undefined);
    for (const key of ['access.closed.pending.title', 'access.closed.not_started.title', 'access.closed.ended.title'] as const) {
      expect(screen.queryByText(t(key))).toBeNull();
    }
  });
});

describe('a running free trial', () => {
  it('says "Free trial" and its exact end on the business’s clock with the clock’s name — not this machine’s', async () => {
    serve(running('Asia/Tokyo'), new Error('not asked'));
    renderScreen(<AccessScreen />);

    const line = await screen.findByText('Ends 20 Oct 2026 · 19:30 (Japan Standard Time)');
    expect(line.props.accessibilityLabel).toBe('Free trial: active, ends 20 Oct 2026 · 19:30 (Japan Standard Time)');
    expect(screen.getAllByText('Free trial').length).toBeGreaterThan(0);
    // Whatever zone this machine is in, its own reading of the instant is not what is shown (unless it is Tokyo's).
    const machine = format(new Date(ENDS), 'HH:mm');
    if (machine !== '19:30') expect(textOf(screen.root)).not.toContain(machine);
    expect(textOf(screen.root)).not.toMatch(TRIAL_ACTION);
  });

  it('the same instant in Nouakchott reads on that clock — the server’s zone decides, nothing written in the app', async () => {
    serve(running('Africa/Nouakchott'), new Error('not asked'));
    renderScreen(<AccessScreen />);
    expect(await screen.findByText('Ends 20 Oct 2026 · 10:30 (Greenwich Mean Time)')).toBeTruthy();
  });
});

describe('an ended free trial', () => {
  it('is read-only and says when it ended, on the access screen and in the tabs’ notice', async () => {
    serve(ended('America/New_York'), new Error('not asked'));
    renderScreen(
      <>
        <AccessNotice />
        <AccessScreen />
      </>,
    );
    const sentence = 'The free trial ended on 20 Oct 2026 · 06:30 (Eastern Daylight Time). You can still read and export everything.';
    await waitFor(() => expect(screen.getAllByText(sentence)).toHaveLength(2));
    expect(screen.getAllByText('Free trial ended').length).toBeGreaterThan(0);
    expect(textOf(screen.root)).not.toMatch(TRIAL_ACTION);
  });
});
