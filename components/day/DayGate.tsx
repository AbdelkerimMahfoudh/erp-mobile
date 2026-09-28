import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Screen, Text } from '../ui';
import { HeaderBack } from '../navigation/HeaderBack';
import { OpenStoreNow } from './OpenStoreNow';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { useBusinessDay } from '../../lib/home';
import { dayGate, type GateReason } from '../../lib/day-gate';

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
export function DayGate({ children, backRoute }: { children: React.ReactNode; backRoute?: string }) {
  const styles = useStyles();
  const colors = useColors();
  const canCount = usePermission('closing.count');
  const canPerform = usePermission('closing.perform');
  const businessDay = useBusinessDay({ enabled: canCount, fresh: true });
  const gate = dayGate(canCount ? businessDay.data : undefined, canPerform, canCount);
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
  if (!shown && gate.locked) return <DayClosedScreen businessDate={gate.businessDate} reason={gate.reason} mayOpen={gate.mayOpen} backRoute={backRoute} />;
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
          <DayClosedScreen businessDate={gate.businessDate} reason={gate.reason} mayOpen={gate.mayOpen} backRoute={backRoute} />
        </View>
      ) : null}
    </View>
  );
}

function DayClosedScreen({ businessDate, reason, mayOpen, backRoute }: { businessDate: string; reason: GateReason; mayOpen: boolean; backRoute?: string }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  return (
    <Screen>
      {/* A stack screen's header already carries the back arrow; a screen without one (Sell) names its route for ours. */}
      {backRoute ? <HeaderBack route={backRoute} navigation={navigation.getParent() ?? navigation} /> : null}
      <View style={styles.centre}>
        <Lock size={32} color={colors.text.tertiary} />
        <Text variant="title" align="center">
          {t(reason === 'not_opened' ? 'gate.notOpened.title' : 'gate.closed.title')}
        </Text>
        <OpenStoreNow businessDate={businessDate} reason={reason} mayOpen={mayOpen} />
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
