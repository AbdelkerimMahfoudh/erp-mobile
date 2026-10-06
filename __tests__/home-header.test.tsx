/// <reference types="jest" />
/**
 * Home's header card (the brief of 2026-10-06, part 6): the tint must be as
 * wide as the card on a phone. React Native's default layout conformance
 * resolves an absolutely positioned child's percentage width against the
 * parent's content box, so a tint on a padded view ends 2 × padding short of
 * the card's end edge — the 6 Oct screenshot. The test pins the structure that
 * prevents it: the tint's parent carries no padding, and the padding lives on
 * the inner content view, symmetrically.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { HomeHeader } from '../components/home/HomeHeader';
import { space } from '../lib/design/tokens';
import { t } from '../lib/i18n';

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

describe('HomeHeader', () => {
  it('keeps the tint on an unpadded card and the padding on the content inside it', () => {
    render(
      <ThemeProvider>
        <HomeHeader context="Boutique 1" title="Hello, Owner" subtitle="Ready when you are." date="Tue 6 Oct" note={null} />
      </ThemeProvider>,
    );
    const card = flat(screen.getByTestId('home-header').props.style);
    for (const key of ['padding', 'paddingHorizontal', 'paddingLeft', 'paddingRight', 'paddingStart', 'paddingEnd']) {
      expect(card[key]).toBeUndefined();
    }
    expect(card.overflow).toBe('hidden');
    // The card bleeds the same small amount on both sides of the page gutter.
    expect(card.marginHorizontal).toBe(-space.xs);
    expect(card.marginLeft ?? card.marginStart).toBeUndefined();
    const content = flat(screen.getByTestId('home-header-content').props.style);
    expect(content.padding).toBe(space.base);
  });

  it('places the bell, the date and the greeting inside the padded content', () => {
    render(
      <ThemeProvider>
        <HomeHeader context="Boutique 1" title="Hello, Owner" subtitle="Ready when you are." date="Tue 6 Oct" note="Sales still count for 5 Oct until 06:00" />
      </ThemeProvider>,
    );
    const content = screen.getByTestId('home-header-content');
    const bell = screen.getByLabelText(t('more.notifications.a11y'));
    let node: { parent: unknown } | null = bell as unknown as { parent: unknown };
    let inside = false;
    while (node) {
      if (node === (content as unknown)) inside = true;
      node = node.parent as typeof node;
    }
    expect(inside).toBe(true);
    expect(screen.getByText('Tue 6 Oct')).toBeTruthy();
    expect(screen.getByText('Hello, Owner')).toBeTruthy();
    expect(screen.getByText('Sales still count for 5 Oct until 06:00')).toBeTruthy();
  });
});
