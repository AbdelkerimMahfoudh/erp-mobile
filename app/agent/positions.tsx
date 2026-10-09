import React from 'react';
import { Stack } from 'expo-router';
import { ErrorState, PermissionNotice, Screen, SkeletonStat, Text } from '../../components/ui';
import { FloatsCard } from '../../components/agent/FloatsCard';
import { useCounterPositions } from '../../lib/agent';
import { formatTime } from '../../lib/format';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';

/**
 * Cash and floats — the whole of Home's card (docs/73 §4.4–4.5): the drawer,
 * every provider float and every commission a provider holds at this branch,
 * each with the amount it starts from — who set it or counted it, and on which
 * day — and Unknown where nobody ever did. Reads are never refused for the
 * branch's activity, so a branch that left the counter keeps this history.
 * Setting a float is the Owner's, on Money (the next step of checkpoint 4).
 */
export default function AgentPositionsScreen() {
  const { t } = useTranslation();
  const canView = usePermission('agent.transaction.view');
  const { query, rows, provisionalCount, anchors } = useCounterPositions({ enabled: canView });
  const title = t('nav.agent.positions');

  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <PermissionNotice message={t('agent.permission.view')} />
      </Screen>
    );
  }

  return (
    <Screen scroll gap="lg" onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <Stack.Screen options={{ title }} />
      {query.isPending ? (
        <SkeletonStat />
      ) : query.isError || !rows ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Text variant="caption" tone="secondary">
            {t('agent.positions.explain')}
          </Text>
          <FloatsCard rows={rows} provisionalCount={provisionalCount} anchors={anchors} />
          {query.data ? (
            <Text variant="caption" tone="tertiary">
              {t('agent.positions.asOf', { time: isolateLtr(formatTime(query.data.asOf)) })}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}
