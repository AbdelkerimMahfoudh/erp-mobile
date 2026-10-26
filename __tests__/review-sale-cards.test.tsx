/// <reference types="jest" />
/**
 * The two cards of the Review sale screen (the owner's brief of 2026-10-17,
 * Picture 1), rendered: the return policy, offered as 1, 2 and 3 days or a
 * chosen duration within the existing rules, and the optional discount, closed
 * until it is opened, that refuses a figure the sale cannot take.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { formatMoney } from '../lib/format';
import { t } from '../lib/i18n';
import { describeWindow, RETURN_WINDOW_MAX_DAYS } from '../lib/return-policy';
import { ReturnPolicyCard } from '../components/sell/ReturnPolicyCard';
import { DiscountCard, discountFrom } from '../components/sell/DiscountCard';

function Policy({ defaultHours, canOverride, onChange }: { defaultHours: number; canOverride: boolean; onChange: jest.Mock }) {
  const [hours, setHours] = useState(defaultHours);
  return (
    <ThemeProvider>
      <ReturnPolicyCard
        companyDefaultHours={defaultHours}
        windowHours={hours}
        onWindowChange={(h) => {
          setHours(h);
          onChange(h);
        }}
        canOverride={canOverride}
      />
    </ThemeProvider>
  );
}

const days = (n: number) => describeWindow(n * 24, t);

describe('the return policy card', () => {
  it('offers 1, 2 and 3 days, no returns and a chosen duration to whoever may change the policy', async () => {
    const onChange = jest.fn();
    await render(<Policy defaultHours={0} canOverride onChange={onChange} />);
    expect(screen.getByText(t('returns.policy.title'))).toBeTruthy();
    for (const n of [1, 2, 3]) expect(screen.getByText(days(n))).toBeTruthy();
    expect(screen.getByText(t('settings.returns.none'))).toBeTruthy();
    await fireEvent.press(screen.getByText(days(2)));
    expect(onChange).toHaveBeenLastCalledWith(48);
    // The deadline follows the choice; the final one is the server's.
    expect(screen.getByText(t('returns.card.finalNote'))).toBeTruthy();
    expect(screen.queryByText(t('returns.policy.noReturnsPreview'))).toBeNull();
  });

  it('a chosen duration applies only when valid, and says why when not', async () => {
    const onChange = jest.fn();
    await render(<Policy defaultHours={24} canOverride onChange={onChange} />);
    await fireEvent.press(screen.getByText(t('returns.card.custom')));
    const field = screen.getByLabelText(t('returns.card.customLabel'));
    await fireEvent.changeText(field, '0');
    expect(screen.getByText(t('returns.card.problem.invalid'))).toBeTruthy();
    await fireEvent.changeText(field, String(RETURN_WINDOW_MAX_DAYS + 1));
    expect(screen.getByText(t('returns.card.problem.too_long', { max: RETURN_WINDOW_MAX_DAYS }))).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.changeText(field, '10');
    expect(onChange).toHaveBeenLastCalledWith(240);
  });

  it('never offers a window shorter than a positive shop default, and says so', async () => {
    await render(<Policy defaultHours={72} canOverride onChange={jest.fn()} />);
    expect(screen.queryByText(days(1))).toBeNull();
    expect(screen.queryByText(days(2))).toBeNull();
    expect(screen.getByText(days(3))).toBeTruthy();
    expect(screen.getByText(t('returns.card.shorterNote', { window: days(3) }))).toBeTruthy();
  });

  it('without the permission: the shop’s policy, read only — no choices', async () => {
    await render(<Policy defaultHours={48} canOverride={false} onChange={jest.fn()} />);
    expect(screen.getByText(days(2))).toBeTruthy();
    expect(screen.queryByText(t('returns.card.custom'))).toBeNull();
    expect(screen.queryByText(days(1))).toBeNull();
    expect(screen.getByText(t('returns.policy.readOnly'))).toBeTruthy();
  });
});

function Discount({ subtotal, onChange }: { subtotal: number; onChange: jest.Mock }) {
  const [text, setText] = useState('');
  return (
    <ThemeProvider>
      <DiscountCard
        text={text}
        onChangeText={(next) => {
          setText(next);
          onChange(next);
        }}
        subtotal={subtotal}
      />
    </ThemeProvider>
  );
}

describe('the discount card', () => {
  it('is closed and marked Optional until tapped; then it takes an amount, and can be removed', async () => {
    const onChange = jest.fn();
    await render(<Discount subtotal={1000} onChange={onChange} />);
    expect(screen.getByText(t('sell.discount.optional'))).toBeTruthy();
    expect(screen.queryByText(t('sell.discount.add'))).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t('sell.discount') }));
    expect(screen.getByText(t('sell.discount.add'))).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '100');
    expect(onChange).toHaveBeenLastCalledWith('100');
    await fireEvent.press(screen.getByText(t('sell.discount.remove')));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.queryByText(t('sell.discount.add'))).toBeNull();
  });

  it('refuses more than the price, on screen', async () => {
    await render(<Discount subtotal={1000} onChange={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: t('sell.discount') }));
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '1200');
    expect(screen.getByText(t('sell.discount.tooMuch'))).toBeTruthy();
  });

  it('the rule: blank is none, too much or malformed is a problem, never clipped', () => {
    expect(discountFrom('', 1000)).toEqual({ amount: 0, problem: null });
    expect(discountFrom('100', 1000)).toEqual({ amount: 100, problem: null });
    expect(discountFrom('1000', 1000)).toEqual({ amount: 1000, problem: null });
    expect(discountFrom('1000.01', 1000)).toEqual({ amount: 0, problem: 'too_much' });
    expect(discountFrom('10.555', 1000)).toEqual({ amount: 0, problem: 'invalid' });
    // The figure the summary shows when the card is closed.
    expect(t('sell.discount.applied', { amount: formatMoney(100) })).toContain(formatMoney(100));
  });
});
