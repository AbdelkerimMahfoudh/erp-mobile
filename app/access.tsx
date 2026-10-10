import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Card, Chip, Divider, ErrorState, InlineNotice, Screen, SkeletonList, Text } from '../components/ui';
import { accessEnd, businessAccess, type BusinessAccess } from '../lib/access';
import { space } from '../lib/design/tokens';
import { formatDate, formatDateTime } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { usePermission } from '../lib/permissions';
import { isStale, useEntitlement, type Entitlement } from '../lib/entitlement';

/**
 * Where the business's access stands (docs/21, 2026-10-05).
 *
 * The minimum that explains access: the state in a word, the date it runs to
 * or the deadline grace runs to, what still works, and that access is managed
 * by the organisation. Deliberately absent: a price, a staff price, a payment
 * method, a way to buy, renew or extend, a website, and anything that would
 * have to be kept in step with a commercial contract the app has no business
 * knowing. Every figure comes from the server; nothing here derives a state.
 */
export default function AccessScreen() {
  const { t } = useTranslation();
  const query = useEntitlement();
  const mayManageStaff = usePermission('user.manage');

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('access.title') }} />
        <SkeletonList count={2} />
      </Screen>
    );
  }
  if (query.isError && !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('access.title') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const e = query.data!;
  const access = businessAccess(e, isStale(query));

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('access.title') }} />
      <ScrollView contentContainerStyle={styles.list}>
        {/* A cached answer that could not be re-checked says so, rather than claiming to be current. */}
        {access.stale ? <InlineNotice tone="warning">{t('access.stale')}</InlineNotice> : null}

        <Card style={styles.card}>
          <View style={styles.head}>
            <Text variant="bodyStrong">{t(`access.state.${e.state}`)}</Text>
            <Chip tone={toneFor(access)} label={t(`access.state.${e.state}`)} size="sm" dot />
          </View>
          <StatusBody access={access} entitlement={e} />
          <Divider style={styles.divider} />
          <Text variant="caption" tone="secondary">
            {t('access.managed')}
          </Text>
          <Text variant="caption" tone="tertiary">
            {t('access.mistake')}
          </Text>
        </Card>

        {/*
          Nobody has been switched off. The app never deactivates staff to fit an
          allowance — it says what is true and leaves the decision with the Owner.
        */}
        {mayManageStaff && e.overLimit ? <InlineNotice tone="warning">{t('access.staff.over')}</InlineNotice> : null}
      </ScrollView>
    </Screen>
  );
}

/** The words for each mode — the server's dates, shown verbatim. */
function StatusBody({ access, entitlement: e }: { access: BusinessAccess; entitlement: Entitlement }) {
  const { t } = useTranslation();

  if (access.mode === 'grace') {
    return (
      <InlineNotice tone="warning">
        {t('access.grace.body', { deadline: e.graceEnd ? formatDateTime(e.graceEnd) : '' })}
      </InlineNotice>
    );
  }

  if (access.mode === 'read_only') {
    return (
      <View style={styles.body}>
        <InlineNotice tone="danger">{t('access.readOnly.body')}</InlineNotice>
        <Text variant="caption" tone="secondary">
          {t('access.readOnly.kept')}
        </Text>
      </View>
    );
  }

  if (access.mode === 'open') {
    // The later of a running grant's end and the paid end; a grant without an end has no date.
    const end = accessEnd(e);
    return (
      <Text variant="body">
        {end ? t('access.active.until', { date: formatDate(end) }) : t('access.active.open')}
      </Text>
    );
  }

  // A closed business is shown its own screen before it reaches here; the state word above is the answer.
  return null;
}

function toneFor(access: BusinessAccess): 'success' | 'warning' | 'danger' {
  switch (access.mode) {
    case 'open':
      return 'success';
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
  divider: { marginVertical: space.xs },
});
