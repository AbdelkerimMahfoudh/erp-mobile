import { API_V1_URL, TOKEN_KEYS } from '../constants/config';
import { getItem, setItem, deleteItem } from './storage';
import { getActiveBranchId } from './branch';
import { useConnectivity } from './connectivity';
import { REQUEST_TIMEOUT_MS, RequestTimeout } from './offline/classify.ts';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Body = unknown;

/** Non-2xx responses throw. Backend errors are `{ error, message, code? }`. */
export class ApiError extends Error {
  status: number;
  /** Machine-readable code when the server sends one, e.g. `device_unrecognized`. */
  code?: string;
  /**
   * The parsed error payload, when there was one.
   *
   * Some refusals are structured rather than a sentence: a transfer create
   * answers `{ problems: [{ identifier, reason }] }`, which is the difference
   * between "some units cannot be transferred" and knowing which phone to go
   * and look at. It used to be parsed and thrown away.
   */
  body?: unknown;
  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// Single-flight refresh: parallel 401s trigger one /auth/refresh, not many.
let refreshInFlight: Promise<string | null> | null = null;

export async function clearSession(): Promise<void> {
  await deleteItem(TOKEN_KEYS.ACCESS_TOKEN);
  await deleteItem(TOKEN_KEYS.REFRESH_TOKEN);
  await deleteItem(TOKEN_KEYS.USER);
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await getItem(TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${API_V1_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        await clearSession();
        return null;
      }
      const data = await res.json();
      // Backend ROTATES the refresh token — persist BOTH or the next refresh fails.
      if (data?.accessToken) await setItem(TOKEN_KEYS.ACCESS_TOKEN, data.accessToken);
      if (data?.refreshToken) await setItem(TOKEN_KEYS.REFRESH_TOKEN, data.refreshToken);
      return data?.accessToken ?? null;
    } catch {
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function send(method: Method, path: string, body: Body, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const branchId = getActiveBranchId();
  if (branchId) headers['X-Branch-Id'] = branchId;

  /**
   * A bound on how long anything may hang (Milestone J).
   *
   * `fetch` has no default timeout, so before this a request on a dying
   * connection could wait indefinitely — and "the server did not answer" was
   * not a state the app could distinguish from "the server said no". The queue
   * needs that distinction: a timeout is retried with the same client UUID
   * because the request may already have been processed.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_V1_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    // An abort is ours, and means the outcome is unknown rather than failed.
    if (controller.signal.aborted) throw new RequestTimeout();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

async function request<T>(method: Method, path: string, body?: Body): Promise<T> {
  const token = await getItem(TOKEN_KEYS.ACCESS_TOKEN);

  let res: Response;
  try {
    res = await send(method, path, body, token);
  } catch (error) {
    /**
     * `fetch` only rejects when the server could not be reached at all — a 500
     * still resolves. That makes this the one honest place to learn the shop's
     * internet is down, rather than guessing from a radio flag.
     *
     * A TIMEOUT is excluded deliberately: the request reached the server and
     * only the answer was lost, so marking the shop offline would be wrong and
     * would hide a server that is merely slow.
     *
     * The error is rethrown untouched: this observes, it does not swallow.
     */
    if (!(error instanceof RequestTimeout)) useConnectivity.getState().markUnreachable();
    throw error;
  }

  // A response arrived, so the server is reachable — even a 4xx proves that.
  useConnectivity.getState().markReachable();

  if (res.status === 401 && token) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(method, path, body, fresh);
  }

  if (!res.ok) {
    const payload = await parse<any>(res).catch(() => null);
    const message = payload?.message || payload?.error || `Request failed (${res.status})`;
    throw new ApiError(
      Array.isArray(message) ? message.join(', ') : message,
      res.status,
      typeof payload?.code === 'string' ? payload.code : undefined,
      payload,
    );
  }

  return parse<T>(res);
}

/** A file the server generated, plus the name it gave it. */
export interface DownloadedFile {
  text: string;
  filename: string;
  /** Rows in the report, from the server, so the app never counts lines itself. */
  rows: number | null;
}

/**
 * Fetch a file rather than JSON.
 *
 * Goes through the same `send` as everything else — the same token, the same
 * `X-Branch-Id`, the same timeout, the same connectivity marking, the same
 * refresh-once-on-401. A separate `fetch` here would be a second client that
 * drifts: it would miss a branch switch, or hold a token past a refresh, and
 * the symptom would be a report from the wrong branch, which is worse than an
 * error.
 *
 * The response is NOT parsed as JSON. An error still is, because the server
 * answers a refusal with the project's ordinary error shape — a CSV containing
 * an error message is a file a spreadsheet opens happily and a person misreads
 * as data.
 */
async function download(path: string): Promise<DownloadedFile> {
  const token = await getItem(TOKEN_KEYS.ACCESS_TOKEN);

  let res: Response;
  try {
    res = await send('GET', path, undefined, token);
  } catch (error) {
    if (!(error instanceof RequestTimeout)) useConnectivity.getState().markUnreachable();
    throw error;
  }
  useConnectivity.getState().markReachable();

  if (res.status === 401 && token) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send('GET', path, undefined, fresh);
  }

  if (!res.ok) {
    const payload = await parse<any>(res).catch(() => null);
    const message = payload?.message || payload?.error || `Request failed (${res.status})`;
    throw new ApiError(
      Array.isArray(message) ? message.join(', ') : message,
      res.status,
      typeof payload?.code === 'string' ? payload.code : undefined,
      payload,
    );
  }

  const text = await res.text();

  /*
   * Validate before anything is written to disk or handed to a share sheet.
   * A 200 with an HTML captive-portal page is a real thing on shop wifi, and
   * saving it as `profit-by-product.csv` would hand somebody a file that opens
   * as gibberish and looks like our bug.
   */
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/csv')) {
    throw new ApiError('The server did not return a report.', res.status);
  }

  return {
    text,
    filename: filenameFrom(res.headers.get('content-disposition')) ?? 'report.csv',
    rows: Number(res.headers.get('x-report-rows') ?? '') || null,
  };
}

/**
 * The server's filename, or nothing.
 *
 * Only a plain ASCII `filename="…"` is accepted, and anything with a path
 * separator is rejected: the value decides what gets written to disk, and a
 * name the client did not sanity-check is a name that can escape the directory
 * it was meant for.
 */
function filenameFrom(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  const name = match?.[1];
  if (!name || /[/\\]/.test(name) || !/^[\x20-\x7e]+$/.test(name)) return null;
  return name;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  download,
  post: <T = unknown>(path: string, body?: Body) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: Body) => request<T>('PUT', path, body),
  patch: <T = unknown>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T = unknown>(path: string, body?: Body) => request<T>('DELETE', path, body),
};
