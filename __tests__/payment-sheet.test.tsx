/// <reference types="jest" />
/**
 * The payer number on the real payment sheet (docs/21 D151), driven the way a
 * cashier drives it: Cash shows no field and sends none; an account shows it;
 * choosing Cash afterwards removes it from what is sent; moving between accounts
 * keeps it; a malformed number holds Complete with the reason on screen; and in a
 * split every part keeps its own number — removing a part never hands its number
 * to another.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import { PAYER_NUMBER_MAX_DIGITS } from '../lib/payer-number';

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

import { PaymentSheet, type ReceivingAccount } from '../components/sell/PaymentSheet';
import type { PaymentEntry } from '../components/sell/types';

const ACCOUNTS: ReceivingAccount[] = [
  { id: 'acc-bankily', label: 'Bankily Main', provider: 'bankily' },
  { id: 'acc-masrvi', label: 'Masrvi Counter', provider: 'other', providerName: 'Masrvi' },
];

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

function openSheet(total = 1500) {
  const onComplete = jest.fn<void, [PaymentEntry[], unknown]>();
  render(
    <Harness>
      <PaymentSheet
        open
        onClose={() => undefined}
        total={total}
        discount={0}
        onDiscountChange={() => undefined}
        onComplete={onComplete}
        accounts={ACCOUNTS}
        returnPolicy={{ companyDefaultHours: 0, windowHours: 0, onWindowChange: () => undefined, canOverride: false }}
      />
    </Harness>,
  );
  return onComplete;
}

const PAYER = t('sell.payment.payerNumber');
const chooseAccount = (label: string, index = 0) => {
  fireEvent.press(screen.getAllByRole('tab', { name: t('receivedVia.account') })[index]);
  fireEvent.press(screen.getAllByRole('button', { name: label })[0]);
};
const complete = () => fireEvent.press(screen.getByText(t('sell.payment.complete')));
const sent = (onComplete: jest.Mock) => onComplete.mock.calls[0][0] as PaymentEntry[];

describe('one method', () => {
  it('Cash: no payer field on screen, and none sent', () => {
    const onComplete = openSheet();
    expect(screen.queryByLabelText(PAYER)).toBeNull();
    complete();
    expect(sent(onComplete)).toEqual([expect.objectContaining({ method: 'cash', amount: 1500 })]);
    expect(sent(onComplete)[0]).not.toHaveProperty('payerNumber');
    expect(sent(onComplete)[0]).not.toHaveProperty('receivingAccountId');
  });

  it('an account shows the field; the typed number is sent normalised with that account', () => {
    const onComplete = openSheet();
    chooseAccount('Bankily Main');
    fireEvent.changeText(screen.getByLabelText(PAYER), ' +222 36 12-34-56 ');
    complete();
    expect(sent(onComplete)).toEqual([
      expect.objectContaining({ method: 'mobile', amount: 1500, receivingAccountId: 'acc-bankily', payerNumber: '+22236123456' }),
    ]);
  });

  it('blank is fine: the sale goes, with no payer number', () => {
    const onComplete = openSheet();
    chooseAccount('Bankily Main');
    complete();
    expect(sent(onComplete)[0]).toMatchObject({ receivingAccountId: 'acc-bankily' });
    expect(sent(onComplete)[0]).not.toHaveProperty('payerNumber');
  });

  it('moving to another account keeps the number; choosing Cash removes it from the request', () => {
    const kept = openSheet();
    chooseAccount('Bankily Main');
    fireEvent.changeText(screen.getByLabelText(PAYER), '36123456');
    fireEvent.press(screen.getAllByRole('button', { name: 'Masrvi Counter' })[0]);
    complete();
    expect(sent(kept)[0]).toMatchObject({ receivingAccountId: 'acc-masrvi', payerNumber: '36123456' });
  });

  it('Cash after a number was typed: the field goes and nothing is sent', () => {
    const onComplete = openSheet();
    chooseAccount('Bankily Main');
    fireEvent.changeText(screen.getByLabelText(PAYER), '36123456');
    fireEvent.press(screen.getByRole('tab', { name: t('payment.cash') }));
    expect(screen.queryByLabelText(PAYER)).toBeNull();
    complete();
    expect(sent(onComplete)[0]).toEqual(expect.objectContaining({ method: 'cash' }));
    expect(sent(onComplete)[0]).not.toHaveProperty('payerNumber');
  });

  it('a malformed number holds Complete, with the reason on screen; fixing it lets the sale go', () => {
    const onComplete = openSheet();
    chooseAccount('Bankily Main');
    fireEvent.changeText(screen.getByLabelText(PAYER), 'MR13 0002');
    expect(screen.getAllByText(t('sell.payment.payerNumber.invalid')).length).toBeGreaterThan(0);
    complete();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText(PAYER), '9'.repeat(PAYER_NUMBER_MAX_DIGITS + 1));
    expect(screen.getAllByText(t('sell.payment.payerNumber.tooLong', { max: PAYER_NUMBER_MAX_DIGITS })).length).toBeGreaterThan(0);
    complete();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText(PAYER), '36 12 34 56');
    complete();
    expect(sent(onComplete)[0]).toMatchObject({ payerNumber: '36123456' });
  });

  it('the field takes the phone pad, keeps digits left to right, stops at 40 characters and never autofills', () => {
    openSheet();
    chooseAccount('Bankily Main');
    const input = screen.getByLabelText(PAYER);
    expect(input.props).toMatchObject({ keyboardType: 'phone-pad', maxLength: 40, autoComplete: 'off', textContentType: 'none' });
    expect(screen.getByText(t('sell.payment.payerNumber.hint'))).toBeTruthy();
  });
});

describe('a split', () => {
  /** One method on Bankily with a number, received 1 000 of 1 500, then split: the rest goes to a second part. */
  function splitTwoAccounts() {
    const onComplete = openSheet();
    fireEvent.changeText(screen.getByDisplayValue('1500'), '1000');
    chooseAccount('Bankily Main');
    fireEvent.changeText(screen.getByLabelText(PAYER), '36111111');
    fireEvent.press(screen.getByText(t('sell.payment.moreOptions')));
    fireEvent.press(screen.getByText(t('sell.payment.split')));
    fireEvent.press(screen.getByText(t('sell.payment.addMethod')));
    return onComplete;
  }

  it('the first part keeps the number typed for one method; each part sends its own', () => {
    const onComplete = splitTwoAccounts();
    // The second part opened on the next free place (the drawer) with what is still due: move it to Masrvi.
    chooseAccount('Masrvi Counter', 1);
    const fields = screen.getAllByLabelText(PAYER);
    expect(fields).toHaveLength(2);
    expect(fields[0].props.value).toBe('36111111');
    fireEvent.changeText(fields[1], '36 22 22 22');
    complete();
    const parts = sent(onComplete);
    expect(parts.find((p) => p.receivingAccountId === 'acc-bankily')).toMatchObject({ amount: 1000, payerNumber: '36111111' });
    expect(parts.find((p) => p.receivingAccountId === 'acc-masrvi')).toMatchObject({ amount: 500, payerNumber: '36222222' });
  });

  it('a Cash part has no field and sends no number, beside an account part that keeps its own', () => {
    const onComplete = splitTwoAccounts();
    expect(screen.getAllByLabelText(PAYER)).toHaveLength(1);
    complete();
    const parts = sent(onComplete);
    expect(parts.find((p) => p.method === 'cash')).not.toHaveProperty('payerNumber');
    expect(parts.find((p) => p.receivingAccountId === 'acc-bankily')).toMatchObject({ payerNumber: '36111111' });
  });

  it('removing a part never hands its number to another', () => {
    const onComplete = splitTwoAccounts();
    chooseAccount('Masrvi Counter', 1);
    fireEvent.changeText(screen.getAllByLabelText(PAYER)[1], '36222222');
    // Remove the FIRST part (Bankily, 36111111): the Masrvi part must keep 36222222, not inherit the other number.
    fireEvent.press(screen.getAllByLabelText(t('action.remove'))[0]);
    expect(screen.getAllByLabelText(PAYER).map((f) => f.props.value)).toEqual(['36222222']);
    // The part left takes the whole total, so the sale completes in one place with its own number.
    fireEvent.changeText(screen.getByDisplayValue('500'), '1500');
    complete();
    expect(sent(onComplete)).toEqual([expect.objectContaining({ receivingAccountId: 'acc-masrvi', amount: 1500, payerNumber: '36222222' })]);
  });

  it('switching a part to Cash drops that part’s number only', () => {
    const onComplete = splitTwoAccounts();
    chooseAccount('Masrvi Counter', 1);
    fireEvent.changeText(screen.getAllByLabelText(PAYER)[1], '36222222');
    fireEvent.press(screen.getAllByRole('tab', { name: t('payment.cash') })[0]);
    expect(screen.getAllByLabelText(PAYER).map((f) => f.props.value)).toEqual(['36222222']);
    complete();
    const parts = sent(onComplete);
    expect(parts.find((p) => p.method === 'cash')).not.toHaveProperty('payerNumber');
    expect(parts.find((p) => p.receivingAccountId === 'acc-masrvi')).toMatchObject({ payerNumber: '36222222' });
  });
});
