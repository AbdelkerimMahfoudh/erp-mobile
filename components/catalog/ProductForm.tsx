import React, { useCallback, useMemo, useState } from 'react';
import { BrandModelSelect } from './BrandModelSelect';
import { VariantSelect } from './VariantSelect';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from '../../lib/navigation/router-internals';
import { useQuery } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react-native';
import {
  Button,
  Card,
  IconButton,
  ListRow,
  Screen,
  Section,
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

export interface ProductFormValues {
  brand: string;
  model: string;
  variant: string;
  categoryId: string | null;
  trackingType: TrackingType;
  barcode: string;
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

  /**
   * How this product will be received, derived rather than asked.
   *
   * The selected category is the authority — it is what the server derives from
   * too, so what the form shows and what the server does cannot drift apart.
   * With no category chosen there is nothing to derive from, and the backend's
   * own default for an uncategorised product is individual tracking, so that is
   * what is shown.
   *
   * This replaced a device-catalogue brand lookup that existed to stop a phone
   * being counted as a quantity. That guard is no longer needed HERE: the mode
   * is not a choice on this screen any more, so there is no wrong choice to
   * prevent, and one fewer network dependency sits in the create path.
   */
  const derivedTracking: TrackingType = selected?.defaultTrackingType ?? 'imei';

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
      {/* 1 ── Category — chosen first, because it decides everything below ── */}
      <Section title={t('catalog.form.section.category')}>
        <ListRow
          title={selected ? selected.name : t('catalog.form.category.none')}
          subtitle={keepingInactive ? t('catalog.form.category.inactiveKept') : undefined}
          onPress={() => setCategorySheet(true)}
        />
      </Section>

      {/* 2 ── How it is received (derived from the category, never chosen) ─── */}
      <Section title={t('catalog.form.section.tracking')}>
        <Card>
          {/*
            Not a control any more.

            The category decides how its products are received and the server
            enforces it, so a form that let the two disagree could only produce
            a rejection the employee did not cause and cannot fix. This reports
            the consequence of the category chosen above instead of asking a
            question whose answer was never really the user's.

            It also takes the decision out of the daily path entirely: picking
            "Smartphones" is something a shopkeeper already knows, while picking
            "imei" is something they have to be taught.
          */}
          <ListRow
            title={
              derivedTracking === 'quantity'
                ? t('catalog.form.tracking.derived.quantity')
                : t('catalog.form.tracking.derived.imei')
            }
            subtitle={
              selected
                ? t('catalog.form.tracking.derived.from', { category: selected.name })
                : t('catalog.form.tracking.derived.noCategory')
            }
          />
          {!canChangeTracking ? (
            <Text variant="caption" tone="warning" style={styles.hint}>
              {t('catalog.form.tracking.locked')}
            </Text>
          ) : null}
        </Card>
      </Section>


      {/* 3 ── Identity ──────────────────────────────────────────────────────── */}
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
          {/*
            Storage and colour were one free-text box, so a shelf held `128GB`,
            `128 gb`, `128 Go` and `128` — four product rows for one phone.
            Same disease as brand and model, same cure. `Other` keeps every
            value a shop has ever typed, and changing one selector leaves the
            other, and the rest of the form, alone.
          */}
          <VariantSelect
            value={values.variant}
            onChange={(v) => set('variant', v)}
            disabled={false}
          />
        </View>
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

      {/* 5 ── Price (create only, and only with real pricing authority) ────── */}
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

/**
 * Turn form values into the exact create/patch payload the backend accepts.
 *
 * Two fields are deliberately absent.
 *
 * `trackingType` is not sent at all. The category determines it server-side,
 * and sending a second opinion can only agree redundantly or contradict and be
 * refused — so the form states no opinion and cannot be the thing that is wrong.
 *
 * `specifications` is not sent either, now that the free-form Details rows are
 * gone. Omitting the key means "leave it alone" on a PATCH, so every historical
 * value a product already carries survives untouched, stays searchable, and
 * keeps showing on the detail screen. Structured attributes — storage and
 * colour — were never in this object; they live in `variant`.
 */
export function toProductPayload(v: ProductFormValues, opts: { includePrice: boolean }) {
  const price = Number(v.defaultPrice);
  return {
    brand: v.brand.trim(),
    model: v.model.trim(),
    // Empty optional values are normalized the same way everywhere: omitted.
    ...(v.variant.trim() ? { variant: v.variant.trim() } : {}),
    ...(v.categoryId ? { categoryId: v.categoryId } : {}),
    ...(v.barcode.trim() ? { barcode: v.barcode.trim() } : {}),
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
