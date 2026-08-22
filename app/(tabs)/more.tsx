import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { BadgeCheck, Bell, ChevronRight, LogOut, RefreshCw, Store } from 'lucide-react-native';
import {
  Card,
  H1,
  IconButton,
  InlineNotice,
  ListRow,
  Screen,
  Text,
} from '../../components/ui';
import { HUB_ICONS } from '../../components/navigation/hub-icons';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../lib/branch';
import { colors } from '../../lib/design/colors';
import { radius, space, touch } from '../../lib/design/tokens';
import { mirror } from '../../lib/design/direction';
import { useEntitlement } from '../../lib/entitlement';
import { useTranslation } from '../../lib/i18n';
import { subscriptionNotice, syncNotice } from '../../lib/navigation/notices';
import { visibleHubs } from '../../lib/navigation/registry';
import { useQueue } from '../../lib/offline/queue';
import { usePermissionStore } from '../../lib/permissions';

/**
 * More — six business hubs, and a quieter account section.
 *
 * This screen used to be roughly twenty rows in which a customer return, the
 * subscription and the device list were all the same size and equally loud.
 * Nothing was findable because nothing was subordinate to anything else.
 *
 * It is now containers only. The membership, the order and the permission for
 * every destination live in `lib/navigation/registry.ts`, so this file decides
 * nothing about who sees what — it renders what the registry allows. That is
 * what keeps a hub from quietly disagreeing with the screen it opens.
 *
 * Nothing here fetches business data or counts anything. The two notices below
 * read state the app already holds for other reasons: the offline queue's own
 * counts, and the server-calculated entitlement.
 */
export default function MoreScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const granted = usePermissionStore((s) => s.granted);

  const business = visibleHubs(granted, 'business');
  const account = visibleHubs(granted, 'account');

  return (
    <Screen>
      {/*
        The screen's own header. A bell here rather than a native navigation
        header: this tab renders its own title, and bolting a stack header on
        for one action would mean two competing headers on one screen.
      */}
      <View style={styles.header}>
        <H1>{t('tab.more')}</H1>
        <IconButton
          icon={Bell}
          accessibilityLabel={t('more.notifications.a11y')}
          variant="plain"
          onPress={() => router.push('/notifications' as Href)}
        />
      </View>

      <BranchControl />

      <SyncNotice />
      <SubscriptionNotice />

      {business.length > 0 ? (
        <>
          <SectionLabel>{t('more.manage')}</SectionLabel>
          <View style={styles.hubs}>
            {business.map(({ hub }) => (
              <Card key={hub.id} style={styles.hubCard}>
                <ListRow
                  title={t(hub.titleKey)}
                  subtitle={t(hub.descriptionKey)}
                  leading={HUB_ICONS[hub.icon]}
                  onPress={() => router.push(`/hub/${hub.id}` as Href)}
                  style={styles.hubRow}
                />
              </Card>
            ))}
          </View>
        </>
      ) : null}

      <SectionLabel>{t('more.account')}</SectionLabel>
      <View style={styles.account}>
        {account.map(({ hub }) => (
          <Card key={hub.id} style={styles.hubCard}>
            <ListRow
              title={t(hub.titleKey)}
              subtitle={t(hub.descriptionKey)}
              leading={HUB_ICONS[hub.icon]}
              onPress={() => router.push(`/hub/${hub.id}` as Href)}
            />
          </Card>
        ))}

        {/* Kept apart from everything else, and the only destructive tone here. */}
        <Pressable onPress={signOut} accessibilityRole="button">
          <Card style={styles.signOut}>
            <LogOut size={20} color={colors.intent.danger.fg} />
            <Text variant="bodyStrong" tone="danger">
              {t('action.signOut')}
            </Text>
          </Card>
        </Pressable>
      </View>
    </Screen>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="caption" tone="tertiary" style={styles.sectionLabel}>
      {children}
    </Text>
  );
}

/**
 * Which branch you are working in, as context rather than as a menu entry.
 *
 * Sits above the hubs because everything below it is scoped by this choice —
 * reading the menu without knowing which shop it refers to is how somebody
 * closes the wrong day.
 *
 * It says *branch*, never company. Switching goes through the existing
 * `select-branch` flow, which lists only the branches this signed-in user was
 * granted, so a branch from another company cannot appear here.
 */
function BranchControl() {
  const { t } = useTranslation();
  const router = useRouter();
  const { branchName, clear } = useBranch();

  return (
    <Pressable
      onPress={() => {
        clear();
        router.replace('/select-branch');
      }}
      accessibilityRole="button"
      accessibilityLabel={t('more.branch.switch')}
      accessibilityHint={branchName ?? undefined}
    >
      <Card style={styles.branch}>
        <Store size={18} color={colors.brand[600]} />
        <View style={styles.branchText}>
          <Text variant="caption" tone="tertiary">
            {t('nav.branch')}
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {branchName ?? t('home.branch.unknown')}
          </Text>
        </View>
        {/* Directional: this points, so it must mirror in RTL. */}
        <ChevronRight size={18} color={colors.text.tertiary} style={mirror()} />
      </Card>
    </Pressable>
  );
}

/**
 * Work saved on this phone that the server has not accepted.
 *
 * Shown only when there is something to say. Two states, deliberately
 * distinguished: things merely waiting for a connection will resolve on their
 * own, while things needing attention will not move until a person looks at
 * them — collapsing those into one number is how a conflict sits unnoticed for
 * a week.
 *
 * The wording never says sent and never says confirmed. A queued financial
 * report is a queued financial report.
 */
function SyncNotice() {
  const { t } = useTranslation();
  const router = useRouter();
  const items = useQueue((s) => s.items);

  const notice = syncNotice(items);
  if (notice.kind === 'none') return null;

  return (
    <InlineNotice
      tone={notice.kind === 'attention' ? 'warning' : 'neutral'}
      title={
        notice.kind === 'attention'
          ? t('more.sync.attention', { count: notice.count })
          : t('more.sync.waiting', { count: notice.count })
      }
      icon={RefreshCw}
      action={
        <Pressable onPress={() => router.push('/sync' as Href)} accessibilityRole="button">
          <Text variant="caption" tone="accent">
            {t('nav.sync')}
          </Text>
        </Pressable>
      }
      style={styles.notice}
    >
      <Text variant="caption" tone="secondary">
        {t('more.sync.notConfirmed')}
      </Text>
    </InlineNotice>
  );
}

/**
 * How long the shop has left, when that has become worth saying.
 *
 * Subscription lives in Team & business during normal operation and is only
 * surfaced here in the four states the server reports as needing attention.
 * Every one of those states is the server's word — `state`, `daysRemaining`
 * and `overLimit` are read, never derived. No price and no payment link, as in
 * milestone K.
 */
function SubscriptionNotice() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = useEntitlement();

  const kind = subscriptionNotice(data);
  if (kind === 'none' || !data) return null;

  const days = data.daysRemaining;
  const message = () => {
    if (kind === 'expired') return t('subscription.expired');
    if (kind === 'grace') return t('subscription.grace', { hours: data.graceHoursRemaining });
    if (kind === 'over_limit') return t('subscription.seats.over');
    return days !== null && days <= 0
      ? t('subscription.endsToday')
      : t('subscription.countdown', { days: String(days) });
  };

  return (
    <InlineNotice
      tone={kind === 'expired' ? 'danger' : 'warning'}
      title={t('subscription.title')}
      icon={BadgeCheck}
      action={
        <Pressable onPress={() => router.push('/subscription' as Href)} accessibilityRole="button">
          <Text variant="caption" tone="accent">
            {t('nav.subscription')}
          </Text>
        </Pressable>
      }
      style={styles.notice}
    >
      <Text variant="caption" tone="secondary">
        {message()}
      </Text>
    </InlineNotice>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  branch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    marginTop: space.sm,
    borderRadius: radius.md,
  },
  branchText: { flex: 1, gap: space.xs },
  notice: { marginTop: space.sm },
  sectionLabel: { marginTop: space.lg, marginBottom: space.xs, textTransform: 'uppercase' },
  hubs: { gap: space.sm },
  hubCard: { paddingVertical: space.xs },
  // Compact, but a floor rather than a fixed height, so larger text still fits.
  hubRow: { minHeight: touch.large + space.md },
  account: { gap: space.sm },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.base,
  },
});
