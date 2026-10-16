/// <reference types="jest" />
/**
 * What the API client makes of an answer that does not come whole: the real client, `fetch` and storage mocked.
 *
 * The status of a success arrived and its body did not — cut off on its way, or still not in when the request's
 * bound runs out. The server did what was asked and what it answered is lost, so the client says the answer was lost
 * (`RequestTimeout`, `timeout_uncertain`), never a refusal and never "no connection": a registration confirmed this
 * way is finished, and the same code refused next must not be called wrong (C14). A refusal whose body is lost keeps
 * its status, as when its body is not JSON.
 */
import { answerLost, classifyError, REQUEST_TIMEOUT_MS, RequestTimeout } from '../lib/offline/classify';

jest.mock('../lib/storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

import { api, ApiError } from '../lib/api-client';

/** A response whose status line arrived; its body is whatever `body` makes of the request's signal. */
function respond(status: number, body: (signal: AbortSignal) => Promise<string>) {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (_url: string, init: { signal: AbortSignal }) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: () => body(init.signal),
  }));
}
const cutOff = () => Promise.reject(new TypeError('network error'));
/** A body that never comes: it fails only when the request is aborted, as a browser's does. */
const neverComes = (signal: AbortSignal) =>
  new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

const realFetch = globalThis.fetch;
afterEach(() => {
  jest.useRealTimers();
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('an answer that does not come whole', () => {
  it('a success whose body is cut off on its way is an answer lost — never a refusal, never "no connection"', async () => {
    respond(200, cutOff);
    const error = await api.post('/auth/register/verify/confirm', { code: '123456' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestTimeout);
    expect(classifyError(error).kind).toBe('timeout_uncertain');
    expect(answerLost(error)).toBe(true);
  });

  it('a success whose body never comes is an answer lost once the request’s bound runs out', async () => {
    jest.useFakeTimers();
    respond(200, neverComes);
    const pending = api.post('/auth/register/verify/confirm', { code: '123456' }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    expect(await pending).toBeInstanceOf(RequestTimeout);
  });

  it('a refusal whose body is cut off keeps its status: a 400 is still a refusal, a 500 still an error', async () => {
    for (const status of [400, 500]) {
      respond(status, cutOff);
      const error = await api.post('/auth/register/verify/confirm', { code: '123456' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as InstanceType<typeof ApiError>).status).toBe(status);
      expect(answerLost(error)).toBe(false);
    }
  });

  it('a whole answer reads as before: JSON as JSON, nothing as nothing, a refusal with its sentence and code', async () => {
    respond(200, async () => JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }));
    await expect(api.post('/auth/register/verify/confirm', {})).resolves.toEqual({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    respond(204, async () => '');
    await expect(api.post('/auth/register/verify/start', {})).resolves.toBeUndefined();
    respond(409, async () => JSON.stringify({ message: 'That IMEI has already been sold', code: 'already_sold' }));
    const error = (await api.post('/sales', {}).catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
    expect([error.status, error.code, error.message]).toEqual([409, 'already_sold', 'That IMEI has already been sold']);
  });
});
