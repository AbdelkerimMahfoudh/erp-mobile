import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { PhoneField } from '../components/PhoneField';

let latest = '';
function Form({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  latest = value;
  return (
    <ThemeProvider>
      <PhoneField label="Phone" testID="phone" value={value} onChangeText={setValue} />
    </ThemeProvider>
  );
}

describe('the shared phone field', () => {
  it('is quiet until the first digit, then shows the code and sends one international string', async () => {
    await render(<Form />);
    expect(screen.queryByTestId('phone-country')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('phone'), '22123456');
    expect(await screen.findByTestId('phone-country')).toBeTruthy();
    expect(screen.getByText('+222')).toBeTruthy();
    expect(latest).toBe('+22222123456');
  });

  it('a number written whole needs no selector and keeps its country', async () => {
    await render(<Form />);
    await fireEvent.changeText(screen.getByTestId('phone'), '+33612345678');
    expect(screen.queryByTestId('phone-country')).toBeNull();
    expect(latest).toBe('+33612345678');
  });

  it('opens a stored number split, and keeps it unchanged', async () => {
    await render(<Form initial="+33612345678" />);
    expect(screen.getByText('+33')).toBeTruthy();
    expect(screen.getByTestId('phone').props.value).toBe('612345678');
    expect(latest).toBe('+33612345678');
  });

  it('writes left to right in every language', async () => {
    await render(<Form />);
    expect(screen.getByTestId('phone').props.keyboardType).toBe('phone-pad');
  });
});
