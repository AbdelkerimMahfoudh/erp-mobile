import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package } from 'lucide-react-native';
import {
  Button,
  ErrorState,
  Identifier,
  InlineNotice,
  ListRow,
  MoneyField,
  PermissionNotice,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { SelectSheet } from '../../components/overlay/SelectSheet';
import { api, ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { usePermission } from '../../lib/permissions';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toErrorMessage } from '../../lib/errors';
import { toast } from '../../lib/toast';
import { useTranslation } from '../../lib/i18n';
import { analyzeCorrection, buildCorrectionBody, type CorrectionForm } from '../../lib/unit-correction';
import { qk } from '../../lib/query-keys';
import type { ProductListRow, ProductPage, TrackingType } from '../../types/api';

/**
 * Correcting one in-stock unit — the intake-mistake fix.
 *
 * Reached from the pencil on a unit's detail, and only when the server permits
 * it (`unit.add`) and the unit is still in stock. It corrects the unit's OWN
 * columns: which product it is (re-associated, which fixes its model, variant,
 * storage, colour and barcode by pointing at the right catalogue entry — never
 * by rewriting the shared product), its IMEI or serial, and its cost. The branch
 * and status never change here; a transfer moves a unit, a faulty unit has its
 * own action, and nothing is ever deleted.
 *
 * What is sensitive is named as such: changing an IMEI, a serial or the cost
 * asks for a reason, which travels to the audit trail. The server validates
 * everything again — format, checksum, cross-unit uniqueness, isolation — and
 * refuses a stale save rather than overwriting a change made since this screen
 * opened.
 */
interface UnitEditData {
  id: string;
  imeiPrimary: string | null;
  imeiSecondary: string | null;
  serialNo: string | null;
  status: string;
  /** Absent without `cost.view`; the cost field is then not shown. */
  cost?: number;
  updatedAt: string;
  product: { id: string; brand: string; model: string; variant: string | null; trackingType: TrackingType };
}

export default function UnitEditScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { identifier } = useLocalSearchParams<{ identifier: string }>();
  const canEdit = usePermission('unit.add');

  const query = useQuery({
    queryKey: ['unit', identifier],
    queryFn: () => api.get<UnitEditData>(`/units/${encodeURIComponent(identifier)}`),
    enabled: Boolean(identifier),
  });

  if (!canEdit) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('unit.edit.title') }} />
        <PermissionNotice message={t('unit.edit.noPermission')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('unit.edit.title') }} />
      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <EditForm unit={query.data} onSaved={() => router.back()} onStale={() => void query.refetch()} />
      ) : null}
    </Screen>
  );
}

function EditForm({
  unit,
  onSaved,
  onStale,
}: {
  unit: UnitEditData;
  onSaved: () => void;
  onStale: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { branchId } = useBranch();
  const canViewCost = usePermission('cost.view');

  const tracking = unit.product.trackingType;
  const isImei = tracking === 'imei';
  const isSerial = tracking === 'serial';
  const inStock = unit.status === 'in_stock';

  // The product the unit is associated with — its label for display, and the
  // id only once a different one has been deliberately chosen.
  const [productLabel, setProductLabel] = useState(
    [unit.product.brand, unit.product.model, unit.product.variant].filter(Boolean).join(' '),
  );
  const [newProductId, setNewProductId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');

  const [imei1, setImei1] = useState(unit.imeiPrimary ?? '');
  const [imei2, setImei2] = useState(unit.imeiSecondary ?? '');
  const [serial, setSerial] = useState(unit.serialNo ?? '');
  const [cost, setCost] = useState(unit.cost !== undefined ? String(unit.cost) : '');
  const [reason, setReason] = useState('');
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const products = useQuery({
    queryKey: qk.products(`edit:${productQuery}`),
    queryFn: () => api.get<ProductPage>(`/products?search=${encodeURIComponent(productQuery)}`),
    enabled: pickerOpen,
  });
  // Only products tracked the same way are valid targets — the server refuses a
  // cross-tracking move, so it is never offered.
  const productChoices = (products.data?.rows ?? []).filter((r) => r.trackingType === tracking);

  // ── What changed, and what is wrong — one source of truth, tested apart ──
  const formValues: CorrectionForm = { newProductId, imei1, imei2, serial, cost, reason, canViewCost };
  const shape = analyzeCorrection(
    {
      imeiPrimary: unit.imeiPrimary,
      imeiSecondary: unit.imeiSecondary,
      serialNo: unit.serialNo,
      cost: unit.cost,
      updatedAt: unit.updatedAt,
      trackingType: tracking,
    },
    formValues,
    inStock,
  );
  const { sensitiveChange, reasonMissing, blocked, imei1Problem, imei2Problem, serialProblem } = shape;

  const save = useMutation({
    mutationFn: () =>
      api.patch<UnitEditData>(
        `/units/${unit.id}`,
        buildCorrectionBody(
          {
            imeiPrimary: unit.imeiPrimary,
            imeiSecondary: unit.imeiSecondary,
            serialNo: unit.serialNo,
            cost: unit.cost,
            updatedAt: unit.updatedAt,
            trackingType: tracking,
          },
          formValues,
        ),
      ),
    onSuccess: () => {
      toast.success(t('unit.edit.saved'));
      qc.invalidateQueries({ queryKey: ['unit'] });
      qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
      qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
      onSaved();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? ((e.body as { code?: string } | undefined)?.code ?? e.code) : undefined;
      if (code === 'stale_unit') {
        setStale(true);
        setError(null);
        onStale();
        return;
      }
      if (e instanceof ApiError && e.status === 409) {
        setError(t('unit.edit.duplicate'));
        return;
      }
      setError(toErrorMessage(e));
    },
  });

  return (
    <>
      <Screen
        scroll
        padded={false}
        footer={
          <Button
            title={t('unit.edit.save')}
            size="lg"
            fullWidth
            disabled={blocked}
            loading={save.isPending}
            onPress={() => {
              setError(null);
              setStale(false);
              save.mutate();
            }}
          />
        }
      >
        <View style={styles.body}>
          <Text variant="body" tone="secondary">
            {t('unit.edit.intro')}
          </Text>

          {!inStock ? <InlineNotice tone="warning">{t('unit.edit.notInStock')}</InlineNotice> : null}
          {stale ? <InlineNotice tone="warning">{t('unit.edit.stale')}</InlineNotice> : null}
          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

          {/* Product — re-associated, not rewritten. */}
          <Section title={t('unit.edit.product')} gap="xs">
            <RowGroup>
              <ListRow
                flat
                leading={Package}
                title={productLabel}
                value={t('unit.edit.product.change')}
                valueTone="secondary"
                onPress={() => setPickerOpen(true)}
              />
            </RowGroup>
            <Text variant="caption" tone="tertiary">
              {t('unit.edit.product.hint')}
            </Text>
          </Section>

          {/* Identifiers — shaped by the tracking type. */}
          {isImei ? (
            <View style={styles.fields}>
              <TextField
                label={t('unit.edit.imei1')}
                value={imei1}
                onChangeText={(v) => setImei1(v.replace(/\D/g, '').slice(0, 15))}
                keyboardType="number-pad"
                inputMode="numeric"
                variant="identifier"
                maxLength={15}
                error={imei1Problem ? t(`pick.problem.${imei1Problem}` as never) : undefined}
              />
              <TextField
                label={t('unit.edit.imei2')}
                value={imei2}
                onChangeText={(v) => setImei2(v.replace(/\D/g, '').slice(0, 15))}
                keyboardType="number-pad"
                inputMode="numeric"
                variant="identifier"
                maxLength={15}
                error={
                  imei2Problem === 'same'
                    ? t('unit.edit.imei.sameAsPrimary')
                    : imei2Problem === 'invalid'
                      ? t('unit.edit.imei.invalid')
                      : undefined
                }
              />
              {imei2.trim() ? (
                <Button
                  title={t('unit.edit.imei2.clear')}
                  variant="tertiary"
                  size="sm"
                  onPress={() => setImei2('')}
                />
              ) : null}
            </View>
          ) : null}

          {isSerial ? (
            <View style={styles.fields}>
              <TextField
                label={t('unit.edit.serial')}
                value={serial}
                onChangeText={setSerial}
                variant="identifier"
                maxLength={64}
                error={serialProblem ? t('pick.problem.empty' as never) : undefined}
              />
            </View>
          ) : null}

          {/* Cost — only where the role may see it. */}
          {canViewCost ? (
            <View style={styles.fields}>
              <MoneyField label={t('unit.edit.cost')} value={cost} onChangeText={setCost} />
            </View>
          ) : null}

          {/* A sensitive change says why. */}
          {sensitiveChange ? (
            <View style={styles.fields}>
              <TextField
                label={t('unit.edit.reason')}
                hint={t('unit.edit.reason.hint')}
                placeholder={t('unit.edit.reason.placeholder')}
                value={reason}
                onChangeText={setReason}
                required
                multiline
              />
              {reasonMissing ? (
                <Text variant="caption" tone="warning">
                  {t('unit.edit.reasonRequired')}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* The unit's current identity, for reference while correcting it. */}
          <View style={styles.current}>
            <Text variant="caption" tone="tertiary">
              {isImei ? t('unit.imei1') : t('unit.serial')}
            </Text>
            <Identifier tone="tertiary">
              {unit.imeiPrimary ?? unit.serialNo ?? '—'}
            </Identifier>
          </View>
        </View>
      </Screen>

      <SelectSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('unit.edit.chooseProduct.title')}
        items={productChoices}
        keyExtractor={(p: ProductListRow) => p.id}
        labelExtractor={(p: ProductListRow) => [p.brand, p.model].filter(Boolean).join(' ')}
        descriptionExtractor={(p: ProductListRow) => p.variant ?? undefined}
        leadingIcon={Package}
        selectedKeys={newProductId ? [newProductId] : [unit.product.id]}
        searchPlaceholder={t('unit.edit.chooseProduct.search')}
        onSearchChange={setProductQuery}
        loading={products.isLoading}
        error={products.error}
        onRetry={() => products.refetch()}
        onSelect={(row: ProductListRow) => {
          setNewProductId(row.id);
          setProductLabel([row.brand, row.model, row.variant].filter(Boolean).join(' '));
          setPickerOpen(false);
        }}
      />
    </>
  );
}

const useStyles = makeStyles(() => ({
  body: { padding: space.base, gap: space.base, paddingBottom: space['3xl'] },
  fields: { gap: space.xs },
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.sm,
  },
}));
