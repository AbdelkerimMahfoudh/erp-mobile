import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter, Stack } from 'expo-router';
import { Button, Screen, Text } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { closedReason } from '../lib/access';
import { space } from '../lib/design/tokens';
import { makeStyles } from '../lib/design/theme';
import { useTranslation } from '../lib/i18n';
import { useEntitlement } from '../lib/entitlement';

/**
 * The business cannot use the app, and this screen says why (docs/21,
 * 2026-10-05).
 *
 * **Every word here is chosen by the SERVER's state**, never inferred from a
 * date on the device. A client that decides its own entitlement is a client
 * that can be made to decide wrongly, and a shopkeeper told the wrong reason
 * makes the wrong phone call.
 *
 * Four situations, deliberately distinct: pending approval, refused, suspended,
 * and ended (cancelled). Telling a brand-new business that something ended
 * would be both confusing and untrue.
 *
 * What is deliberately absent: a price, a payment method, a way to buy or
 * renew, a website. Access is managed by the organisation; the app says so,
 * offers to check again — which is what somebody does after it is approved,
 * without reinstalling or signing out — and keeps the person's own account:
 * sign out, and delete the account.
 */
export default function AccessClosed() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const query = useEntitlement();
  const entitlement = query.data;

  const [checking, setChecking] = useState(false);

  // One of four, from the server. If the state is something else entirely, the
  // app should not be on this screen at all.
  const reason = closedReason(entitlement?.state);

  const onRecheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const next = (await query.refetch()).data;
      // Approved while they were looking at this screen. Straight in — no
      // reinstall, no clearing storage, no signing out and back in.
      if (next?.canRead) router.replace('/');
    } finally {
      setChecking(false);
    }
  };

  // Open to this business after all — a link opened later, or approval while
  // away: the app (read-only if that is what the server says), never a refusal
  // that is not true.
  if (entitlement?.canRead) return <Redirect href="/" />;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.wrap}>
        <Text variant="title" align="center">
          {t(`access.closed.${reason}.title`)}
        </Text>
        <Text tone="secondary" align="center" style={styles.body}>
          {t(`access.closed.${reason}.body`)}
        </Text>
        <Text variant="caption" tone="tertiary" align="center">
          {t('access.managed')}
        </Text>
        <Text variant="caption" tone="tertiary" align="center">
          {t('access.mistake')}
        </Text>

        <View style={styles.actions}>
          <Button title={t('access.recheck')} onPress={() => void onRecheck()} loading={checking} />
          {/* Another person's shop may be the one this phone should be signed in to. */}
          <Button title={t('action.signOut')} variant="tertiary" onPress={() => void signOut()} />
          {/*
            The way out is here too (docs/64, App Review 5.1.1(v)): a person
            whose business was refused, suspended or never approved can still
            delete their account, and the guard lets them reach that screen.
          */}
          <Button title={t('account.delete.link')} variant="tertiary" onPress={() => router.push('/account/delete' as never)} />
        </View>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { flex: 1, justifyContent: 'center', gap: space.md, paddingHorizontal: space.md },
  body: { marginTop: space.xs },
  actions: { gap: space.sm, marginTop: space.lg },
}));
