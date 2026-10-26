/// <reference types="jest" />
/**
 * Less than the total on the real payment sheet (the owner's brief of
 * 2026-10-17, Pictures 2 and 3), driven the way a cashier drives it.
 *
 * Confirm payment with money left owing asks once, in words; Go back keeps
 * everything and sends nothing; Record outstanding balance opens the customer
 * debt card, which holds Confirm payment until a name, a phone and the days are
 * valid. A full payment never shows the card; a changed amount is asked about
 * again; nothing received is said as such; more than the total is never taken.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { useDialogStore } from '../lib/dialog';
import { isolateLtr } from '../lib/design/direction';
import { formatDate, formatMoney } from '../lib/format';
import { t } from '../lib/i18n';
import { dueDatePreview } from '../lib/sale-payment-rules';

jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(async () => ({ rows: [] })), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});

import { PaymentSheet } from '../components/sell/PaymentSheet';
import type { PaymentEntry } from '../components/sell/types';
import type { DebtorDraft } from '../lib/sale-payment-rules';

type Sent = [PaymentEntry[], DebtorDraft, number | null];

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

async function openSheet(presetCustomer: { id: string; name: string | null; phone?: string | null } | null = null, total = 1000) {
  const onComplete = jest.fn<void, Sent>();
  await render(
    <Harness>
      <PaymentSheet open onClose={() => undefined} total={total} onComplete={onComplete} accounts={[]} presetCustomer={presetCustomer} />
    </Harness>,
  );
  return onComplete;
}

const confirmButton = () => screen.getByRole('button', { name: t('sell.payment.confirm') });
const confirm = async () => {
  await act(async () => {
    await fireEvent.press(screen.getByText(t('sell.payment.confirm')));
  });
};
const asked = () => useDialogStore.getState().queue[0];
const answer = async (record: boolean) => {
  await act(async () => {
    useDialogStore.getState().resolveTop({ confirmed: record });
  });
};
const received = async (text: string) => fireEvent.changeText(screen.getByLabelText(t('sell.payment.receivedNow')), text);
const owes = (amount: number) => t('sellDebt.ask.body', { amount: isolateLtr(formatMoney(amount, { decimals: 0 })) });
const disabled = () => confirmButton().props.accessibilityState?.disabled === true;

afterEach(() => {
  // A dialog left open by a failed assertion must never leak into the next test.
  while (useDialogStore.getState().queue.length > 0) useDialogStore.getState().resolveTop({ confirmed: false });
});

describe('a full payment', () => {
  it('confirms in one tap: no question, no debt card, nobody owes anything', async () => {
    const onComplete = await openSheet();
    expect(screen.queryByText(t('sellDebt.card.title'))).toBeNull();
    await confirm();
    expect(asked()).toBeUndefined();
    expect(onComplete).toHaveBeenCalledTimes(1);
    const [payments, debtor, due] = onComplete.mock.calls[0];
    expect(payments).toEqual([expect.objectContaining({ method: 'cash', amount: 1000 })]);
    expect(debtor).toEqual({ kind: 'none' });
    expect(due).toBeNull();
  });
});

describe('a partial payment', () => {
  it('asks in words; Go back keeps everything typed and sends nothing', async () => {
    const onComplete = await openSheet();
    await received('900');
    expect(screen.getByText(t('sellDebt.remaining'), { exact: false })).toBeTruthy();
    await confirm();
    expect(asked()).toMatchObject({
      title: t('sellDebt.ask.title'),
      message: owes(100),
      confirmLabel: t('sellDebt.ask.record'),
      cancelLabel: t('sellDebt.ask.back'),
    });
    await answer(false);
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('900')).toBeTruthy();
    expect(screen.queryByText(t('sellDebt.card.title'))).toBeNull();
  });

  it('Record outstanding balance opens the debt card, which holds Confirm until name, phone and days are valid', async () => {
    const onComplete = await openSheet();
    await received('900');
    await confirm();
    await answer(true);
    expect(screen.getByText(t('sellDebt.card.title'))).toBeTruthy();
    expect(screen.getByText(t('sellDebt.card.outstanding'))).toBeTruthy();
    // Nobody named yet: held, with the reason under the button.
    expect(disabled()).toBe(true);
    expect(screen.getByText(t('sellDebt.problem.debtor_required', { amount: isolateLtr(formatMoney(100, { decimals: 0 })) }))).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.name')), 'Sidi Ahmed');
    expect(screen.getByText(t('sellDebt.problem.customer_phone_required'))).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.phone')), '1234');
    expect(screen.getByText(t('sellDebt.problem.customer_phone_invalid'))).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.phone')), '22 33 44 55');
    expect(screen.getByText(t('sellDebt.problem.due_days_required'))).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.days')), '400');
    expect(screen.getByText(t('sellDebt.problem.due_days_invalid'))).toBeTruthy();
    expect(disabled()).toBe(true);

    // Only digits reach the field; a quick choice fills it.
    await fireEvent.press(screen.getByText(t('returns.window.days', { count: 7 })));
    expect(screen.getByText(t('sellDebt.dueOn', { date: formatDate(dueDatePreview(7)) }))).toBeTruthy();
    expect(disabled()).toBe(false);

    await confirm();
    expect(asked()).toBeUndefined();
    const [payments, debtor, due] = onComplete.mock.calls[0];
    expect(payments).toEqual([expect.objectContaining({ method: 'cash', amount: 900 })]);
    expect(debtor).toEqual({ kind: 'customer_new', name: 'Sidi Ahmed', phone: '22 33 44 55' });
    expect(due).toBe(7);
  });

  it('a changed amount recalculates what is owed and asks again before anything is sent', async () => {
    const onComplete = await openSheet();
    await received('900');
    await confirm();
    await answer(true);
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.name')), 'Sidi Ahmed');
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.phone')), '22334455');
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.days')), '15');

    await received('700');
    // The card stays, with what was typed in it, and shows the new balance at once…
    expect(screen.getByText(t('sellDebt.card.title'))).toBeTruthy();
    expect(screen.getByText(t('sellDebt.onlyReceived', { amount: isolateLtr(formatMoney(700, { decimals: 0 })) }))).toBeTruthy();
    // …but the new balance is a new decision: asked about before anything is sent.
    await confirm();
    expect(asked()?.message).toBe(owes(300));
    expect(onComplete).not.toHaveBeenCalled();
    await answer(true);
    expect(screen.getByDisplayValue('Sidi Ahmed')).toBeTruthy();
    expect(screen.getByDisplayValue('15')).toBeTruthy();
    await confirm();
    expect(onComplete.mock.calls[0][0]).toEqual([expect.objectContaining({ amount: 700 })]);
    expect(onComplete.mock.calls[0][2]).toBe(15);
  });

  it('paying in full after agreeing a balance drops the card and the debt', async () => {
    const onComplete = await openSheet();
    await received('900');
    await confirm();
    await answer(true);
    await received('1000');
    expect(screen.queryByText(t('sellDebt.card.title'))).toBeNull();
    await confirm();
    expect(asked()).toBeUndefined();
    expect(onComplete.mock.calls[0].slice(1)).toEqual([{ kind: 'none' }, null]);
  });
});

describe('nothing received now', () => {
  it('is said as such, and the whole total becomes the debt with no payment sent', async () => {
    const onComplete = await openSheet();
    await received('0');
    await confirm();
    expect(asked()?.message).toBe(t('sellDebt.ask.bodyNothing', { amount: isolateLtr(formatMoney(1000, { decimals: 0 })) }));
    await answer(true);
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.name')), 'Mariem');
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.phone')), '+222 36 00 00 00');
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.days')), '30');
    await confirm();
    const [payments, debtor, due] = onComplete.mock.calls[0];
    expect(payments).toEqual([]);
    expect(debtor).toMatchObject({ kind: 'customer_new', name: 'Mariem' });
    expect(due).toBe(30);
  });
});

describe('more than the total', () => {
  it('is never a negative debt: Confirm is held and nothing is asked', async () => {
    const onComplete = await openSheet();
    await received('1200');
    expect(disabled()).toBe(true);
    expect(screen.getByText(t('sell.payment.exactOnly'))).toBeTruthy();
    expect(screen.queryByText(t('sellDebt.remaining'), { exact: false })).toBeNull();
    await confirm();
    expect(asked()).toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('an existing customer', () => {
  it('with a saved phone: the details are filled in and only the days are asked', async () => {
    const onComplete = await openSheet({ id: 'cus-1', name: 'Fatimetou', phone: '22445566' });
    await received('600');
    await confirm();
    await answer(true);
    expect(screen.getByText(t('sellDebt.chosen', { name: 'Fatimetou' }))).toBeTruthy();
    expect(screen.getByText(t('sellDebt.savedPhone', { phone: isolateLtr('22445566') }))).toBeTruthy();
    expect(screen.queryByLabelText(t('sellDebt.phoneFor', { name: 'Fatimetou' }))).toBeNull();
    expect(screen.getByText(t('sellDebt.problem.due_days_required'))).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.days')), '٣');
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    await confirm();
    expect(onComplete.mock.calls[0].slice(1)).toEqual([
      { kind: 'customer_existing', customerId: 'cus-1', name: 'Fatimetou', phone: '22445566' },
      3,
    ]);
  });

  it('with no phone saved: one is required before the sale goes', async () => {
    const onComplete = await openSheet({ id: 'cus-2', name: 'Brahim', phone: null });
    await received('500');
    await confirm();
    await answer(true);
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.days')), '7');
    expect(screen.getByText(t('sellDebt.problem.customer_phone_required'))).toBeTruthy();
    expect(disabled()).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(t('sellDebt.phoneFor', { name: 'Brahim' })), '36 11 22 33');
    await confirm();
    expect(onComplete.mock.calls[0][1]).toEqual({ kind: 'customer_existing', customerId: 'cus-2', name: 'Brahim', phone: null, typedPhone: '36 11 22 33' });
  });
});

describe('the sheet', () => {
  it('names the final action Confirm payment and keeps split payment as its own control', async () => {
    await openSheet();
    expect(screen.getByText(t('sell.payment.confirm'))).toBeTruthy();
    expect(screen.getByText(t('sell.payment.split'))).toBeTruthy();
    expect(screen.queryByText(t('sell.discount'))).toBeNull();
    expect(screen.queryByText(t('returns.policy.title'))).toBeNull();
  });
});
