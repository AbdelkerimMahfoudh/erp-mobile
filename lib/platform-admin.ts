import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { API_V1_URL } from '../constants/config';
import { REQUEST_TIMEOUT_MS } from './offline/classify';

/**
 * The platform administrator's client — a SEPARATE identity, never a shop's.
 *
 * Nothing here touches the tenant session: no access token from storage, no
 * `X-Branch-Id`, no company id in any request. The credential is the platform
 * session the server issued at sign-in — an HttpOnly cookie, which the native
 * cookie jar carries on its own; outside production the server also answers
 * with the token itself, kept in memory only and sent as a bearer so the web
 * export and the verification harness can drive the API without a cookie
 * jar. In production that header is ignored by the server.
 *
 * The session lives in memory and dies with the process. An internal tool
 * that reaches every business on the platform is signed into again, not
 * remembered.
 */

export type PlatformState =
  | 'pending'
  | 'active'
  | 'grace'
  | 'expired'
  | 'complimentary'
  | 'suspended'
  | 'cancelled'
  | 'rejected';

export const PLATFORM_STATES: readonly PlatformState[] = [
  'pending',
  'active',
  'grace',
  'expired',
  'complimentary',
  'suspended',
  'cancelled',
  'rejected',
];

export interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
}

export interface PlatformSession {
  admin: PlatformAdmin;
  expiresAt: string;
  /** Present outside production only. Never persisted. */
  sessionToken: string | null;
}

interface SessionStore {
  session: PlatformSession | null;
  start: (session: PlatformSession) => void;
  end: () => void;
}

export const usePlatformSession = create<SessionStore>((set) => ({
  session: null,
  start: (session) => set({ session }),
  end: () => set({ session: null }),
}));

export class PlatformApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.code = code;
  }
}

type Method = 'GET' | 'POST';

async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const token = usePlatformSession.getState().session?.sessionToken;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_V1_URL}/platform/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: { message?: string; code?: string } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  // A session the server no longer accepts is over here too.
  if (res.status === 401) usePlatformSession.getState().end();
  if (!res.ok) throw new PlatformApiError(json?.message ?? `HTTP ${res.status}`, res.status, json?.code);
  return json as T;
}

// ── What the platform answers with ─────────────────────────────────────────

export interface PlatformDashboard {
  byState: Record<PlatformState, number>;
  businesses: number;
  branches: number;
  activeUsers: number;
  calculatedAt: string;
}

export interface PlatformBusinessRow {
  id: string;
  name: string;
  publicStoreId: string;
  city: string | null;
  createdAt: string;
  branches: number;
  users: number;
  state: PlatformState;
  status: string;
  periodEnd: string | null;
  version: number;
}

export interface PlatformBusinessPage {
  rows: PlatformBusinessRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformEntitlement {
  state: PlatformState;
  periodEnd: string | null;
  graceEnd: string | null;
  daysRemaining: number | null;
  graceHoursRemaining: number;
  subscribedBranchCount: number;
  activeBranchCount: number;
  seatsUsed: number;
  seatLimit: number;
  status: string;
}

export interface PlatformEvent {
  id: string;
  kind: string;
  note: string | null;
  actor: string | null;
  periodEndAfter: string | null;
  createdAt: string;
}

export interface PlatformPayment {
  id: string;
  amount: string;
  currency: string;
  channel: string;
  reference: string | null;
  note: string | null;
  paidAt: string;
  recordedBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  providerVerified: false;
}

export interface PlatformBusinessDetail {
  id: string;
  name: string;
  publicStoreId: string;
  city: string | null;
  createdAt: string;
  branches: { id: string; name: string; type: string }[];
  people: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    isActive: boolean;
    lastLoginAt: string | null;
  }[];
  entitlement: PlatformEntitlement | null;
  version: number;
  events: PlatformEvent[];
  payments: PlatformPayment[];
}

export interface PlatformAuditRow {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetLabel: string | null;
  reason: string | null;
  createdAt: string;
}

export interface TransitionResult {
  applied: boolean;
  version: number;
  status: string;
  periodEnd?: string | null;
}

export interface OwnerInvitation {
  token: string;
  expiresAt: string;
  delivery: 'manual';
  owner: { name: string; destinationMasked: string | null };
  replaced?: number;
}

/** Every mutation re-asks the administrator's password; the server insists. */
interface StepUp {
  confirmPassword: string;
  expectedVersion?: number;
}

export const platformApi = {
  signIn: (email: string, password: string) =>
    call<{ admin: PlatformAdmin; expiresAt: string; sessionToken?: string }>('POST', 'admin/sign-in', { email, password }),
  signOut: () => call<void>('POST', 'admin/sign-out'),
  dashboard: () => call<PlatformDashboard>('GET', 'dashboard'),
  businesses: (q: string, state: PlatformState | null, page: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (state) params.set('state', state);
    params.set('page', String(page));
    return call<PlatformBusinessPage>('GET', `businesses?${params.toString()}`);
  },
  business: (id: string) => call<PlatformBusinessDetail>('GET', `businesses/${encodeURIComponent(id)}`),
  approve: (id: string, body: StepUp & { months: number; reason?: string }) =>
    call<TransitionResult>('POST', `businesses/${encodeURIComponent(id)}/approve`, body),
  reject: (id: string, body: StepUp & { reason: string }) =>
    call<TransitionResult>('POST', `businesses/${encodeURIComponent(id)}/reject`, body),
  extend: (id: string, body: StepUp & { months: number; reason?: string }) =>
    call<TransitionResult>('POST', `businesses/${encodeURIComponent(id)}/extend`, body),
  setPeriod: (id: string, body: StepUp & { periodEnd: string; reason: string }) =>
    call<TransitionResult>('POST', `businesses/${encodeURIComponent(id)}/period`, body),
  suspend: (id: string, body: StepUp & { reason: string }) =>
    call<TransitionResult>('POST', `businesses/${encodeURIComponent(id)}/suspend`, body),
  reinstate: (id: string, body: StepUp & { reason: string }) =>
    call<TransitionResult>('POST', `businesses/${encodeURIComponent(id)}/reinstate`, body),
  cancel: (id: string, body: StepUp & { reason: string }) =>
    call<TransitionResult>('POST', `businesses/${encodeURIComponent(id)}/cancel`, body),
  ownerInvitation: (id: string, body: StepUp & { reason?: string }) =>
    call<OwnerInvitation>('POST', `businesses/${encodeURIComponent(id)}/owner-invitation`, body),
  createBusiness: (body: {
    idempotencyKey: string;
    businessName: string;
    branchName?: string;
    ownerName: string;
    email?: string;
    phone?: string;
    city?: string;
    language: 'en' | 'fr' | 'ar';
    reason: string;
    confirmPassword: string;
  }) =>
    call<{ companyId: string; publicStoreId: string; status: string; created: boolean; invitation: OwnerInvitation | null }>(
      'POST',
      'businesses',
      body,
    ),
  audit: (page: number) => call<PlatformAuditRow[]>('GET', `audit?page=${page}`),
};

// ── Hooks ──────────────────────────────────────────────────────────────────

/** Its own key space, so a shop's cache and the platform's never meet. */
export const platformKeys = {
  all: ['platform'] as const,
  dashboard: () => ['platform', 'dashboard'] as const,
  businesses: (q: string, state: PlatformState | null, page: number) => ['platform', 'businesses', q, state, page] as const,
  business: (id: string) => ['platform', 'business', id] as const,
  audit: (page: number) => ['platform', 'audit', page] as const,
};

/** Redirects to the platform sign-in when there is no platform session. */
export function usePlatformGuard(): PlatformSession | null {
  const session = usePlatformSession((s) => s.session);
  const router = useRouter();
  useEffect(() => {
    if (!session) router.replace('/platform/sign-in' as never);
  }, [session, router]);
  return session;
}

export function usePlatformDashboard() {
  const session = usePlatformSession((s) => s.session);
  return useQuery({ queryKey: platformKeys.dashboard(), queryFn: platformApi.dashboard, enabled: !!session });
}

export function usePlatformBusinesses(q: string, state: PlatformState | null, page: number) {
  const session = usePlatformSession((s) => s.session);
  return useQuery({
    queryKey: platformKeys.businesses(q, state, page),
    queryFn: () => platformApi.businesses(q, state, page),
    enabled: !!session,
  });
}

export function usePlatformBusiness(id: string | undefined) {
  const session = usePlatformSession((s) => s.session);
  return useQuery({
    queryKey: platformKeys.business(id ?? ''),
    queryFn: () => platformApi.business(id!),
    enabled: !!session && !!id,
  });
}

/** Signing out clears the server session, the memory, and every cached platform answer. */
export function usePlatformSignOut() {
  const qc = useQueryClient();
  const end = usePlatformSession((s) => s.end);
  return useMutation({
    mutationFn: async () => {
      try {
        await platformApi.signOut();
      } finally {
        end();
        qc.removeQueries({ queryKey: platformKeys.all });
      }
    },
  });
}
