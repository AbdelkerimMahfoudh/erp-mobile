import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Coins } from 'lucide-react-native';
import { Button, InlineNotice, SkeletonStat, Text } from '../ui';
import { FloatsCard } from './FloatsCard';
import { SetFloatSheet } from './SetFloatSheet';
import { useCounterPositions } from '../../lib/agent';
import { floatTargets } from '../../lib/agent-money';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useBusinessAccess } from '../../lib/entitlement';
import { isIncompatible } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';

/**
 * The branch's floats on Money (docs/73 §4.4–4.5, D157): each provider's float
 * on its own line, the commission a provider holds apart, each as the server
 * tracks it — Unknown stays Unknown with the day's movement beside it, below
 * zero is said in words and colour, and Provisional while this phone holds
 * exchanges (the server's position plus their legs).
 *
 * Never mixed with the company's receiving accounts, which Money's top card
 * shows: a float is this branch's stock of a provider's credit, the receiving
 * account the company's till for sales — same provider name, different money
 * (A9). The drawer is ONE: it is a line here only when the top card, which
 * shows it already, is not shown (`withCash`), so the cash is never on Money
 * twice.
 *
 * The Owner sets a float's amount from here (`agent.position.set`), online.
 */
export function MoneyFloats({ withCash }: { withCash: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const online = useConnectivity((s) => s.online);
  const access = useBusinessAccess();
  const canSet = usePermission('agent.position.set') && access.canWrite;
  const canConfigure = usePermission('agent.provider.manage');
  const { query, rows, provisionalCount } = useCounterPositions();
  const [setting, setSetting] = useState(false);
  const shown = (rows ?? []).filter((r) => withCash || r.kind !== 'cash');
  const targets = query.data ? floatTargets(query.data) : [];

  return (
    <View style={styles.block} testID="money-floats">
      <View style={styles.head}>
        <Text variant="heading">{t('agent.money.title')}</Text>
        <Text variant="caption" tone="tertiary">
          {t('agent.money.explain')}
        </Text>
      </View>
      {query.isPending ? (
        <SkeletonStat />
      ) : !rows ? (
        <InlineNotice tone="warning" action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void query.refetch()} />}>
          {isIncompatible(query.error) ? t('contract.incompatible.body') : t('agent.positions.unavailable')}
        </InlineNotice>
      ) : shown.length === 0 ? (
        <InlineNotice
          tone="info"
          action={canConfigure ? <Button title={t('nav.agent.providers')} variant="tertiary" size="sm" onPress={() => router.push('/agent/providers' as Href)} /> : undefined}
        >
          {t('agent.money.none')}
        </InlineNotice>
      ) : (
        <FloatsCard
          rows={shown}
          provisionalCount={provisionalCount}
          footer={
            canSet && targets.length > 0 ? (
              <View style={styles.row}>
                <Button title={t('agent.setFloat.action')} icon={Coins} variant="secondary" size="sm" wrap disabled={!online} onPress={() => setSetting(true)} />
              </View>
            ) : null
          }
        />
      )}
      {canSet ? <SetFloatSheet open={setting} onClose={() => setSetting(false)} targets={targets} /> : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm },
  head: { gap: 2 },
  row: { flexDirection: 'row', paddingTop: space.xs },
}));
