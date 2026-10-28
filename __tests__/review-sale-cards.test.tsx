/// <reference types="jest" />
/**
 * The Review sale screen's card (the owner's brief of 2026-10-17, Picture 1): the
 * optional discount, closed until it is opened, that refuses a figure the sale
 * cannot take.
 *
 * The return-policy card is gone (the owner's device test, 2026-10-28): a seller
 * no longer chooses a policy for each sale. The server sells under the branch's
 * configured policy and snapshots it, and the receipt states what it recorded.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { formatMoney } from '../lib/format';
import { t } from '../lib/i18n';
import { DiscountCard, discountFrom } from '../components/sell/DiscountCard';

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
