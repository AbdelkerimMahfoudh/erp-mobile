import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Button, Screen, Text } from '../ui';
import { OpenStoreNow } from './OpenStoreNow';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { useBusinessDay } from '../../lib/home';
import { dayGate } from '../../lib/day-gate';

/**
 * The guard on Sell and Receive themselves (2026-09-27, `docs/59` D76), so
 * Home's buttons are not the only one: reached by a link, the Stock tab or the
 * back stack, a sale or a receipt still waits while the current business day is
 * closed. The screen behind it is not mounted until the day is known to be open
 * — its draft and its hooks start fresh then — and *Open store now* is offered
 * right here. Read fresh on every arrival; a failed read never blocks anybody.
 */
export function DayGate({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const canCount = usePermission('closing.count');
  const canPerform = usePermission('closing.perform');
  const businessDay = useBusinessDay({ enabled: canCount, fresh: true });
  const gate = dayGate(canCount ? businessDay.data : undefined, canPerform);
  // The first read only: a brief wait instead of a screen that would appear and then be taken away.
  if (canCount && businessDay.isPending && businessDay.fetchStatus !== 'idle') {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator color={colors.text.tertiary} />
        </View>
      </Screen>
    );
  }
  if (!gate.locked) return <>{children}</>;
  return <DayClosedScreen businessDate={gate.businessDate} mayOpen={gate.mayOpen} />;
}

function DayClosedScreen({ businessDate, mayOpen }: { businessDate: string; mayOpen: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <View style={styles.centre}>
        <Lock size={32} color={colors.text.tertiary} />
        <Text variant="title" align="center">
          {t('gate.closed.title')}
        </Text>
        <OpenStoreNow businessDate={businessDate} mayOpen={mayOpen} />
        <Button title={t('action.back')} variant="tertiary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  centre: { flexGrow: 1, alignItems: 'stretch', justifyContent: 'center', gap: space.base, paddingVertical: space['2xl'] },
}));
