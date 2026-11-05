import { useEffect } from 'react';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { createNotificationOpener, type OpenFailure } from '../../lib/navigation/open-notification';
import { notificationRoute, type NotificationOpen, type NotificationTarget } from '../../lib/navigation/notification-route';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import { useAuth } from '../../hooks/useAuth';
import type { UserBranch } from '../../types/api';

/** What the person is told when a notification cannot be opened, on the notifications. */
const REASON: Record<OpenFailure, TranslationKey> = {
  unavailable: 'notifications.open.unavailableBody',
  unauthorized: 'notifications.open.unauthorizedBody',
  failed: 'notifications.open.failed',
};

/** The latest of what the opener needs from React: refreshed on every render of a screen that opens notifications. */
const live: {
  /** Open the record's screen, or the notifications: `router.push`, called inside the hook's own closures. */
  toRecord: ((target: NotificationTarget) => void) | null;
  toCentre: (() => void) | null;
  queryClient: QueryClient | null;
  me: string | null;
  pathname: string;
  t: ((key: TranslationKey) => string) | null;
} = { toRecord: null, toCentre: null, queryClient: null, me: null, pathname: '', t: null };

/**
 * One opener for the whole app — the centre's rows and tapped pushes alike — so its lock holds across both: a push
 * tapped while a row is opening, or a row tapped twice, opens one record once (`lib/navigation/open-notification.ts`).
 */
const open = createNotificationOpener({
  ask: (id) => api.get<NotificationOpen>(`/notifications/${encodeURIComponent(id)}/open`),
  // Async, so nothing it does can throw into the navigation; the opener ignores its failure.
  markRead: async (id) => {
    await api.post(`/notifications/${encodeURIComponent(id)}/read`);
    await live.queryClient?.invalidateQueries({ queryKey: qk.notifications });
  },
  activeBranch: () => useBranch.getState().branchId,
  switchBranch: async (branchId) => {
    const qc = live.queryClient;
    if (!qc) return false;
    const mine = await qc.fetchQuery({ queryKey: qk.branches, queryFn: () => api.get<UserBranch[]>('/auth/branches') }).catch(() => [] as UserBranch[]);
    const store = mine.find((b) => b.id === branchId);
    if (!store) return false;
    useBranch.getState().setBranch(store);
    return true;
  },
  me: () => live.me,
  push: (target) => live.toRecord?.(target),
  fallback: (reason) => {
    // Already on the notifications (a row was tapped): stay; otherwise (a push) show them — then say why.
    if (live.pathname !== '/notifications') live.toCentre?.();
    const t = live.t;
    if (t) toast.error(t(REASON[reason]));
  },
});

/** Open a notification by id: straight to its record, or the notifications with the reason it cannot be opened. */
export function useOpenNotification(): (id: string) => Promise<unknown> {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { user } = useAuth();
  const { t } = useTranslation();
  // Kept current after every render (an effect, not during render): the opener reads it when a tap resolves.
  useEffect(() => {
    live.toRecord = (target) => {
      // The record's own screen, from the registry of the app's paths: a kind it does not know opens nothing.
      const route = notificationRoute(target, user?.id ?? null);
      if (route) router.push(route as Href);
    };
    live.toCentre = () => router.push('/notifications');
    live.queryClient = queryClient;
    live.pathname = pathname;
    live.me = user?.id ?? null;
    live.t = (key) => t(key);
  });
  return open;
}
