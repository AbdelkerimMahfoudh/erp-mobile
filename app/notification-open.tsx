import React, { useEffect, useRef } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, ShieldOff } from 'lucide-react-native';
import { EmptyState, ErrorState, Screen, SkeletonList } from '../components/ui';
import { api } from '../lib/api-client';
import { useBranch } from '../lib/branch';
import { useTranslation } from '../lib/i18n';
import { notificationRoute, type NotificationOpen } from '../lib/navigation/notification-route';
import { qk } from '../lib/query-keys';
import { useAuth } from '../hooks/useAuth';
import type { UserBranch } from '../types/api';

/**
 * Opening a notification (D225) — from the centre, or a push tapped with the app in the foreground, in the
 * background or closed. The server decides now, not when it happened: whether it is still the person's, whether the
 * record exists, and whether they may open it today. Then this screen gives way to the record — in the record's own
 * store, switched to first — or says plainly why it cannot, with the way back to the notifications. Nothing of the
 * record is shown here, so a refusal reveals nothing.
 */
export default function NotificationOpenScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const activeBranch = useBranch((s) => s.branchId);
  const setBranch = useBranch((s) => s.setBranch);
  const left = useRef(false);

  const open = useQuery({
    queryKey: ['notification-open', id],
    queryFn: () => api.get<NotificationOpen>(`/notifications/${encodeURIComponent(id ?? '')}/open`),
    enabled: typeof id === 'string' && id.length > 0,
    // Asked once per opening: a second answer must not navigate a second time.
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
  });

  useEffect(() => {
    const answer = open.data;
    if (!answer || answer.status !== 'ok' || left.current) return;
    const route = notificationRoute(answer.target, user?.id ?? null);
    if (!route) return;
    left.current = true;
    // Read, once the person has actually opened it.
    if (id) void api.post(`/notifications/${encodeURIComponent(id)}/read`).then(() => queryClient.invalidateQueries({ queryKey: qk.notifications })).catch(() => undefined);
    const go = async () => {
      // The record belongs to one of the person's stores: open it there, as the screen reads the active store.
      if (answer.branchId && answer.branchId !== activeBranch) {
        const mine = await queryClient.fetchQuery({ queryKey: qk.branches, queryFn: () => api.get<UserBranch[]>('/auth/branches') }).catch(() => [] as UserBranch[]);
        const store = mine.find((b) => b.id === answer.branchId);
        if (store) setBranch(store);
      }
      router.replace(route);
    };
    void go();
  }, [open.data, user?.id, id, activeBranch, setBranch, queryClient, router]);

  const header = <Stack.Screen options={{ headerShown: true, title: t('notifications.title') }} />;
  const toCentre = { label: t('notifications.open.back'), onPress: () => router.replace('/notifications') };
  const answer = open.data;

  if (!id || answer?.status === 'unavailable' || answer?.status === 'no_destination' || (answer?.status === 'ok' && !notificationRoute(answer.target, user?.id ?? null))) {
    return (
      <Screen>
        {header}
        <EmptyState icon={BellOff} title={t('notifications.open.unavailable')} body={t('notifications.open.unavailableBody')} action={toCentre} />
      </Screen>
    );
  }
  if (answer?.status === 'unauthorized') {
    return (
      <Screen>
        {header}
        <EmptyState icon={ShieldOff} title={t('notifications.open.unauthorized')} body={t('notifications.open.unauthorizedBody')} action={toCentre} />
      </Screen>
    );
  }
  if (open.isError) {
    return (
      <Screen>
        {header}
        <ErrorState error={open.error} onRetry={() => void open.refetch()} />
      </Screen>
    );
  }
  return (
    <Screen>
      {header}
      <SkeletonList count={3} />
    </Screen>
  );
}
