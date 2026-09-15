import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  Button,
  Card,
  Disclosure,
  InlineNotice,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
  SkeletonStat,
  TabHeader,
  Text,
} from '../../components/ui';
import { PeriodSelector } from '../../components/money/PeriodSelector';
import { HUB_ICONS } from '../../components/navigation/hub-icons';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { movementTotals, useMoneyMovements, type ChannelMovement } from '../../lib/money-movements';
import { tabHub, visibleChildren } from '../../lib/navigation/registry';
import { periodRange, usePeriod } from '../../lib/period';
import { usePermission, usePermissionStore } from '../../lib/permissions';

/**
 * Money — the operational financial hub, a primary tab.
 *
 * Period first (shared with Results), then what the app recorded moving in and
 * out, then cash and each account, then the four places financial work is done.
 *
 * **Recorded, not a bank balance.** Every figure is what this app recorded
 * against cash or an account. Nothing here says a bank or wallet provider saw
 * the money, and the screen says so beside the totals.
 *
 * The four actions come from the navigation registry, so the tab and the old
 * `/hub/money` link can never disagree about what Money contains. The figures
 * need `report.view`; somebody who only counts the drawer or reports expenses
 * still gets the tab and their actions, without figures they may not read.
 */
export default function MoneyTabScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { branchName } = useBranch();
  const granted = usePermissionStore((s) => s.granted);
  const canViewFigures = usePermission('report.view');
  const offline = !useConnectivity((s) => s.online);

  const key = usePeriod((s) => s.key);
  const range = periodRange(key);
  const movements = useMoneyMovements(range.from, range.to, { enabled: canViewFigures });

  const hub = tabHub();
  const actions = hub ? visibleChildren(hub, granted) : [];
  const channels = movements.data?.channels ?? [];
  const totals = movementTotals(channels);

  return (
    <Screen
      scroll
      gap="lg"
      onRefresh={canViewFigures ? () => void movements.refetch() : undefined}
      refreshing={movements.isRefetching}
    >
      <TabHeader context={branchName} title={t('tab.money')} />

      {canViewFigures ? (
        <Section gap="sm">
          <PeriodSelector />
          {offline ? <InlineNotice tone="warning">{t('money.offline')}</InlineNotice> : null}

          {movements.isPending ? (
            <View style={styles.statRow}>
              <SkeletonStat />
              <SkeletonStat />
            </View>
          ) : movements.isError ? (
            <InlineNotice
              tone="warning"
              title={t('moneyTab.unavailable')}
              action={
                <Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void movements.refetch()} />
              }
            >
              {t('moneyTab.unavailable.body')}
            </InlineNotice>
          ) : (
            <Card style={styles.card}>
              <Figure label={t('moneyTab.in')} value={totals.moneyIn} />
              <Figure label={t('moneyTab.out')} value={-totals.moneyOut} />
              <View style={styles.rule} />
              <Figure label={t('moneyTab.net')} value={totals.net} strong />
              <Text variant="caption" tone="tertiary">
                {totals.moneyIn === 0 && totals.moneyOut === 0 ? t('moneyTab.none') : t('moneyTab.recorded')}
              </Text>

              {channels.length > 0 ? (
                <Disclosure title={t('moneyTab.channels')}>
                  {channels.map((c) => (
                    <ChannelLine key={`${c.channel}:${c.accountId ?? (c.isUnattributed ? 'none' : 'cash')}`} channel={c} />
                  ))}
                </Disclosure>
              ) : null}
            </Card>
          )}
        </Section>
      ) : null}

      {actions.length > 0 ? (
        <RowGroup>
          {actions.map((child) => (
            <ListRow
              key={child.id}
              flat
              title={t(child.titleKey)}
              leading={HUB_ICONS[child.icon]}
              onPress={() => router.push(child.route as Href)}
            />
          ))}
        </RowGroup>
      ) : null}
    </Screen>
  );
}

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? undefined : 'secondary'} style={styles.lineLabel}>
        {label}
      </Text>
      <MoneyValue value={value} size={strong ? 'default' : 'small'} tone={strong ? 'auto' : 'default'} signed={strong} />
    </View>
  );
}

/** One channel: its name, and what was recorded coming in and going out. */
function ChannelLine({ channel: c }: { channel: ChannelMovement }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const name = c.channel === 'cash' ? t('moneyTab.cash') : c.isUnattributed ? t('moneyTab.unattributed') : c.label;
  return (
    <View style={styles.channel}>
      <Text variant="bodyStrong" numberOfLines={2}>
        {name}
      </Text>
      <View style={styles.line}>
        <Text variant="caption" tone="secondary" style={styles.lineLabel}>
          {t('moneyTab.in')}
        </Text>
        <MoneyValue value={c.moneyIn} size="small" />
      </View>
      <View style={styles.line}>
        <Text variant="caption" tone="secondary" style={styles.lineLabel}>
          {t('moneyTab.out')}
        </Text>
        <MoneyValue value={-c.moneyOut} size="small" />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  statRow: { flexDirection: 'row', gap: space.sm },
  card: { gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  lineLabel: { flex: 1 },
  rule: { height: 1, backgroundColor: colors.border.subtle },
  channel: { gap: 2, paddingVertical: space.xs },
}));
