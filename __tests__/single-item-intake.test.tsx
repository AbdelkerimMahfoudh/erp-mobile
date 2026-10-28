/// <reference types="jest" />
/**
 * The single scanned item, received in one action (D223, the owner's iPhone test of 2026-10-28).
 *
 * The device test found New product handing a draft back to an empty Receive
 * screen and then freezing: the form's own unsaved-changes guard stopped its
 * own exit. These tests render the real screen and prove what replaced it —
 * the category first, no selling price, the optional buying cost asked about
 * once, ONE purchase that creates the product with its stock, success only
 * after the server's answer, and every failure leaving the screen usable.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const params: Record<string, string> = {};
const navigation = { setOptions: jest.fn(), canGoBack: () => true, goBack: jest.fn(), dispatch: jest.fn() };
jest.mock('expo-router', () => ({
  ...jest.requireActual('./mocks/expo-router'),
  useLocalSearchParams: () => params,
  useNavigation: () => navigation,
  useRouter: () => ({ ...jest.requireActual('./mocks/expo-router').router, canGoBack: () => true, dismiss: jest.fn() }),
}));
const guard: { enabled: boolean; cb: ((e: { data: { action: unknown } }) => void) | null } = { enabled: false, cb: null };
jest.mock('../lib/navigation/router-internals', () => ({
  ...jest.requireActual('../lib/navigation/router-internals'),
  usePreventRemove: (enabled: boolean, cb: (e: { data: { action: unknown } }) => void) => {
    guard.enabled = enabled;
    guard.cb = cb;
  },
}));
jest.mock('expo-camera', () => ({
  __esModule: true,
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('../lib/api-client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return {
    __esModule: true,
    ApiError,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    clearSession: jest.fn(),
  };
});
jest.mock('../lib/dialog', () => {
  const actual = jest.requireActual('../lib/dialog');
  return { ...actual, dialog: { ...actual.dialog, choose: jest.fn(), confirm: jest.fn(async () => true), alert: jest.fn(async () => undefined) } };
});
const USER = { id: 'u1', companyId: 'c1' };
jest.mock('../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: USER }) }));

import { api, ApiError } from '../lib/api-client';
import { dialog } from '../lib/dialog';
import { ThemeProvider } from '../lib/design/theme';
import { hasKey, t } from '../lib/i18n';
import { usePermissionStore } from '../lib/permissions';
import { useBranch } from '../lib/branch';
import { clearPendingIntake, holdPendingIntake, pendingFrom } from '../lib/scan/pending-intake';
import NewProductScreen from '../app/catalog/new';

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const choose = dialog.choose as jest.Mock;
const SCOPE = { companyId: 'c1', userId: 'u1', branchId: 'b1' };
const SERIAL = 'QA-SN-0101';

const LAPTOPS = {
  id: 'cat-laptops', key: 'computers.laptops', name: 'Laptops', parentId: 'cat-computers', isActive: true,
  defaultTrackingType: 'serial', allowedTrackingTypes: ['serial', 'quantity'],
  attributeSchema: [
    { key: 'processor', label: 'Processor', type: 'text' },
    { key: 'ram', label: 'RAM', type: 'measurement', unit: 'GB' },
    { key: 'storage', label: 'Storage', type: 'measurement', unit: 'GB' },
  ],
};
const COMPUTERS = { id: 'cat-computers', key: 'computers', name: 'Laptops and computers', parentId: null, isActive: true, defaultTrackingType: 'serial', allowedTrackingTypes: ['serial', 'quantity'], attributeSchema: [] };
const SMARTPHONES = { id: 'cat-phones', key: 'phones.smartphones', name: 'Smartphones', parentId: null, isActive: true, defaultTrackingType: 'imei', allowedTrackingTypes: ['imei'], attributeSchema: [{ key: 'storage', label: 'Storage', type: 'measurement' }, { key: 'color', label: 'Colour', type: 'text' }] };
const EARBUDS = { id: 'cat-earbuds', key: 'audio.earbuds', name: 'Earbuds', parentId: null, isActive: true, defaultTrackingType: 'quantity', allowedTrackingTypes: ['serial', 'quantity'], attributeSchema: [{ key: 'color', label: 'Colour', type: 'text' }] };
const CATEGORIES = [COMPUTERS, LAPTOPS, SMARTPHONES, EARBUDS];
const labelOf = (c: { key: string; name: string }) => (hasKey(`category.builtin.${c.key}`) ? t(`category.builtin.${c.key}` as never) : c.name);

const OK = { purchaseId: 'p1', unitsCreated: 1, stockLines: 0, total: 0, createdProducts: [{ productId: 'new1' }], accepted: { identifiers: [SERIAL], stockProductIds: [] } };

let client: QueryClient;
async function open(kind: 'serial' | 'barcode' = 'serial', mode: 'quick' | 'delivery' = 'quick') {
  holdPendingIntake(pendingFrom(SCOPE, kind === 'serial' ? { serial: SERIAL } : { productBarcode: '2000000000052' }));
  for (const k of Object.keys(params)) delete params[k];
  if (mode === 'quick') params.intake = 'quick';
  if (kind === 'barcode') params.barcode = '2000000000052';
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <NewProductScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function pickCategory(category: { key: string; name: string }) {
  await act(async () => fireEvent.press(screen.getAllByText(t('catalog.form.category.required'))[0]));
  const rows = screen.getAllByText(labelOf(category), { exact: false });
  await act(async () => fireEvent.press(rows[rows.length - 1]));
}

async function fillLaptop() {
  await pickCategory(LAPTOPS);
  await act(async () => fireEvent.changeText(screen.getByLabelText(t('catalog.form.brand')), 'Fictiva'));
  await act(async () => fireEvent.changeText(screen.getByLabelText(t('catalog.form.model')), 'QA Book 14'));
}

const cta = () => screen.getByText(t('receive.createAndAdd'));
const press = async (node: ReturnType<typeof screen.getByText>) => act(async () => fireEvent.press(node));
const catalogueCalls = () => get.mock.calls.filter(([url]) => String(url).startsWith('/device-catalogue/brands') || /\/device-catalogue\/brands\/.+\/models/.test(String(url)));

beforeEach(() => {
  jest.clearAllMocks();
  clearPendingIntake();
  guard.enabled = false;
  guard.cb = null;
  usePermissionStore.setState({ granted: new Set(['catalog.manage', 'cost.view']) as never, status: 'ready' } as never);
  useBranch.setState({ branchId: 'b1', branchName: 'Main' } as never);
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/categories')) return CATEGORIES;
    if (url.startsWith('/products')) return { rows: [], nextCursor: null };
    if (url.startsWith('/accounts') || url.startsWith('/money')) return [];
    return [];
  });
});

describe('the category comes first and decides the form', () => {
  it('before a category: no Brand, no Model, no catalogue request, and the action cannot proceed', async () => {
    await open();
    expect(screen.queryByLabelText(t('catalog.form.brand'))).toBeNull();
    expect(screen.queryByText(t('catalog.form.model'))).toBeNull();
    expect(screen.queryByText(t('catalog.form.storage'))).toBeNull();
    expect(catalogueCalls()).toHaveLength(0);
    await press(cta());
    expect(post).not.toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled();
  });

  it('a serial is never offered Phones: only categories it can go into are listed', async () => {
    await open();
    await act(async () => fireEvent.press(screen.getAllByText(t('catalog.form.category.required'))[0]));
    expect(screen.queryByText(labelOf(SMARTPHONES))).toBeNull();
    expect(screen.getAllByText(labelOf(LAPTOPS), { exact: false }).length).toBeGreaterThan(0);
  });

  it('Laptops: typed brand and model, never the phone catalogue — Apple is not an iPhone here', async () => {
    await open();
    await pickCategory(LAPTOPS);
    expect(screen.getByLabelText(t('catalog.form.brand'))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('catalog.form.brand')), 'Apple'));
    expect(catalogueCalls()).toHaveLength(0);
    expect(screen.queryByText(/iPhone/)).toBeNull();
    // The laptop's own attributes, and storage — no colour, which laptops do not ask.
    expect(screen.getByText(t('catalog.attr.processor'))).toBeTruthy();
    expect(screen.getByText(t('catalog.form.storage'))).toBeTruthy();
    expect(screen.queryByText(t('catalog.form.colour'))).toBeNull();
  });

  it('changing the category clears what belonged to the previous one', async () => {
    await open();
    await fillLaptop();
    await pickCategory(EARBUDS);
    expect(screen.getByLabelText(t('catalog.form.brand')).props.value).toBe('');
    expect(screen.getByLabelText(t('catalog.form.model')).props.value).toBe('');
    expect(screen.queryByText(t('catalog.attr.processor'))).toBeNull();
    expect(screen.queryByText(t('catalog.form.storage'))).toBeNull();
  });

  it('asks no selling price anywhere in the intake', async () => {
    await open();
    await fillLaptop();
    expect(screen.queryByText(/Selling price/i)).toBeNull();
    expect(screen.queryByText(/starting price/i)).toBeNull();
    expect(screen.getByText(t('cost.optional.label'))).toBeTruthy();
  });
});

describe('one action creates the product with its stock', () => {
  it('a missing cost is asked once; Continue sends ONE purchase, no cost and no price, and success follows the answer', async () => {
    choose.mockResolvedValueOnce(1);
    post.mockResolvedValueOnce(OK);
    await open();
    await fillLaptop();
    await press(cta());
    expect(choose).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/purchases');
    const item = body.items[0];
    expect(item).not.toHaveProperty('unitCost');
    expect(JSON.stringify(body)).not.toMatch(/"price"|defaultPrice/);
    expect(item.newProduct).toMatchObject({ brand: 'Fictiva', model: 'QA Book 14', categoryId: 'cat-laptops', trackingType: 'serial' });
    expect(item.units).toEqual([{ identifier: SERIAL }]);
    expect(screen.getAllByText(t('quick.receive.done.title')).length).toBeGreaterThan(0);
  });

  it('a typed cost is sent and nothing is asked', async () => {
    post.mockResolvedValueOnce(OK);
    await open();
    await fillLaptop();
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('cost.optional.label')), '25000'));
    await press(cta());
    expect(choose).not.toHaveBeenCalled();
    expect(post.mock.calls[0][1].items[0].unitCost).toBe(25000);
  });

  it('Add buying cost and Cancel send nothing and leave the completed form as it was', async () => {
    choose.mockResolvedValueOnce(0).mockResolvedValueOnce(null);
    await open();
    await fillLaptop();
    await press(cta());
    await press(cta());
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t('catalog.form.model')).props.value).toBe('QA Book 14');
    // Still usable: a third press asks again.
    choose.mockResolvedValueOnce(1);
    post.mockResolvedValueOnce(OK);
    await press(cta());
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('two rapid presses: one question, one purchase', async () => {
    let answer!: (v: number) => void;
    choose.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    post.mockResolvedValueOnce(OK);
    await open();
    await fillLaptop();
    await press(cta());
    await press(cta());
    await act(async () => answer(1));
    expect(choose).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a delayed answer: pressing again sends nothing more, and success comes only with the answer', async () => {
    let land!: (v: unknown) => void;
    post.mockImplementationOnce(() => new Promise((r) => (land = r)));
    await open();
    await fillLaptop();
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('cost.optional.label')), '100'));
    await press(cta());
    expect(screen.queryByText(t('quick.receive.done.body', { product: 'Fictiva QA Book 14', branch: 'Main' }))).toBeNull();
    await press(screen.getAllByText(t('receive.createAndAdd'))[0]);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => land(OK));
    expect(screen.getByText(t('quick.receive.done.body', { product: 'Fictiva QA Book 14', branch: 'Main' }))).toBeTruthy();
  });

  it('an invalid cost is refused in place and nothing is sent', async () => {
    await open();
    await fillLaptop();
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('cost.optional.label')), '0'));
    await press(cta());
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(t('cost.invalid'))).toBeTruthy();
  });

  it('a refusal by the server leaves the screen usable, and the next press tries again', async () => {
    post.mockRejectedValueOnce(new ApiError('That serial number is not valid', 400)).mockResolvedValueOnce(OK);
    await open();
    await fillLaptop();
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('cost.optional.label')), '100'));
    await press(cta());
    expect(screen.queryByText(t('quick.receive.done.title'))).toBeNull();
    await press(cta());
    expect(post).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(t('quick.receive.done.title')).length).toBeGreaterThan(0);
  });

  it('a timeout may have landed: the retry replays the SAME request key, and asks nothing again', async () => {
    choose.mockResolvedValueOnce(1);
    post.mockRejectedValueOnce(new ApiError('Gateway timeout', 504)).mockResolvedValueOnce(OK);
    await open();
    await fillLaptop();
    await press(cta());
    await press(screen.getByText(t('receive.uncertain.retry')));
    expect(choose).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1].clientUuid).toBe(post.mock.calls[0][1].clientUuid);
  });

  it('a product created meanwhile: nothing duplicated — the next press receives into it', async () => {
    post.mockRejectedValueOnce(new ApiError('exists', 409, 'product_exists')).mockResolvedValueOnce(OK);
    await open();
    await fillLaptop();
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('cost.optional.label')), '100'));
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/categories')) return CATEGORIES;
      if (url.startsWith('/products')) return { rows: [{ id: 'existing1', brand: 'Fictiva', model: 'QA Book 14', variant: null, barcode: null, trackingType: 'serial' }] };
      return [];
    });
    await press(cta());
    await press(screen.getByText(t('quick.receive.add')));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1].items[0]).toMatchObject({ productId: 'existing1' });
    expect(post.mock.calls[1][1].items[0]).not.toHaveProperty('newProduct');
  });

  it('a product barcode: a counted product, with How many', async () => {
    post.mockResolvedValueOnce({ ...OK, unitsCreated: 0, stockLines: 1 });
    await open('barcode');
    await pickCategory(EARBUDS);
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('catalog.form.brand')), 'Fictiva'));
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('catalog.form.model')), 'QA Buds'));
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('intake.stock.quantity')), '10'));
    await act(async () => fireEvent.changeText(screen.getByLabelText(t('cost.optional.label')), '450'));
    await press(cta());
    expect(post.mock.calls[0][1].items[0]).toMatchObject({ quantity: 10, unitCost: 450, newProduct: { trackingType: 'quantity', barcode: '2000000000052' } });
  });
});

describe('leaving never freezes', () => {
  it('the delivery hand-back says "Add to delivery" and passes its own guard without a dialog', async () => {
    await open('serial', 'delivery');
    await fillLaptop();
    expect(guard.enabled).toBe(true);
    await press(screen.getByText(t('catalog.intake.next')));
    // The screen left on purpose: the guard lets the navigation through at once.
    guard.cb?.({ data: { action: { type: 'GO_BACK' } } });
    expect(navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('leaving an unfinished form asks once — a second back press cannot stack a second dialog', async () => {
    let decide!: (v: boolean) => void;
    (dialog.confirm as jest.Mock).mockImplementationOnce(() => new Promise((r) => (decide = r)));
    await open();
    await fillLaptop();
    guard.cb?.({ data: { action: { type: 'GO_BACK' } } });
    guard.cb?.({ data: { action: { type: 'GO_BACK' } } });
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    await act(async () => decide(false));
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });
});
