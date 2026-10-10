/// <reference types="jest" />
/**
 * Money's top card with a configured account nobody has recorded an amount for
 * (the brief of 2026-10-07). The position stays Unknown; the money that moved
 * through the account today is said beneath it, from the server's own day
 * figure, in the three languages; the Owner is offered the company-account
 * sheet. A known account shows its figure and no such line.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { useI18n, t } from '../lib/i18n';
import * as layoutDirection from '../lib/design/layout-direction';
import { ExpectedMoneyCard } from '../components/money/ExpectedMoneyCard';
import type { TrackedMethod, TrackedMoney } from '../lib/money-overview';

const DAY = '2026-10-07';
const movement = (inflows: number, outflows = 0) => ({ businessDate: DAY, inflows, outflows, net: inflows - outflows });
const cash: TrackedMethod = {
  key: 'cash', channel: 'cash', accountId: null, label: '', scope: 'branch', isActive: true, known: true, position: 1000, unknownReason: null,
  anchor: { source: 'opening', amount: 1000, at: '2026-10-07T08:00:00.000Z', businessDate: DAY, byName: 'Owner', decision: 'set', awaitingOwnerReview: false },
  sinceAnchorNet: 0,
  movement: movement(0),
};
const unknown = (id: string, label: string, moved: ReturnType<typeof movement>): TrackedMethod => ({
  key: `account:${id}`, channel: 'account', accountId: id, label, scope: 'company', isActive: true, known: false, position: null, unknownReason: 'no_anchor', anchor: null, sinceAnchorNet: null, movement: moved,
});
const known = (id: string, label: string, position: number, moved: ReturnType<typeof movement>, anchorAmount = 5000): TrackedMethod => ({
  key: `account:${id}`, channel: 'account', accountId: id, label, scope: 'company', isActive: true, known: true, position, unknownReason: null,
  anchor: { source: 'declared', amount: anchorAmount, at: '2026-10-07T07:00:00.000Z', businessDate: DAY, byName: 'Owner' }, sinceAnchorNet: position - anchorAmount, movement: moved,
});
const held = (methods: TrackedMethod[], accountsVisible = true): TrackedMoney => ({
  asOf: '2026-10-07T12:00:00.000Z', businessDate: DAY, basis: 'anchor_plus_recorded_movement', branchCount: 1, accountsVisible, methods,
  total: methods.every((m) => m.known) && accountsVisible ? methods.reduce((s, m) => s + (m.position ?? 0), 0) : null,
  unknownKeys: methods.filter((m) => !m.known).map((m) => m.key),
});
/** Boutique 2 as reported: cash set to 1 000, Bankily and Sedad never set, one 20 000 sale through Sedad. */
const reported = held([cash, unknown('b', 'Bankily', movement(0)), unknown('s', 'Sedad', movement(20000))]);

const mount = (money: TrackedMoney, props: Partial<React.ComponentProps<typeof ExpectedMoneyCard>> = {}) =>
  render(
    <ThemeProvider>
      <ExpectedMoneyCard held={money} canReview dayOpen onReview={() => undefined} onSetAccounts={() => undefined} {...props} />
    </ThemeProvider>,
  );
const movedLine = (key: string) => screen.getByTestId(`moved-${key}`).props.children as string;
/** Figures are grouped and joined to their currency with no-break spaces (lib/money-format). */
const nb = '\u00a0';

describe('an unknown account that received money today', () => {
  beforeEach(async () => {
    await useI18n.getState().setLanguage('en');
  });

  it('stays Unknown, says what was recorded, and names what prevents the total', () => {
    mount(reported);
    expect(screen.getByText(t('moneyTab.expected.unknown', { names: 'Bankily · Sedad' }))).toBeTruthy();
    expect(movedLine('account:s')).toBe(`Starting amount unknown · +20${nb}000${nb}MRU recorded today`);
    // No line under an account nothing moved through, nor under the known drawer.
    expect(screen.queryByTestId('moved-account:b')).toBeNull();
    expect(screen.queryByTestId('moved-cash')).toBeNull();
    expect(screen.getAllByText(t('moneyTab.held.unknown'))).toHaveLength(2);
    // Never a figure for Sedad: the movement is said, not turned into a balance.
    expect(screen.queryByText(/^20\s000/)).toBeNull();
  });

  it('offers the Owner the company-account sheet', () => {
    const onSetAccounts = jest.fn();
    mount(reported, { onSetAccounts });
    fireEvent.press(screen.getByText(t('moneyTab.expected.setAccounts')));
    expect(onSetAccounts).toHaveBeenCalledTimes(1);
  });

  it('offers nobody else that sheet, and nobody at all when every account is known', () => {
    const first = mount(reported, { canReview: false });
    expect(screen.queryByText(t('moneyTab.expected.setAccounts'))).toBeNull();
    expect(screen.getByTestId('moved-account:s')).toBeTruthy();
    first.unmount();
    mount(held([cash, known('b', 'Bankily', 25000, movement(20000))]));
    expect(screen.queryByText(t('moneyTab.expected.setAccounts'))).toBeNull();
  });

  it('a known account shows its figure and no movement line; an explicit zero is 0, not Unknown', () => {
    mount(held([cash, known('b', 'Bankily', 25000, movement(20000)), known('s', 'Sedad', 0, movement(0), 0)]));
    expect(screen.queryByTestId('moved-account:b')).toBeNull();
    expect(screen.queryByTestId('moved-account:s')).toBeNull();
    expect(screen.queryByText(t('moneyTab.held.unknown'))).toBeNull();
    expect(screen.queryByText(t('moneyTab.expected.setAccounts'))).toBeNull();
    // 1 000 + 25 000 + 0 — the server's total, shown as such.
    expect(screen.getByText(/^26\s000\sMRU/)).toBeTruthy();
    expect(screen.getByText(/^25\s000\sMRU/)).toBeTruthy();
  });

  it('French', async () => {
    await useI18n.getState().setLanguage('fr');
    mount(reported);
    expect(movedLine('account:s')).toBe(`Montant de départ inconnu · +20${nb}000${nb}MRU enregistré aujourd’hui`);
    expect(screen.getByText('Fixer les montants des comptes')).toBeTruthy();
  });

  it('Arabic, laid out right-to-left: the signed amount is isolated left-to-right', async () => {
    await useI18n.getState().setLanguage('ar');
    const rtl = jest.spyOn(layoutDirection, 'layoutIsRTL').mockReturnValue(true);
    try {
      mount(held([cash, unknown('s', 'Sedad', movement(0, 5000))]));
      expect(movedLine('account:s')).toBe(`المبلغ الابتدائي غير معروف · \u2066−5${nb}000${nb}MRU\u2069 مسجَّل اليوم`);
      expect(screen.getByText('تحديد مبالغ الحسابات')).toBeTruthy();
    } finally {
      rtl.mockRestore();
    }
  });

  it('Arabic before the restart that flips the layout: the same words, no isolates needed', async () => {
    await useI18n.getState().setLanguage('ar');
    mount(reported);
    expect(movedLine('account:s')).toBe(`المبلغ الابتدائي غير معروف · +20${nb}000${nb}MRU مسجَّل اليوم`);
  });
});

describe('an opening awaiting the Owner’s review (D159)', () => {
  const awaiting = held([{ ...cash, anchor: { ...cash.anchor!, awaitingOwnerReview: true } } as TrackedMethod]);

  it('offers the review while the day is open', () => {
    mount(awaiting);
    expect(screen.getByText(t('moneyTab.expected.review'))).toBeTruthy();
  });

  it('a closed day refuses the review, so it is not offered — and the card says when it will be', () => {
    // Closed with the drawer attested, not counted: the opening is still the anchor, still awaiting its review.
    mount(awaiting, { dayOpen: false });
    expect(screen.queryByText(t('moneyTab.expected.review'))).toBeNull();
    expect(screen.getByText(t('moneyTab.expected.reviewClosed'))).toBeTruthy();
  });

  it('nobody but the Owner is offered either', () => {
    mount(awaiting, { canReview: false, dayOpen: false });
    expect(screen.queryByText(t('moneyTab.expected.review'))).toBeNull();
    expect(screen.queryByText(t('moneyTab.expected.reviewClosed'))).toBeNull();
  });
});
