import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

/**
 * Every surface that shows a product draws its category's picture (D225): a photo when the product has one, else the
 * category's illustration, else a neutral one — never a blank box. Each surface below must resolve the picture the one
 * way the app does (`illustrationFor` / `illustrationForNested` through `Thumbnail`, `StockRow` or
 * `illustrationIconFor` for a row that takes an icon). A surface that drops it fails here.
 *
 *   node lib/category-illustration-surfaces.test.ts
 */

const SURFACES: Record<string, string> = {
  'app/receive.tsx': 'Receive: the product search results',
  'app/quick-receive.tsx': 'Quick receive: the confirmation card and the product results',
  'app/receive/file.tsx': 'Receiving from a file: each candidate product',
  'app/catalog/index.tsx': 'Catalogue list',
  'app/catalog/[id].tsx': 'Product details',
  'app/(tabs)/inventory.tsx': 'Stock',
  'app/(tabs)/sell.tsx': 'Sell: search results and the chosen product',
  'components/sell/PhonePicker.tsx': 'Choose from stock: each unit, and the chosen item',
  'components/sell/CartLineRow.tsx': 'The cart',
  'app/sales/[id].tsx': 'Sale details: each line',
  'app/sales/pay/[id].tsx': 'Paying a sale',
  'components/money/SaleRow.tsx': 'Sales history rows',
  'components/product/ProductConfirmationCard.tsx': 'The product confirmation card (scanner results)',
  'components/inventory/StockRow.tsx': 'Stock rows',
};

const READS_PICTURE = /illustrationFor(?:Nested)?\(|illustrationIconFor\(|<Thumbnail\b[^>]*illustration=|<StockRow\b|<CategoryIllustration\b/;

for (const [file, surface] of Object.entries(SURFACES)) {
  it(`${surface} shows the category's picture (${file})`, () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, READS_PICTURE);
  });
}
