/// <reference types="jest" />
/**
 * The free trial as the app shows it (0095, 0099; the owner's briefs of 2026-10-13 and 2026-10-18), rendered: what the
 * Owner, staff, and a business whose trial runs or has ended actually see — and that none of it can be pressed.
 *
 * - The Owner of a business that has not started sees a display-only card: eligible, not started, the server's
 *   number of days, the verified contacts as the server masks them, and one delivery line for each of `sent`,
 *   `sending`, `waiting_for_contact`, `failed` and `not_sent`. Nothing inside it is pressable, links anywhere or names
 *   a website; the screen keeps only Check again, Sign out and Delete account.
 * - `sent` names what the server names: the channel (WhatsApp, or email when WhatsApp could not carry them), the
 *   contact as the server masks it, and the day — on the business's clock with its zone's name, in English, French
 *   and Arabic laid out right to left. A server that names none of them keeps the general line.
 * - `not_sent` is told apart by whether instructions ever went out (C17): never; or sent on a day, the latest lost.
 * - Staff, refused the Owner's status by the server (403), see the neutral "not started" words only.
 * - A running trial says when it ends and an ended one when it ended — the server's UTC instant on the business's
 *   own clock, with the clock's name. The zones are Tokyo and New York, so neither GMT nor this machine's clock is
 *   what makes these pass (`lib/zoned-time.test.ts` reruns the formatting on phones set to five zones).
 */
import React from 'react';
import { format } from 'date-fns';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { TestInstance as ReactTestInstance } from 'test-renderer';
import { componentsWithin, type ComponentNode } from './tree';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import * as layoutDirection from '../lib/design/layout-direction';
import { t, useI18n } from '../lib/i18n';
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
const SENT_AT = '2026-10-13T10:00:00.000Z';

const base = {
  periodEnd: null, graceEnd: null, daysRemaining: null, graceHoursRemaining: 0, subscribedBranchCount: 1, activeBranchCount: 1,
  includedSeats: 1, additionalSeats: 0, seatLimit: 1, seatsUsed: 0, overLimit: false, isComplimentary: false, status: 'pending_activation', calculatedAt: '2026-10-13T09:00:00.000Z',
};
const notStarted = { ...base, state: 'trial_available', canRead: false, canWrite: false, trial: { status: 'available', durationHours: 168, durationDays: 7, claimedAt: null, startedAt: null, endsAt: null, timeZone: 'Asia/Tokyo' } };
const running = (timeZone: string) => ({ ...base, state: 'trial_active', canRead: true, canWrite: true, trial: { status: 'active', durationHours: 168, durationDays: 7, claimedAt: '2026-10-13T10:30:00.000Z', startedAt: '2026-10-13T10:30:00.000Z', endsAt: ENDS, timeZone } });
const ended = (timeZone: string) => ({ ...running(timeZone), state: 'trial_expired', canWrite: false, trial: { ...running(timeZone).trial, status: 'expired' } });

/** The server's answer for an eligible business: by default, the instructions sent by WhatsApp to the verified number. */
const setup = (over: Partial<Extract<TrialSetupStatus, { eligible: true }>>): TrialSetupStatus => ({
  state: 'trial_available',
  eligible: true,
  durationHours: 168,
  durationDays: 7,
  requiredContacts: ['phone'],
  missingContacts: [],
  destinations: [
    { channel: 'whatsapp', masked: '+222••••1234' },
    { channel: 'email', masked: 'a•••@example.com' },
  ],
  delivery: 'sent',
  channel: 'whatsapp',
  destination: '+222••••1234',
  fallbackReason: null,
  failureReason: null,
  lastAttemptAt: SENT_AT,
  lastSentAt: SENT_AT,
  timeZone: 'Asia/Tokyo',
  ...over,
});
/** Nothing has gone out, nor was ever to go. */
const nothingSent = { channel: null, destination: null, lastAttemptAt: null, lastSentAt: null } as const;

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

async function renderScreen(node: React.ReactElement) {
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
function pressables(node: ReactTestInstance): ComponentNode[] {
  return componentsWithin(
    node,
    (props) =>
      typeof props.onPress === 'function' ||
      typeof props.onLongPress === 'function' ||
      ['button', 'link', 'imagebutton', 'togglebutton'].includes(props.accessibilityRole) ||
      ['button', 'link'].includes(props.role) ||
      props.href !== undefined,
  );
}

/** What a trial action would say — none may be on screen, in any of the three languages. */
const TRIAL_ACTION = /start my|claim (my|your|the) |resend|\bsend (the )?(setup )?instructions|démarrer mon|renvoyer|إعادة إرسال|ابدأ فترتي/i;
const WEBSITE = /https?:|www\.|website|site web|\bsite\b|موقع/i;
const SENT_BY_WHATSAPP = 'We sent the instructions for completing your business setup by WhatsApp to +222••••1234 on 13 Oct 2026 · 19:00 (Japan Standard Time).';
const SENT_GENERAL = 'We sent the instructions for completing your business setup to your verified contact.';

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.post as jest.Mock).mockReset();
});

describe('the Owner of a business that has not started', () => {
  it('sees the display-only card — eligible, not started, the server’s days, the masked contacts — and that the instructions were sent', async () => {
    serve(notStarted, setup({ delivery: 'sent' }));
    await renderScreen(<AccessClosed />);

    const card = await screen.findByTestId('trial-setup-card');
    expect(screen.getByText('Your business is eligible for a 7-day free trial')).toBeTruthy();
    expect(screen.getByText('Your trial has not started yet.')).toBeTruthy();
    // Heard as available AND not started — never as a running trial.
    expect(screen.getByText('Trial status: Available').props.accessibilityLabel).toBe('Trial status: Available, not started');
    expect(screen.getByText('Duration after activation: 7 days')).toBeTruthy();
    expect(screen.getByText('Starts only after you claim it')).toBeTruthy();
    expect(screen.getByText('Verified contact: +222••••1234')).toBeTruthy();
    expect(screen.getByText('Verified contact: a•••@example.com')).toBeTruthy();
    expect(screen.getByText(SENT_BY_WHATSAPP)).toBeTruthy();

    // Nothing inside the card can be pressed, links anywhere, or names a website.
    expect(pressables(card)).toHaveLength(0);
    expect(textOf(card)).not.toMatch(WEBSITE);
    expect(textOf(card)).not.toMatch(/price|MRU|\bpay|payment|QR/i);
    // The neutral staff words are not shown to the Owner.
    expect(screen.queryByText(t('access.closed.not_started.body'))).toBeNull();
  });

  it('is not sent to an organisation administrator: the card names Dukan ERP support, and the organisation’s lines are left out', async () => {
    for (const over of [{ delivery: 'sent' }, { delivery: 'failed', failureReason: 'no_email', lastSentAt: null }, { delivery: 'not_sent', ...nothingSent }] as const) {
      serve(notStarted, setup(over));
      const view = await renderScreen(<AccessClosed />);
      await screen.findByTestId('trial-setup-card');
      expect(screen.queryByText(t('access.managed'))).toBeNull();
      expect(screen.queryByText(t('access.mistake'))).toBeNull();
      await view.unmount();
    }
  });

  it('keeps only the screen’s three general actions — none of them about the trial — and never writes anything', async () => {
    serve(notStarted, setup({ delivery: 'sent' }));
    await renderScreen(<AccessClosed />);
    await screen.findByTestId('trial-setup-card');

    const labels = screen.getAllByRole('button').map((n) => textOf(n).replace(/\s+/g, ' ').trim());
    expect(labels).toEqual([t('access.recheck'), t('action.signOut'), t('account.delete.link')]);
    expect(textOf(screen.container)).not.toMatch(TRIAL_ACTION);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Check again reads the business’s access and the instructions’ status again — reads only', async () => {
    serve(notStarted, setup({ delivery: 'failed', failureReason: 'no_email', lastSentAt: null }));
    await renderScreen(<AccessClosed />);
    await screen.findByText('The setup instructions could not be sent. Your trial has not started. Please contact Dukan ERP support.');

    serve(notStarted, setup({ delivery: 'sent' }));
    await act(async () => {
      await fireEvent.press(screen.getByText(t('access.recheck')));
    });
    expect(await screen.findByText(SENT_BY_WHATSAPP)).toBeTruthy();
    const reads = (api.get as jest.Mock).mock.calls.map(([path]) => path);
    expect(reads.filter((p: string) => p === '/entitlement')).toHaveLength(2);
    expect(reads.filter((p: string) => p === '/account/trial-setup')).toHaveLength(2);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('waiting for the WhatsApp number: the instructions go automatically once it is verified — nothing to press', async () => {
    serve(notStarted, setup({ delivery: 'waiting_for_contact', missingContacts: ['phone'], destinations: [{ channel: 'email', masked: 'a•••@example.com' }], ...nothingSent }));
    await renderScreen(<AccessClosed />);
    const card = await screen.findByTestId('trial-setup-card');
    expect(screen.getByText('The instructions will be sent automatically once your WhatsApp number is verified.')).toBeTruthy();
    expect(screen.queryByText('Verified contact: +222••••1234')).toBeNull();
    expect(pressables(card)).toHaveLength(0);
  });

  it('waiting for the email address — a business that registered with one before the number was required — says so in its own words', async () => {
    serve(notStarted, setup({ delivery: 'waiting_for_contact', requiredContacts: ['email'], missingContacts: ['email'], destinations: [], ...nothingSent }));
    await renderScreen(<AccessClosed />);
    expect(await screen.findByText('The instructions will be sent automatically once your email address is verified.')).toBeTruthy();
  });

  it('being sent — asked for, not yet handed to a provider: says so, beside the verified contacts, with nothing to press', async () => {
    serve(notStarted, setup({ delivery: 'sending', lastSentAt: null }));
    await renderScreen(<AccessClosed />);
    const card = await screen.findByTestId('trial-setup-card');
    expect(screen.getByText('We are sending the instructions for completing your business setup to your verified contact.')).toBeTruthy();
    expect(screen.getByText('Verified contact: +222••••1234')).toBeTruthy();
    expect(pressables(card)).toHaveLength(0);
    expect(textOf(screen.container)).not.toMatch(TRIAL_ACTION);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('carried by nothing: could not be sent — whatever the reason the server recorded, which the app does not repeat', async () => {
    for (const failureReason of ['no_email', 'email_unavailable', 'opted_out'] as const) {
      serve(notStarted, setup({ delivery: 'failed', failureReason, lastSentAt: null }));
      const view = await renderScreen(<AccessClosed />);
      const card = await screen.findByTestId('trial-setup-card');
      expect(screen.getByText('The setup instructions could not be sent. Your trial has not started. Please contact Dukan ERP support.')).toBeTruthy();
      expect(textOf(card)).not.toMatch(new RegExp(failureReason));
      expect(pressables(card)).toHaveLength(0);
      await view.unmount();
    }
  });

  it('never attempted: have not been sent', async () => {
    serve(notStarted, setup({ delivery: 'not_sent', ...nothingSent }));
    await renderScreen(<AccessClosed />);
    expect(await screen.findByText('The setup instructions have not been sent. Your trial has not started. Please contact Dukan ERP support.')).toBeTruthy();
  });

  it('the number of days is the server’s, never one the app works out', async () => {
    serve(notStarted, setup({ durationDays: 9 }));
    await renderScreen(<AccessClosed />);
    expect(await screen.findByText('Duration after activation: 9 days')).toBeTruthy();
  });
});

describe('instructions that were sent — by which channel, to which contact, on which day — and ones lost after (C17)', () => {
  const LATEST = 'The setup instructions were sent to your verified contact on 13 Oct 2026 · 19:00 (Japan Standard Time), but the latest ones have not been sent. Your trial has not started. Please contact Dukan ERP support.';
  const NEVER = 'The setup instructions have not been sent. Your trial has not started. Please contact Dukan ERP support.';
  const LINK = /\blinks?\b|\bliens?\b|رابط/i;

  afterEach(async () => {
    jest.restoreAllMocks();
    // The last screen is still mounted: English comes back inside act, as a person's own switch would.
    await act(async () => {
      await useI18n.getState().setLanguage('en');
    });
  });

  /** The card, read once it shows. */
  async function cardFor(over: Parameters<typeof setup>[0]) {
    serve(notStarted, setup(over));
    const view = await renderScreen(<AccessClosed />);
    const card = await screen.findByTestId('trial-setup-card');
    return { card, view };
  }

  it('sent by WhatsApp: the channel, the number as the server masks it, and the day on the business’s clock — nothing to press', async () => {
    const { card } = await cardFor({});
    expect(screen.getByText(SENT_BY_WHATSAPP)).toBeTruthy();
    expect(pressables(card)).toHaveLength(0);
    expect(textOf(card)).not.toMatch(TRIAL_ACTION);
    expect(textOf(card)).not.toMatch(WEBSITE);
    expect(textOf(card)).not.toMatch(LINK);
    // The business's clock, not this machine's (unless this machine reads Tokyo's).
    const machine = format(new Date(SENT_AT), 'HH:mm');
    if (machine !== '19:00') expect(textOf(card)).not.toContain(` ${machine} `);
  });

  it('the zone the server names decides the hour, and is named: the same instant in New York', async () => {
    await cardFor({ timeZone: 'America/New_York' });
    expect(screen.getByText(SENT_BY_WHATSAPP.replace('13 Oct 2026 · 19:00 (Japan Standard Time)', '13 Oct 2026 · 06:00 (Eastern Daylight Time)'))).toBeTruthy();
  });

  it('sent by email, WhatsApp having failed for a reason the server recorded: says email and the masked address — never the reason', async () => {
    const { card } = await cardFor({ channel: 'email', destination: 'a•••@example.com', fallbackReason: 'number_undeliverable' });
    expect(screen.getByText('We sent the instructions for completing your business setup by email to a•••@example.com on 13 Oct 2026 · 19:00 (Japan Standard Time).')).toBeTruthy();
    expect(textOf(card)).not.toMatch(/undeliverable|fallback/i);
    expect(pressables(card)).toHaveLength(0);
  });

  it('a server that names no channel, contact or day — or one too old to — keeps the general sent line', async () => {
    const olderServer = setup({}) as Record<string, unknown>;
    for (const key of ['channel', 'destination', 'lastSentAt', 'fallbackReason', 'failureReason']) delete olderServer[key];
    for (const answer of [setup({ channel: null, destination: null }), setup({ lastSentAt: null }), olderServer as TrialSetupStatus]) {
      serve(notStarted, answer);
      const view = await renderScreen(<AccessClosed />);
      const card = await screen.findByTestId('trial-setup-card');
      expect(screen.getByText(SENT_GENERAL)).toBeTruthy();
      expect(textOf(card)).not.toMatch(/by WhatsApp|by email| on \d/);
      await view.unmount();
    }
  });

  it('never sent — and a server too old to say when — keeps the line it always had', async () => {
    const olderServer = setup({ delivery: 'not_sent' }) as Record<string, unknown>;
    for (const key of ['channel', 'destination', 'lastSentAt']) delete olderServer[key];
    for (const answer of [setup({ delivery: 'not_sent', ...nothingSent }), olderServer as TrialSetupStatus]) {
      serve(notStarted, answer);
      const view = await renderScreen(<AccessClosed />);
      const card = await screen.findByTestId('trial-setup-card');
      expect(screen.getByText(NEVER)).toBeTruthy();
      expect(textOf(card)).not.toMatch(/were sent|latest/);
      await view.unmount();
    }
  });

  it('sent once, the latest lost on the way: says both — nothing to press', async () => {
    const { card } = await cardFor({ delivery: 'not_sent', lastSentAt: SENT_AT });
    expect(screen.getByText(LATEST)).toBeTruthy();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(pressables(card)).toHaveLength(0);
    expect(textOf(card)).not.toMatch(TRIAL_ACTION);
    expect(textOf(card)).not.toMatch(LINK);
    // Still the screen's three general actions, and nothing is ever written.
    const labels = screen.getAllByRole('button').map((n) => textOf(n).replace(/\s+/g, ' ').trim());
    expect(labels).toEqual([t('access.recheck'), t('action.signOut'), t('account.delete.link')]);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('in French, the channel, the masked contact and the day in French on the business’s clock', async () => {
    await useI18n.getState().setLanguage('fr');
    const whatsapp = await cardFor({});
    expect(
      screen.getByText('Nous avons envoyé les instructions pour finaliser la configuration de votre commerce par WhatsApp au +222••••1234 le 13 oct. 2026 · 19:00 (heure normale du Japon).'),
    ).toBeTruthy();
    expect(textOf(whatsapp.card)).not.toMatch(LINK);
    await whatsapp.view.unmount();

    const email = await cardFor({ channel: 'email', destination: 'a•••@example.com', fallbackReason: 'whatsapp_disabled' });
    expect(
      screen.getByText('Nous avons envoyé les instructions pour finaliser la configuration de votre commerce par e-mail à a•••@example.com le 13 oct. 2026 · 19:00 (heure normale du Japon).'),
    ).toBeTruthy();
    await email.view.unmount();

    const latest = await cardFor({ delivery: 'not_sent', lastSentAt: SENT_AT });
    expect(
      screen.getByText(
        'Les instructions de configuration ont été envoyées à votre contact vérifié le 13 oct. 2026 · 19:00 (heure normale du Japon), mais les plus récentes n’ont pas été envoyées. Votre essai n’a pas commencé. Veuillez contacter l’assistance Dukan ERP.',
      ),
    ).toBeTruthy();
    expect(pressables(latest.card)).toHaveLength(0);
  });

  it('in Arabic, laid out right to left: the number held left to right, the day in its own order — each isolated from the sentence', async () => {
    await useI18n.getState().setLanguage('ar');
    jest.spyOn(layoutDirection, 'layoutIsRTL').mockReturnValue(true);
    const day = '⁨13 أكتوبر 2026 · 19:00 (توقيت اليابان الرسمي)⁩';
    const number = '⁦+222••••1234⁩';

    const whatsapp = await cardFor({});
    expect(screen.getByText(`أرسلنا تعليمات إكمال إعداد نشاطك التجاري عبر واتساب إلى ${number} في ${day}.`)).toBeTruthy();
    expect(textOf(whatsapp.card)).not.toMatch(LINK);
    expect(textOf(whatsapp.card)).not.toMatch(TRIAL_ACTION);
    await whatsapp.view.unmount();

    const latest = await cardFor({ delivery: 'not_sent', lastSentAt: SENT_AT });
    expect(screen.getByText(`أُرسلت تعليمات الإعداد إلى وسيلة الاتصال التي تم التحقق منها في ${day}، لكن أحدث التعليمات لم تُرسل. لم تبدأ فترتك التجريبية. يرجى التواصل مع دعم Dukan ERP.`)).toBeTruthy();
    expect(pressables(latest.card)).toHaveLength(0);
  });
});

describe('staff of a business that has not started', () => {
  it('are refused the Owner’s status (403) and see only the neutral words — never the trial or its instructions', async () => {
    serve(notStarted, new ApiError('Only the business owner can see this.', 403, 'owner_only'));
    await renderScreen(<AccessClosed />);

    expect(await screen.findByText('The business owner is finishing the setup. Check again later.')).toBeTruthy();
    expect(screen.getByText('Access has not started yet')).toBeTruthy();
    expect(screen.queryByTestId('trial-setup-card')).toBeNull();
    expect(textOf(screen.container)).not.toMatch(/trial|instructions|verified contact/i);
    // Staff keep the organisation's lines: their Owner is the one to ask.
    expect(screen.getByText(t('access.managed'))).toBeTruthy();
    expect(screen.getByText(t('access.mistake'))).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('a business closed for another reason', () => {
  it('keeps the organisation’s lines, whoever reads them', async () => {
    serve({ ...base, state: 'pending', canRead: false, canWrite: false, trial: null }, new Error('not asked'));
    await renderScreen(<AccessClosed />);
    expect(await screen.findByText(t('access.closed.pending.body'))).toBeTruthy();
    expect(screen.getByText(t('access.managed'))).toBeTruthy();
    expect(screen.getByText(t('access.mistake'))).toBeTruthy();
  });
});

describe('before the server has answered', () => {
  it('the closed screen waits for its word rather than guess a reason', async () => {
    (api.get as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    await renderScreen(<AccessClosed />);
    await act(async () => undefined);
    for (const key of ['access.closed.pending.title', 'access.closed.not_started.title', 'access.closed.ended.title'] as const) {
      expect(screen.queryByText(t(key))).toBeNull();
    }
  });
});

describe('a running free trial', () => {
  it('says "Free trial" and its exact end on the business’s clock with the clock’s name — not this machine’s', async () => {
    serve(running('Asia/Tokyo'), new Error('not asked'));
    await renderScreen(<AccessScreen />);

    const line = await screen.findByText('Ends 20 Oct 2026 · 19:30 (Japan Standard Time)');
    expect(line.props.accessibilityLabel).toBe('Free trial: active, ends 20 Oct 2026 · 19:30 (Japan Standard Time)');
    expect(screen.getAllByText('Free trial').length).toBeGreaterThan(0);
    // Whatever zone this machine is in, its own reading of the instant is not what is shown (unless it is Tokyo's).
    const machine = format(new Date(ENDS), 'HH:mm');
    if (machine !== '19:30') expect(textOf(screen.container)).not.toContain(machine);
    expect(textOf(screen.container)).not.toMatch(TRIAL_ACTION);
  });

  it('the same instant in Nouakchott reads on that clock — the server’s zone decides, nothing written in the app', async () => {
    serve(running('Africa/Nouakchott'), new Error('not asked'));
    await renderScreen(<AccessScreen />);
    expect(await screen.findByText('Ends 20 Oct 2026 · 10:30 (Greenwich Mean Time)')).toBeTruthy();
  });

  it('with paid or granted access approved to start when it ends, still says only when it ends — never that the business becomes read-only', async () => {
    for (const kind of ['paid', 'granted'] as const) {
      const trial = { ...running('Asia/Tokyo').trial, accessAfterTrial: { kind, startsAt: ENDS } };
      serve({ ...running('Asia/Tokyo'), status: 'activated', trial }, new Error('not asked'));
      const view = await renderScreen(
        <>
          <AccessNotice />
          <AccessScreen />
        </>,
      );
      expect(await screen.findByText('Ends 20 Oct 2026 · 19:30 (Japan Standard Time)')).toBeTruthy();
      for (const key of ['access.readOnly.body', 'access.readOnly.notice', 'access.readOnly.kept'] as const) expect(screen.queryByText(t(key))).toBeNull();
      expect(textOf(screen.container)).not.toMatch(/read-only|read and export|ended/i);
      await view.unmount();
    }
  });
});

describe('an ended free trial', () => {
  it('is read-only and says when it ended, on the access screen and in the tabs’ notice', async () => {
    serve(ended('America/New_York'), new Error('not asked'));
    await renderScreen(
      <>
        <AccessNotice />
        <AccessScreen />
      </>,
    );
    const sentence = 'The free trial ended on 20 Oct 2026 · 06:30 (Eastern Daylight Time). You can still read and export everything.';
    await waitFor(() => expect(screen.getAllByText(sentence)).toHaveLength(2));
    expect(screen.getAllByText('Free trial ended').length).toBeGreaterThan(0);
    expect(textOf(screen.container)).not.toMatch(TRIAL_ACTION);
  });
});
