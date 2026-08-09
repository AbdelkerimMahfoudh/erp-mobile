import { API_V1_URL, TOKEN_KEYS } from '../constants/config';
import { getItem, setItem, deleteItem } from './storage';
import { getActiveBranchId } from './branch';

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

  return fetch(`${API_V1_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  let res = await send(method, path, body, token);

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

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: Body) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: Body) => request<T>('PUT', path, body),
  patch: <T = unknown>(path: string, body?: Body) => request<T>('PATCH', path, body),
  delete: <T = unknown>(path: string, body?: Body) => request<T>('DELETE', path, body),
};
