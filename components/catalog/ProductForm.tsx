import React, { useCallback, useMemo, useState } from 'react';
import { BrandModelSelect } from './BrandModelSelect';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Plus, ScanLine, Trash2 } from 'lucide-react-native';
import {
  Button,
  Card,
  IconButton,
  ListRow,
  Screen,
  Section,
  SegmentedControl,
  Text,
  TextField,
} from '../ui';
import { SelectSheet } from '../overlay';
import { ScannerSheet } from '../scanner/ScannerSheet';
import { api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { dialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';
import type { Category, ScanResult, TrackingType } from '../../types/api';

/**
 * The one product form (G1) — used by both Create and Edit.
 *
 * Validation and field logic live here once, so the two screens cannot drift
 * apart. The fields mirror the backend DTOs exactly; nothing parallel is
 * invented. In particular there is **no cost or margin field** (cost belongs to
 * receiving), **no IMEI** (that belongs to individual units at receiving) and
 * **no mandatory defect/condition**.
 *
 * The selling price appears only for a caller who actually holds `price.edit`,
 * and only on create — the metadata PATCH has no price field at all, because
 * `catalog.manage` must never imply pricing authority.
 */

/** Mirrors the backend bound so the UI stops before the server has to. */
const MAX_SPECS = 40;

export interface ProductFormValues {
  brand: string;
  model: string;
  variant: string;
  categoryId: string | null;
  trackingType: TrackingType;
  barcode: string;
  specifications: { key: string; value: string }[];
  /** Create-only, and only when `price.edit` is held. */
  defaultPrice: string;
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  initial: ProductFormValues;
  /** False when the backend says history has frozen the tracking mode. */
  canChangeTracking?: boolean;
  submitting: boolean;
  /** Field-level errors keyed by field name, mapped from the backend. */
  errors: Partial<Record<keyof ProductFormValues, string>>;
  onSubmit: (values: ProductFormValues) => void;
  /** Rendered under the save button — e.g. a "open the existing product" action. */
  footerExtra?: React.ReactNode;
  /** Called when a scan resolves to a product that already exists. */
  onKnownBarcode?: (productId: string, label: string) => void;
}

export const emptyProductForm: ProductFormValues = {
  brand: '',
  model: '',
  variant: '',
  categoryId: null,
  trackingType: 'imei',
  barcode: '',
  specifications: [],
  defaultPrice: '',
};

export function ProductForm({
  mode,
  initial,
  canChangeTracking = true,
  submitting,
  errors,
  onSubmit,
  footerExtra,
  onKnownBarcode,
}: ProductFormProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const canSetPrice = usePermission('price.edit');
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [localErrors, setLocalErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});
  const [categorySheet, setCategorySheet] = useState(false);
  const [scanning, setScanning] = useState(false);

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setLocalErrors((e) => ({ ...e, [key]: undefined }));
  };

  /**
   * Inactive categories may not be CHOSEN, but one already attached to this
   * product is kept and shown — silently dropping it on an unrelated edit would
   * lose information the Owner deliberately set.
   */
  const categories = useQuery({
    queryKey: qk.categories,
    queryFn: () => api.get<Category[]>('/categories?includeInactive=true'),
  });
  const selectable = (categories.data ?? []).filter((c) => c.isActive || c.id === initial.categoryId);
  const selected = (categories.data ?? []).find((c) => c.id === values.categoryId) ?? null;
  const keepingInactive = selected !== null && !selected.isActive;

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);

  // Covers the back gesture, the header arrow and the hardware button alike.
  usePreventRemove(dirty && !submitting, ({ data }) => {
    void (async () => {
      const leave = await dialog.confirm({
        title: t('catalog.form.unsaved.title'),
        message: t('catalog.form.unsaved.body'),
        confirmLabel: t('catalog.form.unsaved.confirm'),
        cancelLabel: t('action.cancel'),
        tone: 'danger',
      });
      if (leave) navigation.dispatch(data.action);
    })();
  });

  const handleScan = useCallback(
    (result: ScanResult) => {
      setScanning(false);
      // An IMEI identifies one phone, never a product. Accepting it as a barcode
      // would poison recognition for every unit of that model.
      if (result.kind === 'imei') {
        void dialog.alert({ title: t('catalog.scan.imei.title'), message: t('catalog.scan.imei.body') });
        return;
      }
      // Already known: show it rather than letting a duplicate be created. On
      // edit, the product's OWN barcode is harmless and just fills in.
      const known = result.suggestion;
      if (known && result.recognized && known.productId !== (initial as { id?: string }).id) {
        onKnownBarcode?.(known.productId, [known.brand, known.model, known.variant].filter(Boolean).join(' '));
        return;
      }
      set('barcode', result.code);
      toast.success(t('catalog.scan.filled'));
    },
    [initial, onKnownBarcode, t],
  );

  const submit = () => {
    const next: Partial<Record<keyof ProductFormValues, string>> = {};
    if (!values.brand.trim()) next.brand = t('catalog.form.required');
    if (!values.model.trim()) next.model = t('catalog.form.required');
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    if (mode === 'edit' && !dirty) {
      toast.error(t('catalog.form.noChanges'));
      return;
    }
    onSubmit(values);
  };

  const shown = { ...localErrors, ...errors };

  return (
    <Screen
      gap="xl"
      footer={
        <View style={styles.footer}>
          <Button
            title={t(mode === 'create' ? 'catalog.form.save' : 'catalog.form.saveChanges')}
            onPress={submit}
            loading={submitting}
            disabled={submitting || (mode === 'edit' && !dirty)}
            fullWidth
          />
          {footerExtra}
        </View>
      }
    >
      {/* 1 ── Identity ─────────────────────────────────────────────────────── */}
      <Section title={t('catalog.form.section.identity')}>
        <View style={styles.fields}>
          {/*
            Brand and model were free text, so one shop's stock held `Samsung`,
            `samsung`, `SAMSUNG` and `Sansung` and no report could add them up.
            The selector fixes the spelling without taking away the ability to
            sell something the catalogue has never heard of: `Other brand` and
            `Other model` are ordinary options, and a product typed by hand
            before this list existed still opens, edits and saves.

            It lives in the shared form on purpose — create, edit and every
            intake path get the same behaviour without any of them knowing.
          */}
          <BrandModelSelect
            value={{ brand: values.brand, model: values.model }}
            onChange={(next) => {
              set('brand', next.brand);
              set('model', next.model);
            }}
            brandError={shown.brand}
            modelError={shown.model}
          />
          <TextField
            label={t('catalog.form.variant')}
            hint={t('catalog.form.variant.hint')}
            value={values.variant}
            error={shown.variant}
            onChangeText={(v) => set('variant', v)}
            maxLength={120}
          />
        </View>
      </Section>

      {/* 2 ── Category ─────────────────────────────────────────────────────── */}
      <Section title={t('catalog.form.section.category')}>
        <ListRow
          title={selected ? selected.name : t('catalog.form.category.none')}
          subtitle={keepingInactive ? t('catalog.form.category.inactiveKept') : undefined}
          onPress={() => setCategorySheet(true)}
        />
      </Section>

      {/* 3 ── Tracking ─────────────────────────────────────────────────────── */}
      <Section title={t('catalog.form.section.tracking')}>
        <Card>
          <SegmentedControl
            value={values.trackingType}
            onChange={(v) => canChangeTracking && set('trackingType', v as TrackingType)}
            options={[
              { value: 'imei', label: t('catalog.tracking.imei') },
              { value: 'serial', label: t('catalog.tracking.serial') },
              { value: 'quantity', label: t('catalog.tracking.quantity') },
            ]}
          />
          <Text variant="caption" tone={canChangeTracking ? 'secondary' : 'warning'} style={styles.hint}>
            {/* When history froze it, say so instead of letting the save 409. */}
            {canChangeTracking ? t('catalog.form.tracking.hint') : t('catalog.form.tracking.locked')}
          </Text>
        </Card>
      </Section>

      {/* 4 ── Barcode ──────────────────────────────────────────────────────── */}
      <Section title={t('catalog.form.section.barcode')}>
        <TextField
          label={t('catalog.form.barcode')}
          hint={t('catalog.form.barcode.hint')}
          value={values.barcode}
          error={shown.barcode}
          onChangeText={(v) => set('barcode', v)}
          variant="identifier"
          maxLength={64}
          autoCapitalize="characters"
          trailing={
            // Optional convenience only — typing works with no camera at all.
            <IconButton icon={ScanLine} accessibilityLabel={t('catalog.form.barcode.scan')} onPress={() => setScanning(true)} />
          }
        />
      </Section>

      {/* 5 ── Specifications ───────────────────────────────────────────────── */}
      <Section title={t('catalog.form.section.specs')}>
        {values.specifications.length === 0 ? (
          <Card>
            <Text variant="caption" tone="secondary">
              {t('catalog.form.specs.empty')}
            </Text>
          </Card>
        ) : (
          <View style={styles.fields}>
            {values.specifications.map((row, i) => (
              <View key={i} style={styles.specRow}>
                <View style={styles.specField}>
                  <TextField
                    label={t('catalog.form.specs.name')}
                    value={row.key}
                    onChangeText={(v) =>
                      set(
                        'specifications',
                        values.specifications.map((r, j) => (i === j ? { ...r, key: v } : r)),
                      )
                    }
                    maxLength={60}
                  />
                </View>
                <View style={styles.specField}>
                  <TextField
                    label={t('catalog.form.specs.value')}
                    value={row.value}
                    onChangeText={(v) =>
                      set(
                        'specifications',
                        values.specifications.map((r, j) => (i === j ? { ...r, value: v } : r)),
                      )
                    }
                    maxLength={200}
                  />
                </View>
                <IconButton
                  icon={Trash2}
                  accessibilityLabel={t('action.remove')}
                  onPress={() => set('specifications', values.specifications.filter((_, j) => j !== i))}
                />
              </View>
            ))}
          </View>
        )}
        {shown.specifications ? (
          <Text variant="caption" tone="danger" style={styles.hint}>
            {shown.specifications}
          </Text>
        ) : null}
        <Button
          title={t('catalog.form.specs.add')}
          variant="secondary"
          icon={Plus}
          style={styles.hint}
          disabled={values.specifications.length >= MAX_SPECS}
          onPress={() => set('specifications', [...values.specifications, { key: '', value: '' }])}
        />
      </Section>

      {/* 6 ── Price (create only, and only with real pricing authority) ────── */}
      {mode === 'create' ? (
        <Section title={t('catalog.detail.pricing')}>
          {canSetPrice ? (
            <TextField
              label={t('catalog.form.price')}
              hint={t('catalog.form.price.hint')}
              value={values.defaultPrice}
              error={shown.defaultPrice}
              onChangeText={(v) => set('defaultPrice', v)}
              keyboardType="decimal-pad"
              variant="identifier"
            />
          ) : (
            <Card>
              <Text variant="caption" tone="secondary">
                {t('catalog.form.price.locked')}
              </Text>
            </Card>
          )}
        </Section>
      ) : null}

      <SelectSheet
        open={categorySheet}
        onClose={() => setCategorySheet(false)}
        title={t('catalog.form.category.sheet')}
        items={[{ id: '', name: t('catalog.form.category.none'), isActive: true } as Category, ...selectable]}
        keyExtractor={(c: Category) => c.id}
        labelExtractor={(c: Category) => c.name}
        onSelect={(c: Category) => {
          set('categoryId', c.id === '' ? null : c.id);
          setCategorySheet(false);
        }}
      />

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        onResult={handleScan}
        hint={t('catalog.form.barcode.hint')}
      />
    </Screen>
  );
}

/** Turn form values into the exact create/patch payload the backend accepts. */
export function toProductPayload(v: ProductFormValues, opts: { includePrice: boolean }) {
  const specifications: Record<string, string> = {};
  for (const { key, value } of v.specifications) {
    const k = key.trim();
    if (k) specifications[k] = value.trim();
  }
  const price = Number(v.defaultPrice);
  return {
    brand: v.brand.trim(),
    model: v.model.trim(),
    // Empty optional values are normalized the same way everywhere: omitted.
    ...(v.variant.trim() ? { variant: v.variant.trim() } : {}),
    ...(v.categoryId ? { categoryId: v.categoryId } : {}),
    trackingType: v.trackingType,
    ...(v.barcode.trim() ? { barcode: v.barcode.trim() } : {}),
    ...(Object.keys(specifications).length ? { specifications } : {}),
    ...(opts.includePrice && v.defaultPrice.trim() && Number.isFinite(price) ? { defaultPrice: price } : {}),
  };
}

const styles = StyleSheet.create({
  fields: { gap: space.base },
  hint: { marginTop: space.sm },
  footer: { gap: space.sm },
  specRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs },
  specField: { flex: 1 },
});
