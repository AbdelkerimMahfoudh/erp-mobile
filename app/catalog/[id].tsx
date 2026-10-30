import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, PencilLine, RotateCcw } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  ListRow,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  Text,
  Thumbnail,
} from '../../components/ui';
import { illustrationIconFor } from '../../components/ui/CategoryIllustration';
import { illustrationFor } from '../../lib/category-illustration';
import { ApiError, api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { usePermission, useCanViewCost } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { money } from '../../lib/theme';
import { toast } from '../../lib/toast';
import { dialog } from '../../lib/dialog';
import { ProductPricingSection } from '../../components/pricing';
import { useActiveBranchName } from '../../lib/branch';
import type { ProductDetail } from '../../types/api';
import { AddCostSheet } from '../../components/cost/AddCostSheet';
import { formatDate } from '../../lib/format';
import { nameIn } from '../../lib/display-name';

/** Counted stock received without a buying cost (0107), line by line — `GET /inventory/stock/:id/missing-costs`. */
interface MissingCosts {
  missingCostQuantity: number;
  lines: { id: string; quantity: number; receivedAt: string; reference: string | null }[];
}

/**
 * Product detail (G1).
 *
 * Shows the exact-variant identity, how it is tracked, where its stock sits, and
 * what it sells for in the active branch and why. Precedence is the server's:
 * this screen renders the price and source it is given and never re-derives
 * them. Pricing controls appear only with branch-scoped `price.edit`.
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
  const { t, language } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = usePermission('catalog.manage');
  const canViewCost = useCanViewCost();
  const branchName = useActiveBranchName();

  const product = useQuery({
    queryKey: qk.product(String(id)),
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
  });

  /*
   * Counted stock received without its buying cost (D223, 0107): an Owner or a
   * Manager enters it here, line by line. Audited; moves no money.
   */
  const canCompleteCost = usePermission('cost.complete');
  const missing = useQuery({
    queryKey: ['missing-costs', String(id)],
    queryFn: () => api.get<MissingCosts>(`/inventory/stock/${id}/missing-costs`),
    enabled: product.data?.trackingType === 'quantity' && canCompleteCost && canViewCost,
  });
  const [costLine, setCostLine] = useState<MissingCosts['lines'][number] | null>(null);

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
        {/* What the product is, from its category (D225); the generic when it has none. */}
        <View style={styles.identity}>
          <Thumbnail size="lg" illustration={illustrationFor(p.categoryVisual, p.trackingType)} />
          <Text variant="title" style={styles.grow}>
            {p.label}
          </Text>
        </View>
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
          <RowGroup>
            {p.stockByBranch.map((s) => (
              <ListRow
                key={s.branchId}
                flat
                title={nameIn(s.branchName, s.branchNameAr, language)}
                subtitle={
                  // Quantity stock carries its own per-branch price; serialized
                  // stock does not, so nothing is invented for it.
                  s.price !== null ? `${s.quantity} · ${t('catalog.detail.branchPrice')} ${money(s.price)}` : String(s.quantity)
                }
                leading={illustrationIconFor(p.categoryVisual, p.trackingType)}
                chevron={false}
              />
            ))}
          </RowGroup>
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

      {/* ── Selling price ─────────────────────────────────────────────────── */}
      <ProductPricingSection product={p} branchName={branchName ?? ''} />

      {/* ── Cost ─────────────────────────────────────────────────────────── */}
      {/*
        Kept apart from the selling price on purpose: mixing what a thing cost
        with what it sells for is how a counter charges the wrong number. Never
        a fake zero — when the server withheld cost, say so plainly.
      */}
      <Section title={t('catalog.detail.cost')}>
        <Card>
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
        </Card>
      </Section>

      {missing.data && missing.data.lines.length > 0 ? (
        <Section title={t('cost.missing.status')}>
          <RowGroup>
            {missing.data.lines.map((line) => (
              <ListRow
                key={line.id}
                flat
                title={t('cost.complete.lines', { count: String(line.quantity) })}
                subtitle={[formatDate(line.receivedAt), line.reference].filter(Boolean).join(' · ')}
                value={t('cost.missing.add')}
                onPress={() => setCostLine(line)}
              />
            ))}
          </RowGroup>
        </Section>
      ) : null}

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
      <AddCostSheet
        open={costLine !== null}
        subtitle={costLine ? t('cost.complete.lines', { count: String(costLine.quantity) }) : undefined}
        onClose={() => setCostLine(null)}
        onSave={async (cost) => {
          if (!costLine) return;
          const done = await api.post<{ piecesSoldUnknown: number }>(`/purchase-items/${costLine.id}/cost`, { cost });
          toast.success(
            done.piecesSoldUnknown > 0
              ? t('cost.complete.soldUnknown', { count: String(done.piecesSoldUnknown) })
              : t('cost.complete.saved'),
          );
          void queryClient.invalidateQueries({ queryKey: ['missing-costs', String(id)] });
          void queryClient.invalidateQueries({ queryKey: ['inventory'] });
        }}
      />
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
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  note: { marginTop: space.sm },
  list: { gap: space.sm },
  control: { marginTop: space.md },
  row: { paddingVertical: space.xs },
});

