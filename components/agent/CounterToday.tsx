import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Button, InlineNotice, MoneyValue, SkeletonStat, Text } from '../ui';
import { FloatsCard } from './FloatsCard';
import { useAgentDay, useCounterPositions } from '../../lib/agent';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { isIncompatible } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { TABS } from '../../lib/navigation/back';
import { usePermission } from '../../lib/permissions';

/**
 * Home's glance at the counter (docs/73 §5.1): today's exchanges and the
 * commission they earned — the server's count, for whoever reads the counter's
 * reports — then the drawer and each float, Provisional while this phone still
 * holds exchanges, and the way to all of it.
 *
 * Nothing here is added up on the phone: the count, the volume and the
 * commission are the report's; the positions are the server's plus the legs of
 * the exchanges not yet sent, said as such. Without the report key there is no
 * count at all — never a zero.
 */
export function CounterToday() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const canReport = usePermission('agent.report.view');
  const canView = usePermission('agent.transaction.view');
  const day = useAgentDay({ enabled: canReport });
  const { query, rows, provisionalCount } = useCounterPositions({ enabled: canView });
  const totals = day.data?.totals;

  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <Text variant="heading" style={styles.grow}>
          {t('agent.today.title')}
        </Text>
        {canView ? (
          <Button title={t('home.seeMore')} icon={ChevronRight} iconPosition="end" variant="tertiary" size="sm" onPress={() => router.push('/agent/positions' as Href)} />
        ) : null}
      </View>

      {canReport ? (
        day.isPending ? (
          <SkeletonStat />
        ) : totals ? (
          <View style={styles.figures} testID="counter-today">
            <View style={styles.figure}>
              <Text variant="caption" tone="secondary">
                {t('agent.today.exchanges')}
              </Text>
              <Text variant="title">{String(totals.count)}</Text>
            </View>
            <View style={styles.figure}>
              <Text variant="caption" tone="secondary">
                {t('agent.today.commission')}
              </Text>
              <MoneyValue value={totals.commission} size="large" />
            </View>
            {totals.reversals.count > 0 ? (
              <Text variant="caption" tone="tertiary" style={styles.full}>
                {t('agent.today.reversed', { count: totals.reversals.count })}
              </Text>
            ) : null}
          </View>
        ) : (
          <InlineNotice tone="warning">{isIncompatible(day.error) ? t('contract.incompatible.body') : t('agent.today.unavailable')}</InlineNotice>
        )
      ) : null}

      {canView ? (
        query.isPending ? (
          <SkeletonStat />
        ) : rows ? (
          <FloatsCard rows={rows} provisionalCount={provisionalCount} />
        ) : (
          <InlineNotice
            tone="warning"
            action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void query.refetch()} />}
          >
            {isIncompatible(query.error) ? t('contract.incompatible.body') : t('agent.positions.unavailable')}
          </InlineNotice>
        )
      ) : null}

      {provisionalCount > 0 ? (
        <Button
          title={t('agent.today.pending', { count: provisionalCount })}
          variant="tertiary"
          size="sm"
          icon={ChevronRight}
          iconPosition="end"
          onPress={() => router.push(TABS.agent as Href)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  figure: { flexGrow: 1, flexBasis: '40%', minWidth: 120, gap: 2 },
  full: { flexBasis: '100%' },
}));
