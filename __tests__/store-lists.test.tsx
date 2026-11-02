import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { accountTitle, compactStores, storesLine } from '../lib/store-list';
import { translateIn } from '../lib/i18n';

/**
 * Store lists as a person reads them (D227): however many stores an account has, the compact line stays one name and a
 * count, and nothing limits its lines, so a long name wraps rather than losing the shop's identity.
 */
const LONG = 'Boutique Electronique Centrale du Grand Marche de Nouakchott Numero Vingt-Trois';
const stores = (n: number) => [
  { name: LONG, nameAr: null },
  ...Array.from({ length: n - 1 }, (_, i) => ({ name: `Store ${i}`, nameAr: `متجر ${i}` })),
];
const tIn = (language: 'en' | 'fr' | 'ar') => (key: never, vars: { count: number }) => translateIn(language, key, vars as never);
const plain = (s: string) => s.replace(/[⁨⁩]/g, '');

describe.each(['en', 'fr', 'ar'] as const)('in %s', (language) => {
  it('500 stores read as one name and a count', () => {
    const line = compactStores(stores(500), language, tIn(language) as never);
    expect(plain(line).startsWith(LONG)).toBe(true);
    expect(plain(line).length).toBeLessThan(LONG.length + 30);
    expect(plain(line)).not.toContain('Store 1');
  });

  it('renders with no line limit: a narrow screen wraps it', async () => {
    const line = compactStores(stores(500), language, tIn(language) as never);
    await render(<Text style={styles.narrow} testID="line">{line}</Text>);
    expect(screen.getByTestId('line').props.numberOfLines).toBeUndefined();
  });
});

describe('an account across a connection', () => {
  const t = tIn('en') as never;
  it('its trading name, when it has one', () => {
    expect(accountTitle({ name: 'x', tradingName: 'SARL Kiffa', stores: stores(3) }, 'en', t)).toBe('SARL Kiffa');
  });

  it('otherwise its stores, worded here', () => {
    expect(plain(accountTitle({ name: 'x', tradingName: null, stores: stores(3) }, 'en', t))).toBe(`${LONG} + 2 more`);
  });

  it('a search preview has only its one neutral string, shown as it came', () => {
    expect(accountTitle({ name: 'Boutique Centre (+2)' }, 'fr', t)).toBe('Boutique Centre (+2)');
    expect(accountTitle({ name: 'Boutique Centre (+2)', nameAr: 'متجر المركز (+2)' }, 'ar', t)).toBe('متجر المركز (+2)');
  });
});

describe('an invitation lists exactly what it assigns', () => {
  it('every store, in the reader’s script', () => {
    const assigned = [{ name: 'Centre', nameAr: 'المركز' }, { name: 'Port', nameAr: null }];
    expect(plain(storesLine(assigned, 'fr'))).toBe('Centre, Port');
    expect(plain(storesLine(assigned, 'ar'))).toBe('المركز، Port');
  });
});

const styles = StyleSheet.create({ narrow: { width: 320 } });
