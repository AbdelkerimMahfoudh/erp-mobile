import React, { useState } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter, Stack } from 'expo-router';
import { Button, Screen, Text } from '../components/ui';
import { space } from '../lib/design/tokens';
import { makeStyles } from '../lib/design/theme';
import { useTranslation } from '../lib/i18n';
import { useEntitlement } from '../lib/entitlement';
import { accountPortalUrl } from '../constants/config';

/**
 * The shop cannot get in, and this screen says why.
 *
 * **Every word here is chosen by the SERVER's state**, never inferred from a
 * date on the device. A client that decides its own entitlement is a client
 * that can be made to decide wrongly, and a shopkeeper told the wrong reason
 * makes the wrong phone call.
 *
 * The three states are deliberately distinct. "Waiting for activation" and
 * "subscription ended" are completely different situations, and telling a brand
 * new shop that something expired would be both confusing and untrue.
 *
 * There is always a way forward: a link to the account page, and a way to
 * re-check without reinstalling the app or clearing its storage — which is what
 * somebody does after we activate them.
 */
export default function SubscriptionBlocked() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const query = useEntitlement();
  const entitlement = query.data;

  const [checking, setChecking] = useState(false);
  const [opening, setOpening] = useState(false);

  const state = entitlement?.state ?? 'pending';

  // One of three, from the server. No fourth "unknown" copy: if the state is
  // something else entirely, the app should not be on this screen at all.
  const key =
    state === 'suspended' || state === 'cancelled'
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

  const onManage = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const url = accountPortalUrl();
      if (url && (await Linking.canOpenURL(url))) await Linking.openURL(url);
    } catch {
      // A browser that will not open must not crash the screen explaining the
      // problem.
    } finally {
      setOpening(false);
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

        <View style={styles.actions}>
          <Button title={t('sub.recheck')} onPress={() => void onRecheck()} loading={checking} />
          <Button
            title={t('sub.manage')}
            variant="secondary"
            onPress={() => void onManage()}
            loading={opening}
          />
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
