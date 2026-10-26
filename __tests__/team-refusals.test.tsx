/// <reference types="jest" />
/**
 * What the Team sheet says when the server refuses a save — by the server's code, never its English, and never a
 * refusal dressed as another (the owner's decision of 2026-10-15: a store or a staff seat paid for during a free trial
 * is scheduled for the trial's end; the app prices, sells and activates neither).
 *
 * Every 409 and 403 the edit sheet can receive (there is no 402):
 * - no seat free for the person being let back in (409 `SEAT_LIMIT_REACHED`, store by store — whether or not a seat
 *   bought during a free trial waits for its end): beside "Can use the app", in neutral words — no price, payment,
 *   purchase, activation or website — in English, French and Arabic. It used to read "Another team member already
 *   uses that phone number.";
 * - a number another member already uses (409, the phone changed): beside the phone, as before;
 * - a contact changed without the Owner's own password, which the sheet does not ask for (403
 *   `password_confirmation_required`): beside that contact, in the app's words rather than the server's English;
 * - the business's access ended (403 `ENTITLEMENT_WRITE_BLOCKED`): the app's own words, as everywhere.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t, useI18n } from '../lib/i18n';
import { usePermissionStore } from '../lib/permissions';
import { useToastStore } from '../lib/toast';
import { TextField } from '../components/ui';
import type { TeamUser } from '../types/api';

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
  useAuth: () => ({ user: { id: 'u-owner', companyId: 'c1', name: 'Aicha' }, bootstrapping: false, signOut: jest.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { api, ApiError } from '../lib/api-client';
import TeamScreen from '../app/team';
import { componentsOfType, textInputWithin } from './tree';

/** Sara, switched off a while ago: the Owner opens her row to let her back in. */
const SARA: TeamUser = {
  id: 'u-sara',
  name: 'Sara',
  login: 'staff-5f1c2a7b9d3e',
  phone: '+22236123456',
  email: null,
  phoneVerifiedAt: '2026-10-01T09:00:00.000Z',
  emailVerifiedAt: null,
  isActive: false,
  status: 'inactive',
  invitedAt: '2026-10-01T08:00:00.000Z',
  activatedAt: '2026-10-01T09:00:00.000Z',
  pending: null,
  lastLoginAt: null,
  branches: [{ branchId: 'b1', branchName: 'Boutique 2', role: 'store_employee', canDelegate: false, canDelegateClosing: false, grantedPermissions: [] }],
  delegatablePermissions: [],
};

const base = {
  canRead: true, canWrite: true, periodEnd: null, graceEnd: null, daysRemaining: null, graceHoursRemaining: 0, subscribedBranchCount: 1,
  activeBranchCount: 1, includedSeats: 1, additionalSeats: 0, seatLimit: 1, seatsUsed: 1, overLimit: false, isComplimentary: false,
  status: 'activated', calculatedAt: '2026-10-15T09:00:00.000Z', trial: null,
};
const ACTIVE = { ...base, state: 'active', periodEnd: '2026-11-15T00:00:00.000Z' };
/** A free trial running, with a seat for Boutique 2 bought during it and waiting for its end. */
const TRIAL = {
  ...base,
  state: 'trial_active',
  trial: { status: 'active', durationHours: 168, durationDays: 7, claimedAt: '2026-10-13T10:30:00.000Z', startedAt: '2026-10-13T10:30:00.000Z', endsAt: '2026-10-20T10:30:00.000Z', timeZone: 'Africa/Nouakchott', accessAfterTrial: null },
};

/** The words a seat may never be told in, in the app: a price, a payment, a purchase, an activation or a website. */
const SELLING = /\bMRU\b|أوقية|price|prix|سعر|\bpay|paie|ادفع|الدفع|\bbuy\b|purchase|achat|\bachet|اشتر|activat|activer|تفعيل|website|\bsite\b|موقع|https?:|www\./i;

function serve(entitlement: object, users: TeamUser[] = [SARA]) {
  (api.get as jest.Mock).mockImplementation(async (path: string) => {
    if (path === '/users') return users;
    if (path === '/entitlement') return entitlement;
    throw new Error(`unexpected read ${path}`);
  });
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TeamScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** A field of the edit sheet, by its label: its input, and what it says under it. */
function field(label: string) {
  const found = componentsOfType(TextField).find((f) => f.props.label === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return { input: textInputWithin(found), error: found.props.error as string | undefined };
}

/** Open Sara's sheet, change what `edit` changes, press Save, and let the refusal land. */
async function saveRefused(refusal: Error, edit: () => Promise<unknown>) {
  (api.patch as jest.Mock).mockRejectedValueOnce(refusal);
  await mount();
  await fireEvent.press(await screen.findByText('Sara'));
  // RNTL 14: an edit is a fireEvent, and so a promise — the change lands before Save is pressed.
  await edit();
  await act(async () => {
    await fireEvent.press(screen.getByText(t('action.save')));
  });
}

const letBackIn = async () => fireEvent.press(screen.getByRole('switch', { name: t('team.field.active') }));
const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

const NO_SEAT = new ApiError('All 1 staff places are in use. Deactivate somebody, or add places, before re-enabling this account.', 409, 'SEAT_LIMIT_REACHED');

beforeEach(() => {
  (api.get as jest.Mock).mockReset();
  (api.patch as jest.Mock).mockReset();
  usePermissionStore.setState({ granted: new Set(['user.manage']), branchId: 'b1', status: 'ready', error: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  // A screen may still be mounted: English comes back inside act, as a person's own switch would.
  await act(async () => {
    await useI18n.getState().setLanguage('en');
  });
});

describe('letting somebody back in when no seat is free for them (409 SEAT_LIMIT_REACHED)', () => {
  it('says so beside "Can use the app" — never that the phone is taken, never the server’s English', async () => {
    serve(ACTIVE);
    await saveRefused(NO_SEAT, letBackIn);

    expect(await screen.findByText('No seat is free for this person right now, so they cannot use the app. Nothing was saved.')).toBeTruthy();
    expect(api.patch).toHaveBeenCalledWith('/users/u-sara', { isActive: true });
    expect(screen.queryByText(t('team.error.phoneTaken'))).toBeNull();
    expect(field(t('team.field.phone')).error).toBeUndefined();
    expect(field(t('team.field.email')).error).toBeUndefined();
    expect(screen.queryByText(/staff places|add places|re-enabling/)).toBeNull();
    // The sheet stays open on the refusal, and nothing else is said about it.
    expect(screen.getByRole('switch', { name: t('team.field.active') })).toBeTruthy();
    expect(toasts()).toEqual([]);
  });

  it('during a free trial, with a seat bought for the store waiting for the trial’s end: the same neutral words', async () => {
    serve(TRIAL);
    await saveRefused(NO_SEAT, letBackIn);

    const line = await screen.findByText(t('team.error.noSeat'));
    expect(line).toBeTruthy();
    expect(t('team.error.noSeat')).not.toMatch(SELLING);
    expect(screen.queryByText(t('team.error.phoneTaken'))).toBeNull();
  });

  it('in French and in Arabic, in the person’s own words — nothing priced, paid, bought or activated in either', async () => {
    const said = {
      fr: 'Aucune place n’est libre pour cette personne pour le moment : elle ne peut donc pas utiliser l’app. Rien n’a été enregistré.',
      ar: 'لا يوجد مقعد متاح لهذا الشخص الآن، لذا لا يمكنه استخدام التطبيق. لم يُحفظ أي شيء.',
    };
    for (const language of ['fr', 'ar'] as const) {
      await act(async () => {
        await useI18n.getState().setLanguage(language);
      });
      serve(TRIAL);
      await saveRefused(NO_SEAT, letBackIn);
      expect(await screen.findByText(said[language])).toBeTruthy();
      expect(said[language]).not.toMatch(SELLING);
      expect(screen.queryByText(t('team.error.phoneTaken'))).toBeNull();
      await screen.unmount();
    }
  });
});

describe('the contacts', () => {
  it('a number another member already uses (409, the phone changed): beside the phone, as before', async () => {
    serve(ACTIVE, [{ ...SARA, isActive: true, status: 'active' }]);
    await saveRefused(new ApiError('Another user in this company already uses that WhatsApp number', 409), async () =>
      fireEvent.changeText(field(t('team.field.phone')).input, '+22236999999'),
    );

    expect(await screen.findByText('Another team member already uses that phone number.')).toBeTruthy();
    expect(field(t('team.field.phone')).error).toBe(t('team.error.phoneTaken'));
    expect(screen.queryByText(t('team.error.noSeat'))).toBeNull();
  });

  it('an email changed without the Owner’s own password (403): beside the email, in the app’s words — the phone is not blamed', async () => {
    serve(ACTIVE, [{ ...SARA, isActive: true, status: 'active' }]);
    await saveRefused(new ApiError('Confirm your password to change a login contact.', 403, 'password_confirmation_required'), async () =>
      fireEvent.changeText(field(t('team.field.email')).input, 'sara@boutique.test'),
    );

    expect(await screen.findByText('Changing this needs your own password, and this screen does not ask for it. Nothing was saved.')).toBeTruthy();
    expect(field(t('team.field.email')).error).toBe(t('team.error.contactPassword'));
    expect(field(t('team.field.phone')).error).toBeUndefined();
    expect(screen.queryByText(/Confirm your password/)).toBeNull();
    expect(toasts()).toEqual([]);
  });

  it('the same refusal in French: the server’s English is not what the Owner reads', async () => {
    await act(async () => {
      await useI18n.getState().setLanguage('fr');
    });
    serve(ACTIVE, [{ ...SARA, isActive: true, status: 'active' }]);
    await saveRefused(new ApiError('Confirm your password to change a login contact.', 403, 'password_confirmation_required'), async () =>
      fireEvent.changeText(field(t('team.field.phone')).input, '+22236999999'),
    );

    expect(await screen.findByText('Pour modifier ceci, il faut votre propre mot de passe, et cet écran ne le demande pas. Rien n’a été enregistré.')).toBeTruthy();
    expect(field(t('team.field.email')).error).toBeUndefined();
    expect(screen.queryByText(/Confirm your password/)).toBeNull();
  });

  it('a clash on the email (409, the email changed) is never read as the phone', async () => {
    serve(ACTIVE, [{ ...SARA, isActive: true, status: 'active' }]);
    await saveRefused(new ApiError('Another user in this company already uses that email address', 409), async () =>
      fireEvent.changeText(field(t('team.field.email')).input, 'taken@boutique.test'),
    );

    expect(screen.queryByText(t('team.error.phoneTaken'))).toBeNull();
    expect(field(t('team.field.phone')).error).toBeUndefined();
    expect(toasts()).toEqual(['Another user in this company already uses that email address']);
  });
});

describe('a business whose access has ended (403 ENTITLEMENT_WRITE_BLOCKED)', () => {
  it('is told so in the app’s own words, beside no field', async () => {
    serve(ACTIVE);
    await saveRefused(new ApiError('This business can no longer record new activity.', 403, 'ENTITLEMENT_WRITE_BLOCKED'), letBackIn);

    expect(toasts()).toEqual([t('access.blocked.body')]);
    expect(screen.queryByText(t('team.error.noSeat'))).toBeNull();
    expect(field(t('team.field.phone')).error).toBeUndefined();
  });
});
