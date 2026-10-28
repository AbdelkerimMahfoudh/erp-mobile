/// <reference types="jest" />
/**
 * One scanner, two purposes (the owner's device test, 2026-10-28).
 *
 * The Sale scanner said "This phone is already in inventory" and disabled the
 * button for the very phone being sold: it ran receiving's duplicate rule.
 * Parsing, the camera lock and normalisation are shared; the PURPOSE decides
 * what a unit in stock means. Here the same IMEI is refused when receiving and
 * is the unit offered for sale when selling.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import type { SaleSelection, ScanResult } from '../types/api';

type CameraProps = { onBarcodeScanned?: (r: unknown) => void; onLayout?: (e: unknown) => void };
const mockCamera: { props: CameraProps | null } = { props: null };
jest.mock('expo-camera', () => ({
  __esModule: true,
  CameraView: (props: CameraProps) => {
    mockCamera.props = props;
    return null;
  },
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    body?: unknown;
    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
      this.body = code ? { code } : undefined;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(async () => null), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});

import { api, ApiError } from '../lib/api-client';
import { ScannerSheet } from '../components/scanner/ScannerSheet';

const IMEI = '001010019000114';
const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const IN_STOCK_AS_DUPLICATE = {
  code: IMEI,
  kind: 'imei',
  recognized: false,
  confidence: 0,
  recognitionKey: null,
  suggestion: null,
  inventory: { alreadyInInventory: true, unit: { productLabel: 'Apple iPhone 18 Pro Max 256 GB', branchName: 'Main counter' } },
} as unknown as ScanResult;

const selection = (over: Partial<SaleSelection> = {}): SaleSelection =>
  ({
    kind: 'unit',
    availability: 'available',
    status: 'in_stock',
    matchedBy: 'imei1',
    identifierMasked: '•••• 0114',
    hasSecondImei: false,
    product: { brand: 'Apple', model: 'iPhone 18 Pro Max', variant: '256 GB', storage: '256 GB', colour: null, trackingType: 'imei' },
    price: 50000,
    otherBranch: null,
    dateIn: '2026-10-28T10:00:00.000Z',
    ...over,
  }) as unknown as SaleSelection;

function Harness({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

let now = 0;
beforeEach(() => {
  now = 0;
  mockCamera.props = null;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  get.mockReset();
  post.mockReset().mockResolvedValue(IN_STOCK_AS_DUPLICATE);
});
afterEach(() => jest.restoreAllMocks());

/** A code held still in the middle of the frame for well over the window. */
async function hold(code: string) {
  await act(() => mockCamera.props?.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
  const corners = [
    { x: 120, y: 380 },
    { x: 280, y: 380 },
    { x: 280, y: 420 },
    { x: 120, y: 420 },
  ];
  for (const at of [0, 300, 600, 900, 1200, 1500]) {
    now = at;
    await act(async () => mockCamera.props?.onBarcodeScanned?.({ data: code, type: 'code128', cornerPoints: corners, coordinateSpace: 'view' }));
  }
  await act(async () => undefined);
}

describe('receiving', () => {
  it('refuses the IMEI of a unit already in stock, saying where it is', async () => {
    await render(
      <Harness>
        <ScannerSheet open purpose="receive" onClose={jest.fn()} onResult={jest.fn()} onImeiAccepted={jest.fn()} />
      </Harness>,
    );
    await hold(IMEI);
    expect(post).toHaveBeenCalledWith('/scan', { code: IMEI });
    expect(screen.getByText(t('scan.alreadyInInventory'))).toBeTruthy();
    expect(screen.getByText(t('scanner.imei.use'))).toBeTruthy();
    expect(screen.queryByText(t('scanner.sell.add'))).toBeNull();
  });
});

describe('selling', () => {
  it('the same IMEI is the unit offered for sale — its own product, Add to sale, no receiving action', async () => {
    get.mockResolvedValue(selection());
    const onResult = jest.fn();
    const onClose = jest.fn();
    await render(
      <Harness>
        <ScannerSheet open purpose="sell" onClose={onClose} onResult={onResult} />
      </Harness>,
    );
    await hold(IMEI);
    expect(get).toHaveBeenCalledWith(`/sales/selection/${IMEI}`);
    expect(post).not.toHaveBeenCalledWith('/scan', expect.anything());
    expect(screen.getByText('Apple iPhone 18 Pro Max')).toBeTruthy();
    expect(screen.getByText('256 GB')).toBeTruthy();
    expect(screen.getByText(t('pick.availability.available'))).toBeTruthy();
    // None of receiving's words or actions, and no contradictory "not recognized".
    for (const key of ['scan.alreadyInInventory', 'scanner.imei.use', 'scan.addSecond', 'scan.productUnknown'] as const) {
      expect(screen.queryByText(t(key))).toBeNull();
    }
    const add = screen.getByText(t('scanner.sell.add'));
    await act(async () => fireEvent.press(add));
    await act(async () => fireEvent.press(add));
    // Two taps, one line: the exact unit, by the identifier scanned, and the sheet closes.
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][0]).toMatchObject({ code: IMEI, kind: 'imei' });
    expect(onClose).toHaveBeenCalled();
  });

  it('repeated camera callbacks after acceptance add nothing more', async () => {
    get.mockResolvedValue(selection());
    const onResult = jest.fn();
    await render(
      <Harness>
        <ScannerSheet open purpose="sell" onClose={jest.fn()} onResult={onResult} />
      </Harness>,
    );
    await hold(IMEI);
    await act(async () => fireEvent.press(screen.getByText(t('scanner.sell.add'))));
    await hold(IMEI);
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  for (const [availability, key] of [
    ['sold', 'pick.availability.sold'],
    ['reserved', 'pick.availability.reserved'],
    ['faulty', 'pick.availability.faulty'],
    ['returned', 'pick.availability.returned'],
    ['in_transit', 'pick.availability.in_transit'],
    ['other_branch', 'pick.availability.other_branch'],
  ] as const) {
    it(`a ${availability} unit shows its own reason, and cannot be added`, async () => {
      get.mockResolvedValue(selection({ availability, status: availability }));
      const onResult = jest.fn();
      await render(
        <Harness>
          <ScannerSheet open purpose="sell" onClose={jest.fn()} onResult={onResult} />
        </Harness>,
      );
      await hold(IMEI);
      expect(screen.getByText(t(key))).toBeTruthy();
      expect(screen.queryByText(t('scan.alreadyInInventory'))).toBeNull();
      await act(async () => fireEvent.press(screen.getByText(t('scanner.sell.add'))));
      expect(onResult).not.toHaveBeenCalled();
    });
  }

  it('a unit already in this sale is said so, and not added twice', async () => {
    get.mockResolvedValue(selection());
    const onResult = jest.fn();
    await render(
      <Harness>
        <ScannerSheet open purpose="sell" inSale={(id) => id === IMEI} onClose={jest.fn()} onResult={onResult} />
      </Harness>,
    );
    await hold(IMEI);
    expect(screen.getByText(t('scanner.sell.inBasket'))).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText(t('scanner.sell.add'))));
    expect(onResult).not.toHaveBeenCalled();
  });

  it('an IMEI that is not in this branch says so — nothing is created from a sale', async () => {
    get.mockRejectedValue(new ApiError('Not found', 404, 'not_found'));
    const onResult = jest.fn();
    await render(
      <Harness>
        <ScannerSheet open purpose="sell" onClose={jest.fn()} onResult={onResult} />
      </Harness>,
    );
    await hold(IMEI);
    expect(screen.getByText(t('scanner.sell.notFound'))).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('the second IMEI of a dual-SIM phone finds the same unit', async () => {
    const IMEI2 = '001010019000122';
    get.mockResolvedValue(selection({ matchedBy: 'imei2' }));
    const onResult = jest.fn();
    await render(
      <Harness>
        <ScannerSheet open purpose="sell" onClose={jest.fn()} onResult={onResult} />
      </Harness>,
    );
    await hold(IMEI2);
    expect(get).toHaveBeenCalledWith(`/sales/selection/${IMEI2}`);
    await act(async () => fireEvent.press(screen.getByText(t('scanner.sell.add'))));
    expect(onResult.mock.calls[0][0]).toMatchObject({ code: IMEI2 });
  });
});
