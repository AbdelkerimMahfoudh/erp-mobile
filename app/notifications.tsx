import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCheck } from 'lucide-react-native';
import { Button, Chip, EmptyState, ErrorState, ListRow, Screen, SegmentedControl, SkeletonList, Text } from '../components/ui';
import { api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { formatMoney, formatSmartDateTime } from '../lib/format';
import { haptics } from '../lib/haptics';
import { hasKey, useTranslation } from '../lib/i18n';
import { internalRoute } from '../lib/navigation/internal-route';
import { qk } from '../lib/query-keys';
import type {
  AppNotification,
  DiscountApprovalNotificationPayload,
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
 * the app is set to NOW, from the structured event: a title for every known
 * type, the server's English text only for an English reader. Read state is
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
    if (!n.isRead) markRead.mutate(n.id);
    // The server decides where a notification points, among the app's own screens: any other address opens nothing.
    const route = internalRoute(n.actionLink);
    if (route) router.push(route as never);
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

/** Transfer types whose wording the app can compose itself, in either language. */
const TRANSFER_EVENTS = new Set<TransferEvent>([
  'requested',
  'created_approved',
  'approved',
  'rejected',
  'shipped',
  'received',
  'cancelled',
]);

/**
 * Say it in the reader's language, when the server gave us the fields.
 *
 * `title`/`body` are English text written at the moment it happened. For
 * transfers the server also stores the FIELDS, so the sentence can be rebuilt
 * in Arabic — and, importantly, older rows that have no payload still render,
 * because the stored text remains the fallback.
 */
function localised(row: AppNotification, t: ReturnType<typeof useTranslation>['t'], language: string) {
  const p = row.payload;
  /*
   * D225: never English to a reader in Arabic or French. A type the catalogue names gets its title in the reader's
   * language; the server's English body is shown to an English reader only. A type this build does not know reads as
   * its kind ("New activity"), never as a key.
   */
  const kindKey = `notifications.kind.${row.type}`;
  const generic = {
    title: hasKey(kindKey) ? t(kindKey) : language === 'en' ? row.title : t('notifications.kind.other'),
    body: language === 'en' ? row.body : null,
  };

  /*
   * A price approval (A2). Written by the server as English title and body,
   * and rebuilt here from the fields — an Owner running the app in Arabic must
   * not be told about a discount in English. Older rows without a payload still
   * render, because the stored text stays the fallback.
   */
  if (p && row.type.startsWith('discount_approval.')) {
    const approval = p as DiscountApprovalNotificationPayload;
    switch (approval.event) {
      case 'requested':
        return {
          title: t('notifications.approval.requested.title'),
          body:
            approval.requestedPrice === undefined || approval.configuredPrice === undefined
              ? generic.body
              : t('notifications.approval.requested.body', {
                  requested: formatMoney(approval.requestedPrice),
                  configured: formatMoney(approval.configuredPrice),
                }),
        };
      case 'approved':
        return {
          title: t('notifications.approval.approved.title'),
          body:
            approval.approvedPrice == null
              ? generic.body
              : t('notifications.approval.approved.body', {
                  price: formatMoney(approval.approvedPrice),
                }),
        };
      case 'rejected':
        return {
          title: t('notifications.approval.rejected.title'),
          // The Owner's note is the part worth reading, exactly as a transfer
          // refusal's reason is.
          body: approval.note ? approval.note : t('notifications.approval.rejected.body'),
        };
      default:
        return generic;
    }
  }

  if (!p || !row.type.startsWith('transfer.') || !TRANSFER_EVENTS.has(p.event as TransferEvent)) {
    return generic;
  }
  const transfer = p as Extract<AppNotification['payload'], { transferNo: string }>;
  const values = {
    ref: transfer.transferNo,
    actor: transfer.actor,
    from: transfer.fromBranch,
    to: transfer.toBranch,
    count:
      transfer.units === 1
        ? t('transfers.items.one')
        : t('transfers.items', { count: transfer.units }),
  };
  const body = t(`notifications.transfer.${transfer.event}.body` as never, values);
  return {
    title: t(`notifications.transfer.${transfer.event}.title` as never, values),
    // A refusal or cancellation carries why, and that is the part worth reading.
    body: transfer.reason ? `${body} ${transfer.reason}` : body,
  };
}

function Row({ row, onPress }: { row: AppNotification; onPress: () => void }) {
  const styles = useStyles();
  const { t, language } = useTranslation();
  const { title, body } = localised(row, t, language);

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
    (row.payload && TRANSFER_EVENTS.has(row.payload.event as TransferEvent))
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
      {body ? (
        <Text variant="caption" tone="secondary" style={styles.body} numberOfLines={2}>
          {body}
        </Text>
      ) : null}
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
