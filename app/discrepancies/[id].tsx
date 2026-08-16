import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  FilterChip,
  InlineNotice,
  MoneyValue,
  Screen,
  Section,
  SegmentedControl,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import {
  allowedResolutions,
  needsResponsiblePerson,
  useAssignableTeam,
  useDiscrepancy,
  useResolveDiscrepancy,
  type DiscrepancyResolution,
} from '../../lib/closing';

/**
 * Deciding what a difference means (E-CP2).
 *
 * The screen is built around one rule: it never suggests an answer. A
 * discrepancy arrives with nobody assigned, and this form does not preselect a
 * resolution or a person — the system observed that the drawer was short, it
 * did not decide who is at fault.
 *
 * Every path out requires a reason, because the record has to be readable in
 * six months by somebody who was not there.
 */
export default function DiscrepancyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canDecide = usePermission('debt.manage');

  const query = useDiscrepancy(id);
  const resolve = useResolveDiscrepancy(id ?? '');
  const team = useAssignableTeam();

  const [resolution, setResolution] = useState<DiscrepancyResolution | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('discrepancy.one.title') }} />
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('discrepancy.one.title') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const d = query.data;
  const namesAPerson = resolution ? needsResponsiblePerson(resolution) : false;
  const canSubmit =
    resolution !== null && reason.trim().length >= 3 && (!namesAPerson || personId !== null);

  return (
    <Screen gap="base">
      <Stack.Screen options={{ headerShown: true, title: t('discrepancy.one.title') }} />

      <Section title={t('discrepancy.what')}>
        <Card>
          <View style={styles.row}>
            <Text variant="body" tone="secondary">
              {d.channel ? d.channel.label : t('closing.channel.cash')}
            </Text>
            <Chip
              tone={d.kind === 'shortage' ? 'danger' : 'warning'}
              label={t(`discrepancy.kind.${d.kind}`)}
              size="sm"
              dot
            />
          </View>
          {d.channel ? (
            <>
              <View style={styles.row}>
                <Text variant="body" tone="secondary">
                  {t('closing.expected')}
                </Text>
                <MoneyValue value={d.channel.expected} size="small" />
              </View>
              <View style={styles.row}>
                <Text variant="body" tone="secondary">
                  {t('closing.counted')}
                </Text>
                <MoneyValue value={d.channel.counted ?? 0} size="small" />
              </View>
            </>
          ) : null}
          <Divider style={styles.divider} />
          <View style={styles.row}>
            <Text variant="bodyStrong">{t('closing.difference')}</Text>
            <MoneyValue value={d.amount} tone="auto" signed />
          </View>
          <Text variant="caption" tone="secondary" style={styles.hint}>
            {t('discrepancy.on', { date: d.date })}
          </Text>
        </Card>
      </Section>

      {d.status === 'resolved' && d.resolution ? (
        <Section title={t('discrepancy.decided')}>
          <Card>
            <Text variant="bodyStrong">{t(`discrepancy.resolution.${d.resolution}`)}</Text>
            <Text variant="body" tone="secondary" style={styles.hint}>
              {d.reason}
            </Text>
          </Card>
        </Section>
      ) : !canDecide ? (
        /*
         * Said rather than hidden. A manager who signs days off can see the
         * difference is unresolved and who has to decide it — a missing button
         * would just look broken.
         */
        <InlineNotice tone="info">{t('discrepancy.ownerOnly')}</InlineNotice>
      ) : (
        <Section title={t('discrepancy.decide')}>
          <Card style={styles.form}>
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

            {/*
              Nothing preselected. A default here would be the system quietly
              proposing an answer to a question about somebody's honesty.
            */}
            <SegmentedControl
              options={allowedResolutions(d.kind).map((r) => ({
                value: r,
                label: t(`discrepancy.resolution.${r}`),
              }))}
              value={resolution ?? ''}
              onChange={(v) => {
                setResolution(v as DiscrepancyResolution);
                if (!needsResponsiblePerson(v as DiscrepancyResolution)) setPersonId(null);
              }}
            />

            {d.kind === 'surplus' ? (
              <Text variant="caption" tone="secondary">
                {t('discrepancy.surplus.why')}
              </Text>
            ) : null}

            {namesAPerson ? (
              <View style={styles.people}>
                <Text variant="body" tone="secondary">
                  {t('discrepancy.who')}
                </Text>
                <View style={styles.chips}>
                  {(team.data ?? []).map((m) => (
                    <FilterChip
                      key={m.id}
                      label={m.name}
                      selected={personId === m.id}
                      onPress={() => setPersonId(personId === m.id ? null : m.id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <TextField
              label={t('discrepancy.reason')}
              value={reason}
              onChangeText={setReason}
              placeholder={t('discrepancy.reasonPlaceholder')}
              multiline
            />
            <Text variant="caption" tone="secondary">
              {t('discrepancy.reason.why')}
            </Text>

            <Button
              title={t('discrepancy.submit')}
              fullWidth
              disabled={!canSubmit || resolve.isPending}
              onPress={() => {
                setError(null);
                resolve.mutate(
                  {
                    resolution: resolution as DiscrepancyResolution,
                    reason: reason.trim(),
                    responsibleUserId: namesAPerson ? (personId as string) : undefined,
                    expectedVersion: d.version,
                  },
                  {
                    onSuccess: () => router.back(),
                    onError: (e) =>
                      setError(e instanceof ApiError ? e.message : t('discrepancy.failed')),
                  },
                );
              }}
            />
          </Card>
        </Section>
      )}

      {d.ledger.length > 0 ? (
        <Section title={t('debt.ledger')}>
          <Card>
            {d.ledger.map((e, i) => (
              <View key={e.id}>
                {i > 0 ? <Divider style={styles.divider} /> : null}
                <View style={styles.row}>
                  <Text variant="body">{t(`debt.kind.${e.kind}`)}</Text>
                  <MoneyValue value={e.amount} size="small" />
                </View>
                <Text variant="caption" tone="secondary">
                  {e.reason}
                </Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs },
  form: { gap: space.base },
  people: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  divider: { marginVertical: space.xs },
  hint: { marginTop: space.xs },
});
