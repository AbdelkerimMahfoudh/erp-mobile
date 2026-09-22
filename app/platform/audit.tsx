import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, ListSeparator, Screen, SkeletonList, Text } from '../../components/ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { platformApi, platformKeys, usePlatformGuard, type PlatformAuditRow } from '../../lib/platform-admin';

/** The platform's own trail: who did what to which business, and why. Append-only on the server. */
export default function PlatformAudit() {
  const styles = useStyles();
  const { t } = useTranslation();
  const session = usePlatformGuard();
  const [pages, setPages] = useState(1);
  const [rows, setRows] = useState<PlatformAuditRow[]>([]);

  const page = useQuery({
    queryKey: platformKeys.audit(pages),
    queryFn: async () => {
      const fetched = await platformApi.audit(pages);
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...fetched.filter((r) => !seen.has(r.id))];
      });
      return fetched;
    },
    enabled: !!session,
  });

  if (!session) return null;
  const more = (page.data?.length ?? 0) >= 50;

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('platform.audit.title') }} />
      {page.isLoading && rows.length === 0 ? (
        <SkeletonList count={5} />
      ) : page.isError && rows.length === 0 ? (
        <ErrorState error={page.error} onRetry={() => void page.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('platform.audit.empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text variant="bodyStrong">{`${item.action}${item.targetLabel ? ` · ${item.targetLabel}` : ''}`}</Text>
              <Text variant="caption" tone="secondary">
                {`${formatDateTime(item.createdAt)} · ${t('platform.audit.by', { actor: item.actor })}`}
              </Text>
              {item.reason ? (
                <Text variant="caption" tone="tertiary">
                  {item.reason}
                </Text>
              ) : null}
            </View>
          )}
          ItemSeparatorComponent={ListSeparator}
          ListFooterComponent={
            more ? (
              <View style={styles.footer}>
                <Button title={t('platform.audit.more')} variant="secondary" loading={page.isFetching} onPress={() => setPages((p) => p + 1)} />
              </View>
            ) : null
          }
          contentContainerStyle={styles.content}
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: { paddingBottom: space['3xl'] },
  row: { paddingVertical: space.sm, gap: 2 },
  footer: { paddingTop: space.base, alignItems: 'center' },
}));
