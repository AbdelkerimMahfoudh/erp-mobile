import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, MoneyValue, Text } from '../ui';
import { BALANCES_KEY, type TrackedBalances } from '../../app/money-balances';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';

/**
 * Money's balance card (D227): only what the Owner chose to track, each figure said to come from Dukan's records. Nothing
 * tracked, no figure: this store makes no claim about what its cash, wallets or bank hold.
 */
export function TrackedBalancesCard() {
  const { t } = useTranslation();
  const canManage = usePermission('money.anchor.record');
  const balances = useQuery({ queryKey: BALANCES_KEY, queryFn: () => api.get<TrackedBalances>('/money/tracking'), enabled: canManage });
  if (!canManage || !balances.data) return null;
  const on = balances.data.locations.filter((l) => l.on);
  return (
    <Card style={styles.card} testID="tracked-balances">
      <Text variant="heading">{t('balances.title')}</Text>
      {on.map((l) => (
        <View key={l.location} style={styles.line}>
          <Text tone="secondary" style={styles.flex}>{l.label ?? t('balances.cash')}</Text>
          <MoneyValue value={l.expected ?? 0} />
        </View>
      ))}
      {on.length > 0 ? <Text variant="caption" tone="tertiary">{t('balances.notLive', { date: on[0]!.effectiveDate ?? '' })}</Text> : <Text variant="caption" tone="tertiary">{t('balances.off')}</Text>}
      <Button title={t('nav.balances')} variant="tertiary" size="sm" onPress={() => router.push('/money-balances' as Href)} />
    </Card>
  );
}

export interface TrackedCash {
  asOf: string;
  on: boolean;
  effectiveDate?: string;
  expected?: number;
}

/**
 * The Manager's card (D227, the owner's option A): this store's tracked cash, the same figure and words as the Owner's,
 * read-only. Never an account and never the settings. Cash untracked, no card: nothing is claimed.
 */
export function TrackedCashCard() {
  const { t } = useTranslation();
  const canRead = usePermission('report.view');
  const branchId = useBranch((s) => s.branchId);
  const cash = useQuery({ queryKey: [...BALANCES_KEY, 'cash', branchId], queryFn: () => api.get<TrackedCash>('/money/tracking/cash'), enabled: canRead });
  if (!canRead || !cash.data?.on) return null;
  return (
    <Card style={styles.card} testID="tracked-cash">
      <Text variant="heading">{t('balances.title')}</Text>
      <View style={styles.line}>
        <Text tone="secondary" style={styles.flex}>{t('balances.cash')}</Text>
        <MoneyValue value={cash.data.expected ?? 0} />
      </View>
      <Text variant="caption" tone="tertiary">{t('balances.notLive', { date: cash.data.effectiveDate ?? '' })}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  flex: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
