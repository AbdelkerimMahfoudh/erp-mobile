import React from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Chip, EmptyState, ErrorState, Screen, SkeletonList, Text } from '../components/ui';
import { api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { formatSmartDateTime } from '../lib/format';
import { haptics } from '../lib/haptics';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import type { AppNotification, NotificationPage, TransferEvent } from '../types/api';
import { makeStyles } from '../lib/design/theme';

/**
 * In-app notifications.
 *
 * The minimum that makes what the backend already writes visible: a bounded
 * list, read state, and an action that lands on the thing the message is about.
 * Deliberately not a notifications *system* — no push, no provider, no
 * preferences, and no second model.
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

  const page = useInfiniteQuery({
    queryKey: qk.notifications,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<NotificationPage>(`/notifications${pageParam ? `?cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });

  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];

  const open = (n: AppNotification) => {
    void haptics.tap();
    if (!n.isRead) markRead.mutate(n.id);
    // The server decides where a notification points; the app just follows.
    if (n.actionLink) router.push(n.actionLink as never);
  };

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ headerShown: true, title: t('notifications.title') }} />

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
function localised(row: AppNotification, t: ReturnType<typeof useTranslation>['t']) {
  const p = row.payload;
  if (!p || !row.type.startsWith('transfer.') || !TRANSFER_EVENTS.has(p.event)) {
    return { title: row.title, body: row.body };
  }
  const values = {
    ref: p.transferNo,
    actor: p.actor,
    from: p.fromBranch,
    to: p.toBranch,
    count: p.units === 1 ? t('transfers.items.one') : t('transfers.items', { count: p.units }),
  };
  const body = t(`notifications.transfer.${p.event}.body` as never, values);
  return {
    title: t(`notifications.transfer.${p.event}.title` as never, values),
    // A refusal or cancellation carries why, and that is the part worth reading.
    body: p.reason ? `${body} ${p.reason}` : body,
  };
}

function Row({ row, onPress }: { row: AppNotification; onPress: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { title, body } = localised(row, t);

  /**
   * Known types get shop language; anything else falls back to the server's own
   * title rather than showing a raw key. A new backend notification type must
   * never render as `notification.some.type` on a shop counter.
   */
  const typeKey = `notifications.type.${row.type}`;
  const typeLabel =
    row.type === 'price.changed' ||
    row.type === 'transfer.incoming' ||
    row.type === 'transfer.received' ||
    (row.payload && TRANSFER_EVENTS.has(row.payload.event))
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
        <Text variant="caption" tone="tertiary">
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
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', gap: space.xs, flexShrink: 1 },
  title: { marginTop: space.sm },
  body: { marginTop: space.xs, lineHeight: 18 },
}));
