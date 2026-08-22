import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Home, ShoppingCart, Boxes, Menu, Wallet } from 'lucide-react-native';
import { ErrorState } from '../../components/ui';
import { colors } from '../../lib/design/colors';
import { useBranch } from '../../lib/branch';
import { useTranslation } from '../../lib/i18n';
import { usePermission, usePermissionStatus, usePermissionStore } from '../../lib/permissions';
import { tabHubIsVisible } from '../../lib/navigation/registry';

/**
 * The tab bar, gated by role.
 *
 * A tab that 403s on tap is worse than no tab: it teaches staff the app is
 * unreliable. `href: null` removes the route from navigation entirely, so a
 * warehouse employee simply has no Sell tab rather than a broken one.
 *
 * The bar renders only once permissions resolve. Rendering first would show
 * every tab and then visibly remove some, which looks like a glitch and
 * invites a tap on something about to disappear.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const status = usePermissionStatus();
  const error = usePermissionStore((s) => s.error);
  const { branchId } = useBranch();
  const canSell = usePermission('sale.create');
  const granted = usePermissionStore((s) => s.granted);
  /*
    Money is shown when the user can reach at least one of its four
    children, not when they are the Owner. A store manager who counts the
    drawer needs the tab that holds the daily closing.
  */
  const canSeeMoney = tabHubIsVisible(granted);

  // Permissions failed to resolve. Without an escape here the app is a
  // permanent spinner — the tab bar cannot decide what to show, and there is
  // no screen behind it to fall back to.
  if (status === 'error') {
    return (
      <View style={styles.centered}>
        <ErrorState
          error={new Error(error ?? '')}
          onRetry={() => void usePermissionStore.getState().load(branchId)}
        />
      </View>
    );
  }

  if (status !== 'ready') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brand[600]} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand[600],
        tabBarInactiveTintColor: colors.text.tertiary,
        tabBarStyle: {
          borderTopColor: colors.border.subtle,
          backgroundColor: colors.surface.card,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {/*
        Home is for everyone now.

        It used to be hidden without `report.view`, because the screen was
        nothing but financial reporting and would have 403'd. The screen is now
        gated section by section — an employee sees their work and their
        pending items, an owner also sees the money — so there is no longer a
        reason to take the landing screen away from two of the three roles.
      */}
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="sell"
        options={{
          title: t('tab.sell'),
          href: canSell ? undefined : null,
          tabBarIcon: ({ color, size }) => <ShoppingCart color={color} size={size} />,
        }}
      />
      {/*
        Money, directly beside Sell (CP2).

        Second only to selling in how often a shopkeeper reaches for it, and
        it used to sit two taps away behind More. `href: null` removes it
        entirely when no child is permitted, rather than leaving a tab that
        opens onto an empty screen.

        The bar order is the source order. The navigator mirrors it in RTL
        on its own — reversing it here as well would put Money back on the
        wrong side of Sell.
      */}
      <Tabs.Screen
        name="money-hub"
        options={{
          title: t('tab.money'),
          href: canSeeMoney ? undefined : null,
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
        }}
      />
      {/* Everyone looks stock up — warehouse, sales and owner alike. */}
      <Tabs.Screen
        name="inventory"
        options={{
          title: t('tab.inventory'),
          tabBarIcon: ({ color, size }) => <Boxes color={color} size={size} />,
        }}
      />
      {/* Always present: it holds the account and sign-out. */}
      <Tabs.Screen
        name="more"
        options={{
          title: t('tab.more'),
          tabBarIcon: ({ color, size }) => <Menu color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.canvas,
  },
});
