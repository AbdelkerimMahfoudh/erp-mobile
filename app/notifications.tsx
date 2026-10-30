import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCheck } from 'lucide-react-native';
import { Button, Chip, EmptyState, ErrorState, ListRow, Screen, SegmentedControl, SkeletonList, Text } from '../components/ui';
import { api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { formatDate, formatDateTime, formatMoney, formatSmartDateTime } from '../lib/format';
import { notificationCopy, type Translate } from '../lib/notification-copy';
import { haptics } from '../lib/haptics';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import type {
  AppNotification,
  NotificationFilter,
  NotificationPage,
  NotificationPreference,
  TransferEvent,
} from '../types/api';
import { makeStyles } from '../lib/design/theme';

/**
 * In-app notifications — the notification centre (D225).
 *
 * Every event the person may see, whatever their push level, filtered by kind
 * (All · Approvals · Sales · Stock · Money). Each is rendered in the language
 * the app is set to NOW, from the structured event: a title and a body for
 * every catalogued type, with the store and the people in the reader's script;
 * the server's stored English is never shown. Read state is
 * the person's own and follows them to every device. Tapping lands on the
 * exact record; a record since removed, or no longer theirs to open, says so
 * on its own screen.
 *
 * Everything shown comes from the row the server stored. Nothing is recomputed
 * here, so a `price.changed` message says exactly what the Owner was told at the
 * moment it happened — and, by CP3's design, carries no cost or margin.
 */
export default function NotificationsScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<NotificationFilter>('all');
  const page = useInfiniteQuery({
    queryKey: [...qk.notifications, filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('filter', filter);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return api.get<NotificationPage>(`/notifications${qs ? `?${qs}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const preference = useQuery({ queryKey: qk.notificationPreference, queryFn: () => api.get<NotificationPreference>('/notifications/preferences') });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });

  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];

  const open = (n: AppNotification) => {
    void haptics.tap();
    // The server decides, now, where it leads and whether this person may open it (D225): the opening screen asks.
    if (n.actionLink) return router.push({ pathname: '/notification-open', params: { id: n.id } });
    if (!n.isRead) markRead.mutate(n.id);
  };

  return (
    <Screen padded={false} scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('notifications.title') }} />
      <View style={styles.top}>
        {/* The person's push level, one tap from the centre: what reaches the phone, never what may be seen. */}
        <ListRow
          leading={BellRing}
          title={t('notifications.level.title')}
          subtitle={preference.data ? t(`notifications.level.${preference.data.level}` as const) : undefined}
          onPress={() => router.push('/notification-settings' as never)}
        />
        <SegmentedControl
          size="sm"
          value={filter}
          onChange={(v) => setFilter(v)}
          options={(['all', 'approvals', 'sales', 'stock', 'money'] as const).map((f) => ({ value: f, label: t(`notifications.filter.${f}` as const) }))}
        />
        {(page.data?.pages[0]?.unreadCount ?? 0) > 0 ? (
          <Button title={t('notifications.readAll')} icon={CheckCheck} variant="tertiary" size="sm" onPress={() => markAll.mutate()} loading={markAll.isPending} />
        ) : null}
      </View>

      {page.isLoading ? (
        <SkeletonList count={6} />
      ) : page.isError ? (
        <ErrorState error={page.error} onRetry={() => void page.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <EmptyState title={t('notifications.empty')} body={t('notifications.emptyBody')} />
          }
          renderItem={({ item }) => <Row row={item} onPress={() => open(item)} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
          }}
        />
      )}
    </Screen>
  );
}

/** The formatters the composer words amounts and dates with: the app's own, in the reader's language. */
const FORMAT = { money: formatMoney, date: formatDate, dateTime: (v: string) => formatDateTime(v) };

/** Transfer types the type chip names. */
const TRANSFER_EVENTS = new Set<TransferEvent>(['requested', 'created_approved', 'approved', 'rejected', 'shipped', 'received', 'cancelled']);

function Row({ row, onPress }: { row: AppNotification; onPress: () => void }) {
  const styles = useStyles();
  const { t, language } = useTranslation();
  // Every event in the reader's language, from its fields: title, body and store (D225, `lib/notification-copy.ts`).
  const { title, body, store } = notificationCopy(
    { type: row.type, payload: row.payload as Record<string, unknown> | null, branch: row.branch ?? null },
    t as Translate,
    language,
    FORMAT,
  );

  /**
   * Known types get shop language; anything else falls back to the server's own
   * title rather than showing a raw key. A new backend notification type must
   * never render as `notification.some.type` on a shop counter.
   */
  const typeKey = row.type.startsWith('discount_approval.')
    ? 'notifications.type.discountApproval'
    : `notifications.type.${row.type}`;
  const typeLabel =
    row.type.startsWith('discount_approval.') ||
    row.type === 'price.changed' ||
    row.type === 'transfer.incoming' ||
    row.type === 'transfer.received' ||
    (row.type.startsWith('transfer.') && TRANSFER_EVENTS.has(row.type.slice('transfer.'.length) as TransferEvent))
      ? t(typeKey as never)
      : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /*
       * The wash says "unread" to somebody looking. This says it to somebody
       * listening — and the chip below says it in words, so the state survives
       * a screen reader, colour blindness and a monochrome screenshot alike.
       */
      accessibilityLabel={row.isRead ? title : `${t('notifications.unread')}. ${title}`}
      style={[styles.row, !row.isRead ? styles.rowUnread : null]}
    >
      <View style={styles.head}>
        <View style={styles.chips}>
          {typeLabel ? <Chip label={typeLabel} tone="info" size="sm" /> : null}
          {/* Unread is words plus tone, never a bare coloured dot. */}
          {!row.isRead ? <Chip label={t('notifications.unread')} tone="info" size="sm" /> : null}
        </View>
        <Text variant="caption" tone="tertiary" style={styles.time}>
          {formatSmartDateTime(row.createdAt)}
        </Text>
      </View>

      <Text variant="bodyStrong" style={styles.title}>
        {title}
      </Text>
      <Text variant="caption" tone="secondary" style={styles.body} numberOfLines={3}>
        {store ? `${store} · ${body}` : body}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingBottom: space['2xl'] },
  top: { gap: space.sm, paddingHorizontal: space.base, paddingVertical: space.sm },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.semantic.divider,
  },
  row: {
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    gap: space.xs,
    backgroundColor: colors.semantic.surface,
  },
  /** The pale indigo selection wash, reused as "not read yet". */
  rowUnread: {
    backgroundColor: colors.semantic.primarySoft,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  // On a narrow phone with large text the chips wrap among themselves, never under the time (as Transfers).
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, flexShrink: 1 },
  time: { flexShrink: 0 },
  title: { marginTop: space.sm },
  body: { marginTop: space.xs },
}));
