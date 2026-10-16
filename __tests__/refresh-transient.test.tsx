/// <reference types="jest" />
/**
 * A token refresh that meets a rate limit or a server error keeps the session (review MO2-03, 2026-10-16).
 *
 * The access token expires every fifteen minutes and is renewed with the refresh token. Any answer but a success used
 * to delete both tokens, so a 429 or a 503 at that moment signed the person out. Only the server refusing the refresh
 * token (400/401/403) ends the session now. The real client; `fetch` and storage mocked.
 */
const mockStore = new Map<string, string>();
jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

import { api, ApiError } from '../lib/api-client';

/** Every request answers 401 (the access token expired); the refresh answers `refreshStatus`. */
function server(refreshStatus: number) {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    const status = url.endsWith('/auth/refresh') ? refreshStatus : 401;
    return { status, ok: false, headers: { get: () => null }, text: async () => JSON.stringify({ message: 'no' }), json: async () => ({}) };
  });
}

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  mockStore.clear();
  mockStore.set('erp.accessToken', 'expired');
  mockStore.set('erp.refreshToken', 'refresh');
  mockStore.set('erp.user', '{"id":"u1"}');
});

it.each([429, 500, 503])('a refresh answered %i keeps both tokens, and the request fails unconfirmed, not 401', async (status) => {
  server(status);
  const error = (await api.get('/inventory').catch((e: unknown) => e)) as ApiError;
  expect(error).toBeInstanceOf(ApiError);
  // A 401 here is what the launch check treats as "the session is over" (review NW2-03).
  expect(error.status).toBe(503);
  expect(error.code).toBe('session_unconfirmed');
  expect(mockStore.get('erp.accessToken')).toBe('expired');
  expect(mockStore.get('erp.refreshToken')).toBe('refresh');
});

it('a refresh that cannot reach the server keeps the session and fails unconfirmed', async () => {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/auth/refresh')) throw new TypeError('Network request failed');
    return { status: 401, ok: false, headers: { get: () => null }, text: async () => '{}', json: async () => ({}) };
  });
  const error = (await api.get('/inventory').catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(503);
  expect(mockStore.get('erp.refreshToken')).toBe('refresh');
});

it.each([400, 401, 403])('a refresh refused with %i still ends the session', async (status) => {
  server(status);
  const error = (await api.get('/inventory').catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(401);
  expect(mockStore.has('erp.accessToken')).toBe(false);
  expect(mockStore.has('erp.refreshToken')).toBe(false);
});
