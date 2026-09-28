import React, { useState } from 'react';
import { ActivityIndicator, Platform, View, useWindowDimensions } from 'react-native';
import { DefaultTheme, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Handshake, Boxes, Menu, Wallet } from 'lucide-react-native';
import { useConnections } from '../../lib/consignment';
import { incomingNeedingAction } from '../../lib/partners';
import { ErrorState, TextMeasure } from '../../components/ui';
import { useBranch } from '../../lib/branch';
import { useTranslation } from '../../lib/i18n';
import { usePermission, usePermissionStatus, usePermissionStore } from '../../lib/permissions';
import { tabHubIsVisible } from '../../lib/navigation/registry';
import { makeStyles, useColors } from '../../lib/design/theme';
import { type as typeScale } from '../../lib/design/tokens';
import { labelScale, tabLabelRoom } from '../../lib/label-fit';

/** Icon plus label, above the safe area; measured to fit an 11pt label. */
const TAB_BAR_CONTENT = 64;
const TAB_BAR_PADDING = 4;

/** As the navigator draws the names: on iOS they never grow with system text — the Large Content Viewer shows them. */
const TAB_NAMES_SCALE = Platform.OS === 'ios' ? false : undefined;

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
  const granted = usePermissionStore((s) => s.granted);
  /*
    Partners is shown to anybody who can see the stores this shop deals with
    or manage who it deals with. The list itself is `consignment.view`; the
    badge counts only requests THIS user may answer (`connection.manage`).
  */
  const canViewPartners = usePermission('consignment.view');
  const canManagePartners = usePermission('connection.manage');
  const showPartners = canViewPartners || canManagePartners;
  const connections = useConnections({ enabled: status === 'ready' && canViewPartners && Boolean(branchId) });
  const partnerBadge = incomingNeedingAction(connections.data?.rows, canManagePartners);
  /*
    Money is shown when the user can reach at least one of its children —
    Results, Expenses, Loans, Outstanding — not when they are the Owner. The
    Daily closing is reached from Home (docs/63), so somebody who only counts
    the drawer finds it there.
  */
  const canSeeMoney = tabHubIsVisible(granted);
  const insets = useSafeAreaInsets();
  /*
    A 10-point label on a narrow phone. Five tabs on a 320-point screen leave each
    label 54 points inside the navigator's own inset, and French "Partenaires"
    needs 56 at 11 points; a negative margin cannot lend it the inset on the web,
    where a one-line label is capped at its button's width. Ten points is what
    the platform's own tab bars use (docs/55 D43).
  */
  const { width } = useWindowDimensions();
  const compactLabels = width < 360;
  const labelType = compactLabels ? typeScale.tabLabelCompact : typeScale.tabLabel;
  /*
    Every tab's name whole, on one line, never "…" (docs/61 §13). With large system
    text or a long translation a name can be wider than its tab — French
    "Partenaires" at 320 points with 1.3× text needs 66 of 54 — so it is measured at
    full size, in the tab bar's own font, and drawn just small enough to fit. The
    others keep their size; with ordinary text nothing changes.
  */
  const [nameWidths, setNameWidths] = useState<Record<string, number>>({});
  const names: Record<string, string> = {
    index: t('tab.home'),
    partners: t('tab.partners'),
    'money-hub': t('tab.money'),
    inventory: t('tab.inventory'),
    more: t('tab.more'),
  };
  const shown = ['index', ...(showPartners ? ['partners'] : []), ...(canSeeMoney ? ['money-hub'] : []), 'inventory', 'more'];
  const nameRoom = tabLabelRoom(width - 2 * Math.max(insets.left, insets.right), shown.length);
  const nameKey = (name: string) => `${labelType.fontSize}|${name}`;
  const tabLabelStyle = (route: string) => {
    const scale = route in names ? labelScale(nameRoom, nameWidths[nameKey(names[route])] ?? 0) : 1;
    return { ...labelType, flexShrink: 0, ...(scale < 1 ? { fontSize: labelType.fontSize * scale } : null) };
  };

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
    <View style={styles.fill}>
      <Tabs
        screenOptions={({ route }) => ({
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
          tabBarLabelStyle: tabLabelStyle(route.name),
          // The scene behind each tab. Unset, the navigator paints its own
          // light default, which ignores the theme entirely.
          sceneStyle: { backgroundColor: colors.surface.canvas },
        })}
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
        {/*
          Partners replaces Sell on the bar (Partners milestone).

          Selling did not move: the scan-first Sell shortcut is on Home, and the
          full multi-item sale is reached from Home and from Quick Sell. Its badge
          is the number of incoming requests this user can answer — nothing else,
          so it never asks somebody to do what they may not.
        */}
        <Tabs.Screen
          name="partners"
          options={{
            title: t('tab.partners'),
            href: showPartners ? undefined : null,
            tabBarBadge: partnerBadge > 0 ? partnerBadge : undefined,
            tabBarAccessibilityLabel:
              partnerBadge > 0
                ? t('partners.tab.a11y', { count: String(partnerBadge) })
                : t('tab.partners'),
            tabBarIcon: ({ color, size }) => <Handshake color={color} size={size} />,
          }}
        />
        {/*
          The full sale, no longer a tab — but still a route. `href: null` takes it
          off the bar without removing it, so `/sell` links, notifications and the
          saved multi-item cart (`sell.cart`) all keep working exactly as before.
        */}
        <Tabs.Screen
          name="sell"
          options={{
            title: t('tab.sell'),
            href: null,
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
      <TextMeasure
        texts={shown.map((route) => names[route])}
        style={[DefaultTheme.fonts.medium, labelType]}
        allowFontScaling={TAB_NAMES_SCALE}
        onWidth={(name, w) => setNameWidths((prev) => (prev[nameKey(name)] === w ? prev : { ...prev, [nameKey(name)]: w }))}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.canvas,
  },
}));
