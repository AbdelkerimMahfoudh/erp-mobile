import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, ShoppingCart, Boxes, Menu, Wallet } from 'lucide-react-native';
import { ErrorState } from '../../components/ui';
import { useBranch } from '../../lib/branch';
import { useTranslation } from '../../lib/i18n';
import { usePermission, usePermissionStatus, usePermissionStore } from '../../lib/permissions';
import { tabHubIsVisible } from '../../lib/navigation/registry';
import { makeStyles, useColors } from '../../lib/design/theme';

/** Icon plus label, above the safe area; measured to fit an 11pt label. */
const TAB_BAR_CONTENT = 64;
const TAB_BAR_PADDING = 4;

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
  const styles = useStyles();
  const colors = useColors();
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
  const insets = useSafeAreaInsets();

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
        // text.accent, not brand[600]: the accent lifts to a brighter step in
        // dark mode, where brand[600] goes muddy against near-black.
        tabBarActiveTintColor: colors.text.accent,
        tabBarInactiveTintColor: colors.text.tertiary,
        /*
          Height includes the bottom safe area. It used to be a fixed 60 with
          paddingBottom 8, which REPLACES the navigator's own inset handling:
          on web the icon and label did not fit the 46 points left and the
          labels were cut off at the bottom edge, and on a phone with a home
          indicator they would sit under it.
        */
        tabBarStyle: {
          borderTopColor: colors.border.subtle,
          backgroundColor: colors.surface.card,
          height: TAB_BAR_CONTENT + insets.bottom,
          paddingBottom: TAB_BAR_PADDING + insets.bottom,
          paddingTop: TAB_BAR_PADDING,
        },
        // An explicit line height that may not shrink: the label is an
        // overflow-hidden box, and when the item was short it was squeezed to
        // 9 of the 15 points its glyphs need.
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600', flexShrink: 0 },
        // The scene behind each tab. Unset, the navigator paints its own
        // light default, which ignores the theme entirely.
        sceneStyle: { backgroundColor: colors.surface.canvas },
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

const useStyles = makeStyles((colors) => ({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.canvas,
  },
}));
