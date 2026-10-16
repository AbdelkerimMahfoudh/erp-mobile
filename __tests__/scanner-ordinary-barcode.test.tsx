/// <reference types="jest" />
/**
 * The camera reads ordinary barcodes for every screen that is not booking a
 * phone in (docs/21 §6j: "the same sheet reads ordinary barcodes and must keep
 * working").
 *
 * The product form's barcode field, Sell, returns custody and the Stock tab open
 * the scanner without `onImeiAccepted`. A product barcode or a serial held in
 * the frame must reach them through `onResult`, exactly as typing it does —
 * while an IMEI intake keeps its own panel, where a non-IMEI code is explained
 * and never submitted.
 *
 * The camera itself is replaced: this drives the real sheet, stabilizer and
 * state machine with decoder callbacks, which is all a test can do. Whether a
 * device's decoder produces those callbacks is not provable here.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../lib/design/theme';
import { t } from '../lib/i18n';
import type { ScanResult } from '../types/api';

type CameraProps = {
  onBarcodeScanned?: (r: unknown) => void;
  onLayout?: (e: unknown) => void;
};
const camera: { props: CameraProps | null } = { props: null };

jest.mock('expo-camera', () => ({
  __esModule: true,
  CameraView: (props: CameraProps) => {
    camera.props = props;
    return null;
  },
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));

jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(async () => null), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});

import { api } from '../lib/api-client';
import { ScannerSheet } from '../components/scanner/ScannerSheet';

const EAN = '5901234123457';
const IMEI = '490154203237518';
const PRODUCT: ScanResult = { code: EAN, recognized: true } as unknown as ScanResult;

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
  camera.props = null;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  (api.post as jest.Mock).mockReset().mockResolvedValue(PRODUCT);
});
afterEach(() => jest.restoreAllMocks());

/** A barcode held still in the middle of the frame for well over the window. */
async function hold(code: string) {
  const width = 400;
  const height = 800;
  act(() => camera.props?.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
  const corners = [
    { x: 120, y: 380 },
    { x: 280, y: 380 },
    { x: 280, y: 420 },
    { x: 120, y: 420 },
  ];
  for (const at of [0, 300, 600, 900, 1200, 1500]) {
    now = at;
    // Read the props afresh each time: a re-render replaces the callback.
    await act(async () => camera.props?.onBarcodeScanned?.({ data: code, type: 'ean13', cornerPoints: corners, coordinateSpace: 'view' }));
  }
}

it('a product barcode reaches a caller that is not booking a phone in', async () => {
  const onResult = jest.fn();
  const onClose = jest.fn();
  render(
    <Harness>
      <ScannerSheet open onClose={onClose} onResult={onResult} />
    </Harness>,
  );
  expect(camera.props?.onBarcodeScanned).toBeDefined();

  await hold(EAN);

  expect(api.post).toHaveBeenCalledWith('/scan', { code: EAN });
  expect(onResult).toHaveBeenCalledTimes(1);
  expect(onResult).toHaveBeenCalledWith(PRODUCT);
  // Single mode: the answer closes the sheet, as a typed code always did.
  expect(onClose).toHaveBeenCalled();
  expect(screen.queryByText(t('scan.problem.notImei'))).toBeNull();
});

it('an IMEI intake still explains a product barcode and submits nothing', async () => {
  const onResult = jest.fn();
  const onImeiAccepted = jest.fn();
  render(
    <Harness>
      <ScannerSheet open onClose={jest.fn()} onResult={onResult} onImeiAccepted={onImeiAccepted} />
    </Harness>,
  );

  await hold(EAN);

  expect(screen.getByText(t('scan.problem.notImei'))).toBeTruthy();
  expect(screen.queryByText(t('scanner.imei.use'))).toBeNull();
  expect(screen.getByText(t('scan.scanAgain'))).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  expect(onResult).not.toHaveBeenCalled();
  expect(onImeiAccepted).not.toHaveBeenCalled();
});

it('an IMEI intake still shows the IMEI it read, ready to use', async () => {
  const onImeiAccepted = jest.fn();
  render(
    <Harness>
      <ScannerSheet open onClose={jest.fn()} onResult={jest.fn()} onImeiAccepted={onImeiAccepted} />
    </Harness>,
  );

  await hold(IMEI);

  expect(screen.getByText(IMEI)).toBeTruthy();
  expect(screen.getByText(t('scanner.imei.use'))).toBeTruthy();
  expect(screen.queryByText(t('scan.problem.notImei'))).toBeNull();
});
