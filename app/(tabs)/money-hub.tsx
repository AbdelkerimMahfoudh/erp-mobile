import React from 'react';
import { StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Card, EmptyState, ListRow, Screen, Text } from '../../components/ui';
import { HUB_ICONS } from '../../components/navigation/hub-icons';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermissionStore } from '../../lib/permissions';
import { tabHub, visibleChildren } from '../../lib/navigation/registry';

/**
 * Money — a primary tab, beside Sell (CP2).
 *
 * This is deliberately **not** `app/hub/[id]` with a different entry point. A
 * pushed hub route carries a header and a back arrow to whatever pushed it,
 * which on a tab reads as `(tabs)` and is exactly the wrong thing to show on a
 * screen nothing navigated to. A primary tab has no back: you are already here.
 *
 * It renders the same four registry destinations the Money hub has always had,
 * from the same registry, so the tab and the old hub can never disagree about
 * what Money contains.
 */
export default function MoneyTabScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const granted = usePermissionStore((s) => s.granted);

  const hub = tabHub();
  const children = hub ? visibleChildren(hub, granted) : [];

  return (
    <Screen>
      {/*
        No `Stack.Screen` and no header. The tab bar already says where we are,
        and adding a header here is what produced the `(tabs)` back label.
      */}
      <Text variant="title">{t('tab.money')}</Text>
      <Text variant="caption" tone="secondary" style={styles.intro}>
        {t('hub.money.desc')}
      </Text>

      {children.length === 0 ? (
        /*
          Unreachable in practice — the tab is removed from the bar when nothing
          is permitted. It exists for the case where a permission is revoked
          while this screen is open, which would otherwise leave a blank tab.
        */
        <EmptyState
          icon={HUB_ICONS.ShieldCheck}
          title={t('state.error.permission.title')}
          body={t('state.error.permission.body')}
        />
      ) : (
        <Card style={styles.list}>
          {children.map((child) => (
            <ListRow
              key={child.id}
              title={t(child.titleKey)}
              leading={HUB_ICONS[child.icon]}
              onPress={() => router.push(child.route as Href)}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: space.base },
  list: { padding: 0 },
});
