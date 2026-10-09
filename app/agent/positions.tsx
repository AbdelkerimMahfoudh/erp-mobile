import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Coins } from 'lucide-react-native';
import { Button, ErrorState, PermissionNotice, Screen, SkeletonStat, Text } from '../../components/ui';
import { FloatsCard } from '../../components/agent/FloatsCard';
import { SetFloatSheet } from '../../components/agent/SetFloatSheet';
import { useCounterPositions } from '../../lib/agent';
import { floatTargets } from '../../lib/agent-money';
import { useConnectivity } from '../../lib/connectivity';
import { formatTime } from '../../lib/format';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useBusinessAccess } from '../../lib/entitlement';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';

/**
 * Cash and floats — the whole of Home's card (docs/73 §4.4–4.5): the drawer,
 * every provider float and every commission a provider holds at this branch,
 * each with the amount it starts from — who set it or counted it, and on which
 * day — and Unknown where nobody ever did. Reads are never refused for the
 * branch's activity, so a branch that left the counter keeps this history.
 * The Owner sets a float's amount here as on Money (`agent.position.set`).
 */
export default function AgentPositionsScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const canView = usePermission('agent.transaction.view');
  const access = useBusinessAccess();
  const online = useConnectivity((s) => s.online);
  const canSet = usePermission('agent.position.set') && access.canWrite;
  const { query, rows, provisionalCount, anchors } = useCounterPositions({ enabled: canView });
  const [setting, setSetting] = useState(false);
  const title = t('nav.agent.positions');
  const targets = query.data ? floatTargets(query.data) : [];

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
          <FloatsCard
            rows={rows}
            provisionalCount={provisionalCount}
            anchors={anchors}
            footer={
              canSet && targets.length > 0 ? (
                <View style={styles.row}>
                  <Button title={t('agent.setFloat.action')} icon={Coins} variant="secondary" size="sm" wrap disabled={!online} onPress={() => setSetting(true)} />
                </View>
              ) : null
            }
          />
          {query.data ? (
            <Text variant="caption" tone="tertiary">
              {t('agent.positions.asOf', { time: isolateLtr(formatTime(query.data.asOf)) })}
            </Text>
          ) : null}
        </>
      )}
      {canSet ? <SetFloatSheet open={setting} onClose={() => setSetting(false)} targets={targets} /> : null}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', paddingTop: space.xs },
}));
