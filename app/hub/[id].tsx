import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Card, EmptyState, ListRow, Screen, Text } from '../../components/ui';
import { HUB_ICONS } from '../../components/navigation/hub-icons';
import { LanguageRow } from '../../components/navigation/LanguageRow';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermissionStore } from '../../lib/permissions';
import { hubById, visibleChildren } from '../../lib/navigation/registry';

/**
 * One navigation hub.
 *
 * A container and nothing else: it lists the destinations the registry gives
 * it, and it deliberately fetches no data, counts nothing and recomputes
 * nothing. A menu that has to load before it can be read is a menu that is
 * sometimes wrong, and a count shown in two places eventually disagrees with
 * itself.
 *
 * The rows here are ordinary compact list rows — the oversized cards that made
 * More feel enormous are not recreated one level down.
 */
export default function HubScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const granted = usePermissionStore((s) => s.granted);

  const hub = typeof id === 'string' ? hubById(id) : undefined;

  if (!hub) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('state.error.notFound.title') }} />
        <EmptyState icon={HUB_ICONS.Package} title={t('state.error.notFound.title')} />
      </Screen>
    );
  }

  const children = visibleChildren(hub, granted);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t(hub.titleKey) }} />

      <Text variant="caption" tone="secondary" style={styles.intro}>
        {t(hub.descriptionKey)}
      </Text>

      {/*
        An empty hub is never offered from More, so reaching one means a
        permission changed while this screen was open. Say so rather than
        showing a blank card.
      */}
      {children.length === 0 ? (
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

      {/*
        The one thing in a hub that is not a route. Language is an account-level
        preference with nowhere else sensible to live now that More holds only
        hubs, and it belongs beside the devices you would change it on.
      */}
      {hub.id === 'account' ? (
        <View style={styles.extras}>
          <LanguageRow />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: space.md },
  list: { paddingVertical: space.xs },
  extras: { marginTop: space.md },
});
