import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  EmptyState,
  ErrorState,
  Identifier,
  MoneyValue,
  Screen,
  Section,
  SkeletonList,
  StatusChip,
  Text,
  WorkflowTimeline,
} from '../../components/ui';
import { api, ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';

/**
 * One physical unit — the screen a scan lands on.
 *
 * Rebuilt for the UX pilot. It was hardcoded English, which mattered more here
 * than almost anywhere: this is where an employee arrives after pointing the
 * camera at a phone, several times an hour.
 *
 * Two things it used to do that it no longer does. Status was rendered by
 * `String.replace('_', ' ')` — so "in_stock" became "in stock" in English and
 * stayed English in Arabic; it now goes through the status registry, which
 * guarantees a translated word beside the colour. And the history rendered
 * `action.replace('_', ' ')` against a raw audit entity, which is database
 * vocabulary rather than something a shopkeeper reads.
 */

interface TimelineEvent {
  at: string;
  entity: string;
  action: string;
  reason: string | null;
}

interface UnitDetail {
  id: string;
  imeiPrimary: string | null;
  serialNo: string | null;
  status: string;
  /** Absent without `cost.view`. */
  cost?: number;
  dateIn?: string;
  product?: { brand: string; model: string; variant: string | null; trackingType?: string };
  branch?: { name: string };
  timeline: TimelineEvent[];
}

export default function UnitDetailScreen() {
  const { t } = useTranslation();
  const { identifier } = useLocalSearchParams<{ identifier: string }>();

  const query = useQuery({
    queryKey: ['unit', identifier],
    queryFn: () => api.get<UnitDetail>(`/units/${encodeURIComponent(identifier)}`),
    enabled: Boolean(identifier),
  });

  const data = query.data;
  const idValue = data ? (data.imeiPrimary ?? data.serialNo ?? '') : identifier;
  const tracking = data?.product?.trackingType ?? (data?.imeiPrimary ? 'imei' : 'serial');

  return (
    <Screen scroll={Boolean(data)}>
      <Stack.Screen options={{ headerShown: true, title: t('unit.title') }} />

      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        query.error instanceof ApiError && query.error.status === 404 ? (
          <EmptyState title={t('unit.notFound.title')} body={t('unit.notFound.body')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : data ? (
        <>
          <Card>
            <Text variant="title">
              {data.product ? `${data.product.brand} ${data.product.model}` : idValue}
            </Text>
            {data.product?.variant ? (
              <Text variant="body" tone="secondary">
                {data.product.variant}
              </Text>
            ) : null}

            <View style={styles.chips}>
              <StatusChip domain="tracking" value={tracking} size="sm" />
              {/* Colour AND word, from the registry — never a raw enum. */}
              <StatusChip domain="unit" value={data.status} size="sm" />
            </View>

            <View style={styles.details}>
              <Row label={t('unit.identifier')}>
                <Identifier>{idValue}</Identifier>
              </Row>
              {data.branch ? (
                <Row label={t('unit.branch')}>
                  <Text variant="bodyStrong">{data.branch.name}</Text>
                </Row>
              ) : null}
              {/* Only when the server sent it — stripped without cost.view. */}
              {data.cost !== undefined ? (
                <Row label={t('unit.cost')}>
                  <MoneyValue value={data.cost} size="small" />
                </Row>
              ) : null}
              {data.dateIn ? (
                <Row label={t('unit.received')}>
                  <Text variant="bodyStrong">{formatDateTime(new Date(data.dateIn))}</Text>
                </Row>
              ) : null}
            </View>
          </Card>

          <Section title={t('unit.history')}>
            {data.timeline.length === 0 ? (
              <Card>
                <Text variant="body" tone="secondary">
                  {t('unit.history.empty')}
                </Text>
              </Card>
            ) : (
              <Card>
                {/*
                  Everything here has already happened, so every step is `done`.
                  The audit action is shown verbatim as the detail rather than
                  being half-prettified: `replace('_', ' ')` produced English
                  either way, and a partly-tidied database word is more
                  confusing than a plainly technical one.
                */}
                <WorkflowTimeline
                  steps={data.timeline.map((event, i) => ({
                    key: `${event.at}-${i}`,
                    label: event.action,
                    detail: event.reason ?? undefined,
                    timestamp: formatDateTime(new Date(event.at)),
                    state: 'done' as const,
                  }))}
                />
              </Card>
            )}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
  details: { gap: space.sm, marginTop: space.base },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
});
