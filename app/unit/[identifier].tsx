import React from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react-native';
import {
  Card,
  EmptyState,
  ErrorState,
  Identifier,
  MoneyValue,
  Screen,
  SkeletonList,
  StatusChip,
  Text,
} from '../../components/ui';
import { ActivityTimeline } from '../../components/inventory/ActivityTimeline';
import { api, ApiError } from '../../lib/api-client';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import type { UnitHistoryEvent } from '../../lib/unit-history';

/**
 * One physical unit — the screen a scan lands on.
 *
 * In the Stock screen's visual language: white cards on the cool background,
 * the product and its state first, then what identifies it, where it is, where
 * it came from, and what has happened to it.
 *
 * - **IMEI 1, IMEI 2 and a serial number are different things** and get their
 *   own rows. A dual-SIM phone shows both IMEIs; neither is called "the"
 *   identifier.
 * - **Cost only when the server sent it** — it is stripped without `cost.view`.
 *   Absent, the row is absent; never a dash, never a zero.
 * - **History in words** (`ActivityTimeline`), never `create` or
 *   `status_change`.
 */

interface UnitDetail {
  id: string;
  imeiPrimary: string | null;
  imeiSecondary: string | null;
  serialNo: string | null;
  status: string;
  /** Absent without `cost.view`. */
  cost?: number;
  dateIn?: string;
  product?: { brand: string; model: string; variant: string | null; trackingType?: string };
  branch?: { name: string } | null;
  purchase?: { referenceNo: string | null; date: string } | null;
  timeline: UnitHistoryEvent[];
}

export default function UnitDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const { identifier } = useLocalSearchParams<{ identifier: string }>();

  const query = useQuery({
    queryKey: ['unit', identifier],
    queryFn: () => api.get<UnitDetail>(`/units/${encodeURIComponent(identifier)}`),
    enabled: Boolean(identifier),
  });

  const data = query.data;
  const tracking = data?.product?.trackingType ?? (data?.imeiPrimary ? 'imei' : 'serial');
  const title = data?.product ? `${data.product.brand} ${data.product.model}` : (identifier ?? '');
  const hasPurchase = Boolean(data?.dateIn || data?.purchase?.referenceNo || data?.cost !== undefined);

  return (
    <Screen scroll={Boolean(data)} gap="base">
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
          {/* 1–2 · Product, variant, and where it stands now. */}
          <Card>
            <View style={styles.product}>
              <View style={styles.thumb} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Smartphone color={colors.text.accent} size={22} />
              </View>
              <View style={styles.productText}>
                <Text variant="title" accessibilityRole="header">
                  {title}
                </Text>
                {data.product?.variant ? (
                  <Text variant="body" tone="secondary">
                    {data.product.variant}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.statusLine}>
              <Text variant="caption" tone="tertiary">
                {t('unit.status')}
              </Text>
              <View style={styles.chips}>
                <StatusChip domain="unit" value={data.status} size="sm" />
                <StatusChip domain="tracking" value={tracking} size="sm" dot={false} />
              </View>
            </View>
          </Card>

          {/* 3 · What identifies it — each identifier by its own name. */}
          <Block title={t('unit.identifiers')}>
            {data.imeiPrimary ? (
              <Row label={t('unit.imei1')}>
                <Identifier tone="primary">{data.imeiPrimary}</Identifier>
              </Row>
            ) : null}
            {data.imeiSecondary ? (
              <Row label={t('unit.imei2')}>
                <Identifier tone="primary">{data.imeiSecondary}</Identifier>
              </Row>
            ) : null}
            {data.serialNo ? (
              <Row label={t('unit.serial')}>
                <Identifier tone="primary">{data.serialNo}</Identifier>
              </Row>
            ) : null}
          </Block>

          {/* 4 · Where it is. */}
          {data.branch ? (
            <Block title={t('unit.location')}>
              <Row label={t('unit.branch')}>
                <Text variant="bodyStrong">{data.branch.name}</Text>
              </Row>
            </Block>
          ) : null}

          {/* 5 · Where it came from — cost only when the server sent it. */}
          {hasPurchase ? (
            <Block title={t('unit.purchase')}>
              {data.dateIn ? (
                <Row label={t('unit.received')}>
                  <Text variant="bodyStrong">{formatDateTime(data.dateIn)}</Text>
                </Row>
              ) : null}
              {data.purchase?.referenceNo ? (
                <Row label={t('unit.reference')}>
                  <Identifier tone="primary">{data.purchase.referenceNo}</Identifier>
                </Row>
              ) : null}
              {data.cost !== undefined ? (
                <Row label={t('unit.cost')}>
                  <MoneyValue value={data.cost} size="small" />
                </Row>
              ) : null}
            </Block>
          ) : null}

          {/* 6 · What has happened to it. */}
          <View style={styles.historyHead}>
            <Text variant="heading" accessibilityRole="header">
              {t('unit.history')}
            </Text>
          </View>
          {data.timeline.length === 0 ? (
            <Card>
              <Text variant="body" tone="secondary">
                {t('unit.history.empty')}
              </Text>
            </Card>
          ) : (
            <ActivityTimeline events={data.timeline} />
          )}
        </>
      ) : null}
    </Screen>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  // Hairlines BETWEEN rows only — a line under the last row doubled the card's edge.
  const rows = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement<RowProps>[];
  return (
    <View style={styles.block}>
      <Text variant="label" tone="tertiary" accessibilityRole="header">
        {title}
      </Text>
      <Card padding="none">
        {rows.map((row, i) => React.cloneElement(row, { last: i === rows.length - 1 }))}
      </Card>
    </View>
  );
}

interface RowProps {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}

function Row({ label, children, last = false }: RowProps) {
  const styles = useStyles();
  return (
    <View style={[styles.row, last ? styles.rowLast : null]}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <View style={styles.value}>{children}</View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.intent.info.bg,
  },
  productText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  block: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  value: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  historyHead: {
    paddingTop: space.sm,
  },
}));
