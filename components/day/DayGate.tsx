import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native';
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
 * closed. Found closed on the first read, the lock stands in for the screen,
 * which is not mounted until the day is known to be open — its draft and its
 * hooks start fresh then — and *Open store now* is offered right here. Read
 * fresh on every arrival; a failed read never blocks anybody, because the
 * server itself refuses a sale or a receipt on a closed day (`store_closed`)
 * instead of reopening it. The screen that meets that refusal reads the day
 * again, which brings this lock up over it: the screen stays mounted beneath,
 * so the item, the price and whatever was typed are still there once the store
 * is open again.
 */
export function DayGate({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const canCount = usePermission('closing.count');
  const canPerform = usePermission('closing.perform');
  const businessDay = useBusinessDay({ enabled: canCount, fresh: true });
  const gate = dayGate(canCount ? businessDay.data : undefined, canPerform);
  const reading = canCount && businessDay.isPending && businessDay.fetchStatus !== 'idle';
  // Once the screen has been on show, a lock that comes later covers it rather than taking it away.
  const [shown, setShown] = useState(false);
  if (!shown && !reading && !gate.locked) setShown(true);
  const covered = shown && gate.locked;
  // A keyboard left up would keep typing into a field nobody can see.
  useEffect(() => {
    if (covered) Keyboard.dismiss();
  }, [covered]);
  // The first read only: a brief wait instead of a screen that would appear and then be taken away.
  if (!shown && reading) {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator color={colors.text.tertiary} />
        </View>
      </Screen>
    );
  }
  if (!shown && gate.locked) return <DayClosedScreen businessDate={gate.businessDate} mayOpen={gate.mayOpen} />;
  return (
    <View style={styles.fill}>
      {/* Covered, the screen is out of reach of touch and of screen readers until the store is open again. */}
      <View
        style={styles.fill}
        pointerEvents={covered ? 'none' : 'auto'}
        aria-hidden={covered}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {gate.locked ? (
        <View style={[StyleSheet.absoluteFill, styles.cover]}>
          <DayClosedScreen businessDate={gate.businessDate} mayOpen={gate.mayOpen} />
        </View>
      ) : null}
    </View>
  );
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

const useStyles = makeStyles((colors) => ({
  centre: { flexGrow: 1, alignItems: 'stretch', justifyContent: 'center', gap: space.base, paddingVertical: space['2xl'] },
  fill: { flex: 1 },
  /** Opaque, so nothing of the screen beneath shows through the lock. */
  cover: { backgroundColor: colors.surface.canvas },
}));
