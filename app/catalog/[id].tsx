import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Package, PencilLine, RotateCcw } from 'lucide-react-native';
import { Button, Card, Chip, ErrorState, ListRow, Screen, Section, SkeletonList, Text } from '../../components/ui';
import { ApiError, api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { usePermission, useCanViewCost } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { money } from '../../lib/theme';
import { toast } from '../../lib/toast';
import { dialog } from '../../lib/dialog';
import type { ProductDetail } from '../../types/api';

/**
 * Product detail (G1).
 *
 * Shows the exact-variant identity, how it is tracked, where its stock sits, and
 * the price information the system already holds — it never invents a second
 * price source, and there is deliberately no price control here: prices are set
 * where stock is received and sold.
 *
 * Cost appears only when the server actually returned it. The cost-gating
 * interceptor strips the field for anyone without `cost.view`, so a missing
 * value is rendered as "Hidden" rather than as a misleading zero.
 *
 * Individual IMEIs are not listed — the endpoint does not return them, and unit
 * lists belong to the separately paginated Inventory screen.
 */
export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = usePermission('catalog.manage');
  const canViewCost = useCanViewCost();

  const product = useQuery({
    queryKey: qk.product(String(id)),
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
  });

  const setActive = useMutation({
    mutationFn: (active: boolean) =>
      api.patch<ProductDetail>(`/products/${id}/${active ? 'restore' : 'archive'}`),
    onSuccess: (fresh, active) => {
      queryClient.setQueryData(qk.product(String(id)), fresh);
      // Only the catalog lists can change shape here; stock is untouched.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(t(active ? 'catalog.restore.done' : 'catalog.archive.done'));
    },
    onError: (e) => toast.error(toFriendlyError(e).body),
  });

  const confirmSetActive = async (active: boolean) => {
    const ok = await dialog.confirm({
      title: t(active ? 'catalog.restore.title' : 'catalog.archive.title'),
      message: t(active ? 'catalog.restore.body' : 'catalog.archive.body'),
      confirmLabel: t(active ? 'catalog.restore.confirm' : 'catalog.archive.confirm'),
      cancelLabel: t('action.cancel'),
      tone: active ? 'default' : 'danger',
    });
    if (ok) setActive.mutate(active);
  };

  if (product.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('catalog.detail.title') }} />
        <SkeletonList count={5} />
      </Screen>
    );
  }

  if (product.isError) {
    const status = product.error instanceof ApiError ? product.error.status : undefined;
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('catalog.detail.title') }} />
        <ErrorState
          error={
            status === 404
              ? new ApiError(t('catalog.detail.notFound'), 404)
              : status === 403
                ? new ApiError(t('catalog.detail.noAccess'), 403)
                : product.error
          }
          onRetry={status === 404 || status === 403 ? undefined : () => void product.refetch()}
        />
      </Screen>
    );
  }

  const p = product.data!;
  const trackingKey = `catalog.tracking.${p.trackingType}` as const;

  return (
    <Screen gap="xl">
      <Stack.Screen options={{ headerShown: true, title: t('catalog.detail.title') }} />

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <View>
        <Text variant="title">{p.label}</Text>
        <View style={styles.chips}>
          {/* Status by colour AND words. */}
          <Chip
            tone={p.isActive ? 'success' : 'neutral'}
            label={t(p.isActive ? 'catalog.status.active' : 'catalog.status.archived')}
            dot
          />
          <Chip tone="neutral" label={t(trackingKey)} />
          {p.categoryName ? <Chip tone="neutral" label={p.categoryName} /> : null}
        </View>
        {!p.isActive ? (
          <Text variant="caption" tone="secondary" style={styles.note}>
            {t('catalog.detail.archivedNote')}
          </Text>
        ) : null}
      </View>

      {/* ── Details ──────────────────────────────────────────────────────── */}
      <Section title={t('catalog.detail.identity')}>
        <Card>
          <Row label={t('catalog.detail.brand')} value={p.brand} />
          <Row label={t('catalog.detail.model')} value={p.model} />
          {p.variant ? <Row label={t('catalog.detail.variant')} value={p.variant} /> : null}
          <Row label={t('catalog.detail.category')} value={p.categoryName ?? t('catalog.detail.noCategory')} />
          <Row label={t('catalog.detail.tracking')} value={t(trackingKey)} />
          <Row label={t('catalog.detail.barcode')} value={p.barcode ?? t('catalog.detail.noBarcode')} />
        </Card>
      </Section>

      {/* ── Specifications ───────────────────────────────────────────────── */}
      <Section title={t('catalog.detail.specifications')}>
        <Card>
          {Object.keys(p.specifications).length === 0 ? (
            <Text variant="caption" tone="secondary">
              {t('catalog.detail.noSpecifications')}
            </Text>
          ) : (
            Object.entries(p.specifications).map(([key, value]) => (
              <Row key={key} label={key} value={formatSpec(value)} />
            ))
          )}
        </Card>
      </Section>

      {/* ── Stock ────────────────────────────────────────────────────────── */}
      <Section title={t('catalog.detail.stock')} subtitle={t('catalog.detail.totalStock', { count: p.totalStock })}>
        {p.stockByBranch.length === 0 ? (
          <Card>
            <Text variant="caption" tone="secondary">
              {t('catalog.detail.noStock')}
            </Text>
          </Card>
        ) : (
          <View style={styles.list}>
            {p.stockByBranch.map((s) => (
              <ListRow
                key={s.branchId}
                title={s.branchName}
                subtitle={
                  // Quantity stock carries its own per-branch price; serialized
                  // stock does not, so nothing is invented for it.
                  s.price !== null ? `${s.quantity} · ${t('catalog.detail.branchPrice')} ${money(s.price)}` : String(s.quantity)
                }
                leading={Package}
                chevron={false}
              />
            ))}
          </View>
        )}
        {p.totalStock > 0 ? (
          <Button
            title={t('catalog.detail.viewInventory')}
            variant="secondary"
            onPress={() => router.push(`/(tabs)/inventory?productId=${p.id}` as never)}
            style={styles.control}
          />
        ) : null}
      </Section>

      {/* ── Price ────────────────────────────────────────────────────────── */}
      <Section title={t('catalog.detail.pricing')}>
        <Card>
          <Row
            label={t('catalog.detail.defaultPrice')}
            value={p.defaultPrice === null ? t('catalog.detail.noPrice') : money(p.defaultPrice)}
          />
          {p.lastSoldPrice !== null ? (
            <Row label={t('catalog.detail.lastSold')} value={money(p.lastSoldPrice)} />
          ) : null}
          {/* Never a fake zero: when the server withheld cost, say so plainly. */}
          <Row
            label={t('catalog.detail.cost')}
            value={
              canViewCost && p.defaultCost !== undefined && p.defaultCost !== null
                ? money(p.defaultCost)
                : canViewCost
                  ? t('catalog.detail.noPrice')
                  : t('catalog.detail.hidden')
            }
          />
          <Text variant="caption" tone="tertiary" style={styles.note}>
            {t('catalog.detail.priceReadOnly')}
          </Text>
        </Card>
      </Section>

      {/* ── Manager actions ──────────────────────────────────────────────── */}
      {canManage ? (
        <Section>
          <View style={styles.list}>
            <Button
              title={t('catalog.action.edit')}
              variant="secondary"
              icon={PencilLine}
              onPress={() => router.push(`/catalog/edit?id=${p.id}` as never)}
            />
            <Button
              title={t(p.isActive ? 'catalog.action.archive' : 'catalog.action.restore')}
              variant={p.isActive ? 'danger' : 'secondary'}
              icon={p.isActive ? Archive : RotateCcw}
              loading={setActive.isPending}
              onPress={() => void confirmSetActive(!p.isActive)}
            />
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

/** Specifications are adaptive: render scalars plainly, objects as compact JSON. */
function formatSpec(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  note: { marginTop: space.sm },
  list: { gap: space.sm },
  control: { marginTop: space.md },
  row: { paddingVertical: space.xs },
});

