/**
 * The transfer page (D226, docs/111 §5): one universal add control, the shop's
 * word "boutique", no *#06# guidance, and wording that never says the
 * destination already has the stock.
 */
import { en } from '../lib/i18n/en';
import { fr } from '../lib/i18n/fr';
import { ar } from '../lib/i18n/ar';
import { matchesExactly } from '../app/transfers/new';
import type { InventoryStockRow, InventoryUnitRow } from '../types/api';

declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(p: string, e: 'utf8'): string };

const transferCopy = (catalogue: Record<string, string>) =>
  Object.entries(catalogue).filter(([k]) => k.startsWith('transfers.new'));

describe('transfer page copy', () => {
  it('French says boutique, never site', () => {
    for (const [key, value] of transferCopy(fr)) {
      expect({ key, site: /\bsites?\b/i.test(value) }).toEqual({ key, site: false });
    }
  });

  it('no language offers *#06# as guidance', () => {
    for (const catalogue of [en, fr, ar]) {
      for (const [key, value] of transferCopy(catalogue)) {
        expect({ key, hint: value.includes('*#06#') }).toEqual({ key, hint: false });
      }
    }
  });

  it('the approval notes never claim the destination has received anything', () => {
    for (const catalogue of [en, fr, ar]) {
      for (const key of ['transfers.new.note.approved', 'transfers.new.note.awaits'] as const) {
        expect(catalogue[key]).toContain('{to}');
      }
    }
    expect(en['transfers.new.note.approved']).not.toMatch(/\b(received|has arrived)\b/i);
  });
});

describe('transfer page structure', () => {
  const source = readFileSync(`${__dirname}/../app/transfers/new.tsx`, 'utf8');

  it('has no separate accessory section and no IMEI-only entry', () => {
    expect(source).not.toContain('findAccessory');
    expect(source).not.toContain('transfers.new.manual');
    expect(source).not.toContain('placeholder="356938035643809"');
  });

  it('keeps one request id across retries and a sticky review action', () => {
    expect(source).toContain('useRef<string>(uuidv4())');
    expect(source).toContain("t('transfers.new.review', { count: counts.totalQuantity })");
    expect(source).toContain('<Screen footer={footer}>');
  });
});

describe('matchesExactly', () => {
  const unit = {
    kind: 'unit',
    identifier: '356938035643809',
    imeiPrimary: '356938035643809',
    imeiSecondary: '356938035643817',
    serialNo: 'SN-ABC',
    status: 'in_stock',
  } as InventoryUnitRow;
  const stock = { kind: 'stock', product: { barcode: '6901234567890' } } as InventoryStockRow;

  it('matches a unit by either IMEI or its serial, ignoring case', () => {
    expect(matchesExactly(unit, '356938035643817')).toBe(true);
    expect(matchesExactly(unit, 'sn-abc')).toBe(true);
    expect(matchesExactly(unit, '35693803564')).toBe(false);
  });

  it('matches stock by its barcode only', () => {
    expect(matchesExactly(stock, '6901234567890')).toBe(true);
    expect(matchesExactly(stock, '690123')).toBe(false);
  });
});
