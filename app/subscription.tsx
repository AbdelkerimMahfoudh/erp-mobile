import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { BadgeCheck } from 'lucide-react-native';
import {
  Card,
  Chip,
  Divider,
  ErrorState,
  InlineNotice,
  Screen,
  Section,
  SkeletonList,
  Text,
} from '../components/ui';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import { isStale, useEntitlement, type Entitlement } from '../lib/entitlement';

/**
 * Where the shop stands (Milestone K).
 *
 * What is deliberately absent: a price, a payment button, a clickable website,
 * any claim about Bankily, and any feature-tier marketing. There is one plan,
 * the app never takes money, and a figure shown here would have to be kept in
 * step with a price list the app has no business knowing.
 *
 * Every number comes from the server. Nothing on this screen derives a state, a
 * countdown or a seat total.
 */
export default function SubscriptionScreen() {
  const { t } = useTranslation();
  const query = useEntitlement();
  const canSeeSeats = usePermission('user.manage');

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('subscription.title') }} />
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (query.isError && !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('subscription.title') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const e = query.data!;
  const stale = isStale(query);

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('subscription.title') }} />
      <ScrollView contentContainerStyle={styles.list}>
        {/*
          A cached answer that could not be re-checked says so. Telling a shop
          its subscription is fine on the strength of an old cache is exactly
          the confident lie this screen must not tell.
        */}
        {stale ? <InlineNotice tone="warning">{t('subscription.stale')}</InlineNotice> : null}

        <Card style={styles.card}>
          <View style={styles.head}>
            <Text variant="bodyStrong">{t(`subscription.state.${e.state}`)}</Text>
            <Chip tone={toneFor(e.state)} label={t(`subscription.state.${e.state}`)} size="sm" dot />
          </View>
          <StatusBody entitlement={e} />
        </Card>

        {canSeeSeats ? (
          <Section title={t('subscription.seats')}>
            <Card style={styles.card}>
              <Row
                label={t('subscription.seats.used', {
                  used: String(e.seatsUsed),
                  limit: String(e.seatLimit),
                })}
              />
              <Text variant="caption" tone="secondary">
                {t('subscription.seats.included', {
                  included: String(e.includedSeats),
                  extra: String(e.additionalSeats),
                })}
              </Text>
              {e.overLimit ? (
                /*
                  Nobody has been switched off. The app never deactivates staff
                  to balance an invoice — it says what is true and leaves the
                  decision with the Owner.
                */
                <InlineNotice tone="warning">{t('subscription.seats.over')}</InlineNotice>
              ) : null}
              <Divider style={styles.divider} />
              <Row label={t('subscription.branches')} />
              <Text variant="caption" tone="secondary">
                {t('subscription.branches.value', {
                  subscribed: String(e.subscribedBranchCount),
                  active: String(e.activeBranchCount),
                })}
              </Text>
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** The words for each state. The countdown wording is fixed by the brief. */
function StatusBody({ entitlement: e }: { entitlement: Entitlement }) {
  const { t } = useTranslation();

  if (e.state === 'complimentary') {
    return (
      <View style={styles.body}>
        <BadgeCheck size={20} />
        <Text variant="body">{t('subscription.complimentary')}</Text>
      </View>
    );
  }

  if (e.state === 'grace') {
    return (
      <View style={styles.body}>
        <InlineNotice tone="warning">
          {t('subscription.grace', { hours: String(e.graceHoursRemaining) })}
        </InlineNotice>
        <Text variant="caption" tone="secondary">
          {t('subscription.grace.hint')}
        </Text>
      </View>
    );
  }

  if (e.state === 'expired') {
    return (
      <View style={styles.body}>
        <InlineNotice tone="danger">{t('subscription.expired')}</InlineNotice>
        <Text variant="caption" tone="secondary">
          {t('subscription.expired.hint')}
        </Text>
      </View>
    );
  }

  const days = e.daysRemaining ?? 0;
  return (
    <View style={styles.body}>
      <Text variant="body">
        {days <= 0 ? t('subscription.endsToday') : t('subscription.countdown', { days: String(days) })}
      </Text>
    </View>
  );
}

function Row({ label }: { label: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body">{label}</Text>
    </View>
  );
}

function toneFor(state: Entitlement['state']): 'success' | 'warning' | 'danger' | 'info' {
  switch (state) {
    case 'active':
      return 'success';
    case 'complimentary':
      return 'info';
    case 'grace':
      return 'warning';
    default:
      return 'danger';
  }
}

const styles = StyleSheet.create({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  body: { gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs },
  divider: { marginVertical: space.xs },
});
