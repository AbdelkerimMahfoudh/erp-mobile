import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Button, EmptyState, ErrorState, InlineNotice, ListSeparator, Screen, SkeletonList, Text } from '../components/ui';
import { AlertRow, useAcknowledge } from '../components/analytics/AlertRow';
import { useAnomalyList, type Anomaly } from '../lib/anomalies';
import { useConnectivity } from '../lib/connectivity';
import { radius, space } from '../lib/design/tokens';
import { makeStyles } from '../lib/design/theme';
import { useTranslation } from '../lib/i18n';

/**
 * Every alert to review, newest first, twenty at a time.
 *
 * The same rows, the same order and the same "I understand" as the overview's
 * preview — this is the rest of that list, not a second one. Virtualised, so a
 * shop with a long month scrolls a list rather than mounting a wall.
 */
export default function AlertsScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const list = useAnomalyList();
  const { acknowledge, pendingKey } = useAcknowledge();

  const rows: Anomaly[] = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = list.data?.pages[0]?.total ?? rows.length;
  const last = rows.length - 1;

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('alerts.title') }} />
      {!online ? (
        <InlineNotice tone="neutral">{t('attention.offline')}</InlineNotice>
      ) : list.isLoading ? (
        <SkeletonList count={5} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('attention.empty')} body={t('attention.emptyBody')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={({ item, index }) => (
            <View style={[styles.row, index === 0 ? styles.rowFirst : null, index === last ? styles.rowLast : null]}>
              <AlertRow row={item} pending={pendingKey === item.key} onAcknowledge={(r) => void acknowledge(r)} />
            </View>
          )}
          ItemSeparatorComponent={ListSeparator}
          ListHeaderComponent={
            <Text variant="caption" tone="secondary" style={styles.count}>
              {t('alerts.count', { count: String(total) })}
            </Text>
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {list.hasNextPage ? (
                <Button
                  title={t('alerts.more')}
                  variant="secondary"
                  loading={list.isFetchingNextPage}
                  onPress={() => void list.fetchNextPage()}
                />
              ) : (
                <Text variant="caption" tone="tertiary" align="center">
                  {t('alerts.end')}
                </Text>
              )}
            </View>
          }
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { paddingBottom: space['3xl'] },
  count: { paddingBottom: space.sm },
  // The rows draw one surface between them: side edges everywhere, the top
  // and bottom edges with their radii on the first and last row.
  row: {
    backgroundColor: colors.surface.card,
    borderColor: colors.border.subtle,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  footer: { paddingTop: space.base, alignItems: 'center' },
}));
