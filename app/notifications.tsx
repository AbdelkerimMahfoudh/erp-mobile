import React from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Chip, EmptyState, ErrorState, Screen, SkeletonList, Text } from '../components/ui';
import { api } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { formatSmartDateTime } from '../lib/format';
import { haptics } from '../lib/haptics';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import type { AppNotification, NotificationPage } from '../types/api';

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
    <Screen>
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
          ItemSeparatorComponent={() => <View style={styles.gap} />}
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

function Row({ row, onPress }: { row: AppNotification; onPress: () => void }) {
  const { t } = useTranslation();

  /**
   * Known types get shop language; anything else falls back to the server's own
   * title rather than showing a raw key. A new backend notification type must
   * never render as `notification.some.type` on a shop counter.
   */
  const typeLabel =
    row.type === 'price.changed'
      ? t('notifications.type.price.changed')
      : row.type === 'transfer.incoming'
        ? t('notifications.type.transfer.incoming')
        : row.type === 'transfer.received'
          ? t('notifications.type.transfer.received')
          : null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
      <View style={styles.head}>
        <View style={styles.chips}>
          {typeLabel ? <Chip label={typeLabel} tone="info" size="sm" /> : null}
          {/* Unread is words plus tone, never a bare coloured dot. */}
          {!row.isRead ? <Chip label={t('notifications.unread')} tone="warning" size="sm" /> : null}
        </View>
        <Text variant="caption" tone="tertiary">
          {formatSmartDateTime(row.createdAt)}
        </Text>
      </View>

      <Text variant="bodyStrong" style={styles.title}>
        {row.title}
      </Text>
      {row.body ? (
        <Text variant="caption" tone="secondary" style={styles.body}>
          {row.body}
        </Text>
      ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.base, paddingBottom: space['2xl'] },
  gap: { height: space.sm },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', gap: space.xs, flexShrink: 1 },
  title: { marginTop: space.sm },
  body: { marginTop: space.xs, lineHeight: 18 },
});
