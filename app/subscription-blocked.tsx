import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Button, Screen, Text } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { space } from '../lib/design/tokens';
import { makeStyles } from '../lib/design/theme';
import { useTranslation } from '../lib/i18n';
import { useEntitlement } from '../lib/entitlement';

/**
 * The shop cannot get in, and this screen says why.
 *
 * **Every word here is chosen by the SERVER's state**, never inferred from a
 * date on the device. A client that decides its own entitlement is a client
 * that can be made to decide wrongly, and a shopkeeper told the wrong reason
 * makes the wrong phone call.
 *
 * Four situations, deliberately distinct: waiting for approval, refused,
 * suspended (or cancelled), and ended. Telling a brand-new shop that something
 * expired would be both confusing and untrue; telling a refused one that its
 * subscription ended would be a lie about a subscription it never had.
 *
 * What is deliberately absent: a website, a payment link, a price. Activation
 * and extension are decided by the platform's administrators; the app says whom
 * to contact and offers to check again — which is what somebody does after we
 * activate them, without reinstalling or signing out.
 */
export default function SubscriptionBlocked() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const query = useEntitlement();
  const entitlement = query.data;

  const [checking, setChecking] = useState(false);

  const state = entitlement?.state ?? 'pending';

  // One of four, from the server. No fifth "unknown" copy: if the state is
  // something else entirely, the app should not be on this screen at all.
  const key =
    state === 'rejected'
      ? 'rejected'
      : state === 'suspended' || state === 'cancelled'
        ? 'suspended'
        : state === 'pending'
          ? 'pending'
          : 'expired';

  const onRecheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const next = (await query.refetch()).data;
      // Activated while they were looking at this screen. Straight in — no
      // reinstall, no clearing storage, no signing out and back in.
      if (next?.canRead && next.canWrite) router.replace('/');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.wrap}>
        <Text variant="title" align="center">
          {t(`sub.${key}.title` as never)}
        </Text>
        <Text tone="secondary" align="center" style={styles.body}>
          {t(`sub.${key}.body` as never)}
        </Text>
        <Text variant="caption" tone="tertiary" align="center">
          {t('sub.contact')}
        </Text>

        <View style={styles.actions}>
          <Button title={t('sub.recheck')} onPress={() => void onRecheck()} loading={checking} />
          {/* Another person's shop may be the one this phone should be signed in to. */}
          <Button title={t('action.signOut')} variant="tertiary" onPress={() => void signOut()} />
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
