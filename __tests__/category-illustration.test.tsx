/// <reference types="jest" />
/**
 * A product is drawn as what it is (D225, the owner's TestFlight feedback of 2026-10-29).
 *
 * A PlayStation 5 on the Stock list wore a desktop computer, because the row knew only that it was serial-tracked.
 * Here the real components are rendered: the row draws the console its category names, a product with no
 * category is the neutral generic rather than a phone, every picture has its own drawing, and a shop's own
 * category can be given one from the picker.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../lib/design/theme';
import { translateIn } from '../lib/i18n';
import { CATEGORY_ILLUSTRATIONS } from '../lib/category-illustration';
import { CategoryIllustrationIcon, ConsoleGlyph, ILLUSTRATION_ICONS } from '../components/ui/CategoryIllustration';
import { Thumbnail } from '../components/ui/Thumbnail';
import { StockRow } from '../components/inventory/StockRow';
import { IllustrationPicker } from '../components/catalog/IllustrationPicker';
import type { StockSummaryRow } from '../types/api';
import { componentsOfType } from './tree';

const PS5: StockSummaryRow = {
  productId: 'p-ps5',
  brand: 'Sony',
  model: 'PlayStation 5',
  variant: 'Slim · 1 TB',
  barcode: null,
  trackingType: 'serial',
  specifications: null,
  category: 'other',
  categoryVisual: { categoryId: 'c-consoles', key: 'gaming.consoles', icon: null, parentKey: 'gaming', parentIcon: null },
  available: 2,
  onHand: 2,
  reserved: 0,
  price: { min: 28000, max: 28000, pricedCount: 2, unpricedCount: 0 },
};

async function mount(node: React.ReactElement) {
  return await render(<ThemeProvider>{node}</ThemeProvider>);
}

it('gives every picture its own drawing', () => {
  const drawings = CATEGORY_ILLUSTRATIONS.map((name) => ILLUSTRATION_ICONS[name]);
  expect(drawings.every(Boolean)).toBe(true);
  expect(new Set(drawings).size).toBe(CATEGORY_ILLUSTRATIONS.length);
});

it('renders each of the twenty-four pictures', async () => {
  await mount(
    <>
      {CATEGORY_ILLUSTRATIONS.map((name) => (
        <CategoryIllustrationIcon key={name} name={name} color="#000" size={24} />
      ))}
    </>,
  );
  for (const name of CATEGORY_ILLUSTRATIONS) {
    expect(componentsOfType(ILLUSTRATION_ICONS[name]).length).toBeGreaterThanOrEqual(1);
  }
});

it('draws a PlayStation 5 on the Stock list as a console, not a desktop', async () => {
  await mount(<StockRow row={PS5} onPress={() => undefined} />);
  expect(componentsOfType(ConsoleGlyph)).toHaveLength(1);
  expect(componentsOfType(ILLUSTRATION_ICONS.desktop)).toHaveLength(0);
});

it('draws a product with no category as the neutral generic, never a phone', async () => {
  await mount(<StockRow row={{ ...PS5, categoryVisual: null }} onPress={() => undefined} />);
  expect(componentsOfType(ILLUSTRATION_ICONS.electronics)).toHaveLength(1);
  expect(componentsOfType(ILLUSTRATION_ICONS.phone)).toHaveLength(0);
});

it('the picture slot defaults to the generic, and takes the illustration it is given', async () => {
  await mount(
    <>
      <Thumbnail />
      <Thumbnail illustration="earbuds" />
    </>,
  );
  expect(componentsOfType(ILLUSTRATION_ICONS.electronics)).toHaveLength(1);
  expect(componentsOfType(ILLUSTRATION_ICONS.earbuds)).toHaveLength(1);
  expect(componentsOfType(ILLUSTRATION_ICONS.phone)).toHaveLength(0);
});

it('lets the creator of a category choose its picture, by name and selected state, not colour alone', async () => {
  const onChange = jest.fn();
  await mount(<IllustrationPicker value="console" onChange={onChange} />);
  const consoleName = translateIn('en', 'category.icon.console');
  expect(screen.getByLabelText(consoleName)).toBeChecked();
  expect(screen.getByLabelText(translateIn('en', 'category.icon.tv'))).not.toBeChecked();
  await fireEvent.press(screen.getByLabelText(translateIn('en', 'category.icon.tv')));
  expect(onChange).toHaveBeenLastCalledWith('tv');
  await fireEvent.press(screen.getByLabelText(translateIn('en', 'categories.icon.none')));
  expect(onChange).toHaveBeenLastCalledWith(null);
});
