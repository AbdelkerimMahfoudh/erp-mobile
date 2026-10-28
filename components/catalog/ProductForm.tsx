import React, { useCallback, useMemo, useRef, useState } from 'react';
import { inTreeOrder } from '../../lib/category-label';
import { useCategoryLabel } from '../../lib/use-category-label';
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
  FilterChip,
  IconButton,
  InlineNotice,
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
import { hasKey, useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { dialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';
import {
  builtinKeyOf,
  catalogueCovers,
  categoryFits,
  fieldsFor,
  modesFor,
  specificationsPayload,
  withCategory,
  type FormAttribute,
} from '../../lib/intake-form';
import type { Category, ScanResult, TrackingType } from '../../types/api';

/**
 * The one product form (G1) — used by both Create and Edit.
 *
 * Validation and field logic live here once, so the two screens cannot drift
 * apart. The fields mirror the backend DTOs exactly; nothing parallel is
 * invented. There is **no price and no cost field**: a selling price belongs to
 * the Sale, and a buying cost to the stock it was paid for (D223) — an intake
 * screen that embeds this form asks for the cost itself, beside the stock.
 * There is **no IMEI** either (it belongs to the unit).
 *
 * ## The category decides the form (D223, 2026-10-28)
 *
 * On create the category is chosen first and is required. Until it is, there is
 * no Brand, no Model, no catalogue request and no phone field. Once it is, the
 * tracking mode starts from its suggestion among the modes it allows, the phone
 * catalogue appears only for a phone category, and only its own attributes are
 * asked. Changing it clears what belonged to the previous one
 * (`lib/intake-form.ts`).
 */

export interface ProductFormValues {
  brand: string;
  model: string;
  variant: string;
  categoryId: string | null;
  trackingType: TrackingType;
  barcode: string;
  /** The category's own attributes other than storage and colour, as typed. */
  specifications: Record<string, string>;
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  initial: ProductFormValues;
  /**
   * What the scan that opened this form classified the code as, when it opened
   * from one. It narrows the modes and the categories offered — an IMEI is one
   * phone, a serial one device, a product barcode a counted model — and is never
   * decided silently.
   */
  suggestedFromScan?: TrackingType | null;
  /** The modes the scan leaves possible (`restrictionForScan`); null when nothing was scanned. */
  scanRestriction?: readonly TrackingType[] | null;
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
  /** The save button's words, when they are not "Save" — intake says what happens next. */
  submitLabel?: string;
  /** Shown above the fields: what saving this form does, and does not, do. */
  notice?: React.ReactNode;
  /** Rendered after the product's own fields — intake's stock details — once a category is chosen. */
  renderExtra?: (values: ProductFormValues) => React.ReactNode;
  /** Every value change, for a screen that renders stock details beside the form. */
  onValuesChange?: (values: ProductFormValues) => void;
  /**
   * Set to true by the screen just before it leaves on purpose — after a save,
   * a hand-back or a committed intake. The unsaved-changes guard then lets the
   * navigation through instead of asking. A ref, not a prop value: the guard
   * must see it in the same tick as the `router.back()` that follows it.
   */
  allowLeaveRef?: React.MutableRefObject<boolean>;
}

export const emptyProductForm: ProductFormValues = {
  brand: '',
  model: '',
  variant: '',
  categoryId: null,
  trackingType: 'imei',
  barcode: '',
  specifications: {},
};

export function ProductForm({
  mode,
  initial,
  suggestedFromScan = null,
  scanRestriction = null,
  canChangeTracking = true,
  submitting,
  errors,
  onSubmit,
  footerExtra,
  onKnownBarcode,
  submitLabel,
  notice,
  renderExtra,
  onValuesChange,
  allowLeaveRef,
}: ProductFormProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [values, setValuesState] = useState<ProductFormValues>(initial);
  const [localErrors, setLocalErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});
  const [categorySheet, setCategorySheet] = useState(false);
  const [scanning, setScanning] = useState(false);

  const setValues = (update: (v: ProductFormValues) => ProductFormValues) => {
    setValuesState((v) => {
      const next = update(v);
      onValuesChange?.(next);
      return next;
    });
  };
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
  const label = useCategoryLabel();
  const all = categories.data ?? [];
  /** "Phones › Smartphones": a subcategory names its parent, so two "Other" never look alike. */
  const fullLabel = (c: Category) => {
    const parent = c.parentId ? all.find((p) => p.id === c.parentId) : undefined;
    return parent ? `${label(parent)} › ${label(c)}` : label(c);
  };
  // Only categories the scanned code can go into: an IMEI is never offered Cables.
  const selectable = inTreeOrder(
    all.filter((c) => (c.isActive || c.id === initial.categoryId) && (c.id === initial.categoryId || categoryFits(c, scanRestriction))),
    label,
  ).map((row) => row.category);
  const selected = all.find((c) => c.id === values.categoryId) ?? null;
  const keepingInactive = selected !== null && !selected.isActive;
  const requiresCategory = mode === 'create';
  const categoryChosen = selected !== null || (!requiresCategory && values.categoryId === null);

  const modes = selected ? modesFor(selected, scanRestriction) : [];
  const fields = fieldsFor(selected);
  const usesCatalogue = selected !== null && catalogueCovers(builtinKeyOf(selected, all));

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);

  /*
   * Covers the back gesture, the header arrow and the hardware button alike.
   *
   * The device test of 2026-10-28 froze the app here: a successful hand-back
   * cleared `submitting` and THEN navigated, so this guard stopped the screen's
   * own exit, the native stack popped anyway, and the confirm sat invisible over
   * every touch. Now a deliberate exit sets `allowLeaveRef` first and passes
   * straight through, and only one confirm can be up at a time.
   */
  const asking = useRef(false);
  usePreventRemove(dirty && !submitting, ({ data }) => {
    if (allowLeaveRef?.current) {
      navigation.dispatch(data.action);
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void (async () => {
      try {
        const leave = await dialog.confirm({
          title: t('catalog.form.unsaved.title'),
          message: t('catalog.form.unsaved.body'),
          confirmLabel: t('catalog.form.unsaved.confirm'),
          cancelLabel: t('action.cancel'),
          tone: 'danger',
        });
        if (leave) navigation.dispatch(data.action);
      } finally {
        asking.current = false;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial, onKnownBarcode, t],
  );

  const submit = () => {
    const next: Partial<Record<keyof ProductFormValues, string>> = {};
    if (requiresCategory && !selected) next.categoryId = t('catalog.form.category.required');
    else {
      if (!values.brand.trim()) next.brand = t('catalog.form.required');
      if (!values.model.trim()) next.model = t('catalog.form.required');
    }
    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;
    if (mode === 'edit' && !dirty) {
      toast.error(t('catalog.form.noChanges'));
      return;
    }
    onSubmit(values);
  };

  const shown = { ...localErrors, ...errors };
  const attributeLabel = (a: FormAttribute) => {
    const name = hasKey(`catalog.attr.${a.key}`) ? t(`catalog.attr.${a.key}` as never) : a.label;
    return a.unit ? `${name} (${a.unit})` : name;
  };
  const optionLabel = (o: string) => (hasKey(`catalog.attrOption.${o}`) ? t(`catalog.attrOption.${o}` as never) : o);

  return (
    <Screen
      gap="xl"
      footer={
        <View style={styles.footer}>
          <Button
            title={submitLabel ?? t(mode === 'create' ? 'catalog.form.save' : 'catalog.form.saveChanges')}
            onPress={submit}
            loading={submitting}
            disabled={submitting || (mode === 'edit' && !dirty) || (requiresCategory && !selected)}
            fullWidth
          />
          {footerExtra}
        </View>
      }
    >
      {notice}
      {/* 1 ── Category — chosen first, because it decides everything below ── */}
      <Section title={t('catalog.form.section.category')}>
        <ListRow
          title={selected ? fullLabel(selected) : requiresCategory ? t('catalog.form.category.required') : t('catalog.form.category.none')}
          subtitle={keepingInactive ? t('catalog.form.category.inactiveKept') : shown.categoryId}
          onPress={() => setCategorySheet(true)}
        />
        {requiresCategory && !selected ? <InlineNotice tone="info">{t('catalog.form.category.first')}</InlineNotice> : null}
      </Section>

      {categoryChosen ? (
        <>
          {/* 2 ── How it is counted: suggested by the category, among the modes it allows ── */}
          <Section title={t('catalog.form.section.tracking')}>
            <Card style={styles.tracking}>
              <Text variant="caption" tone="secondary">
                {t('catalog.form.tracking.choose')}
              </Text>
              <View style={styles.trackingChoices} accessibilityRole="radiogroup">
                {(selected ? modes : (['imei', 'serial', 'quantity'] as TrackingType[])).map((m) => (
                  <FilterChip
                    key={m}
                    label={t(`catalog.tracking.${m}`)}
                    selected={values.trackingType === m}
                    onPress={() => canChangeTracking && set('trackingType', m)}
                  />
                ))}
              </View>
              <Text variant="caption" tone="tertiary">
                {selected
                  ? t('catalog.form.tracking.suggestedBy', { category: label(selected) })
                  : suggestedFromScan && values.trackingType === suggestedFromScan
                    ? t(`catalog.form.tracking.suggested.${suggestedFromScan}` as never)
                    : t('catalog.form.tracking.derived.noCategory')}
              </Text>
              {!canChangeTracking ? (
                <Text variant="caption" tone="warning" style={styles.hint}>
                  {t('catalog.form.tracking.locked')}
                </Text>
              ) : null}
            </Card>
          </Section>

          {/* 3 ── Identity: the phone catalogue only for a phone category ───── */}
          <Section title={t('catalog.form.section.identity')}>
            <View style={styles.fields}>
              {usesCatalogue ? (
                <BrandModelSelect
                  value={{ brand: values.brand, model: values.model }}
                  onChange={(next) => {
                    set('brand', next.brand);
                    set('model', next.model);
                  }}
                  brandError={shown.brand}
                  modelError={shown.model}
                />
              ) : (
                <>
                  <TextField
                    label={t('catalog.form.brand')}
                    hint={t('catalog.form.brand.manual.hint')}
                    value={values.brand}
                    error={shown.brand}
                    onChangeText={(v) => set('brand', v)}
                    maxLength={80}
                  />
                  <TextField
                    label={t('catalog.form.model')}
                    hint={t('catalog.form.model.manual.hint')}
                    value={values.model}
                    error={shown.model}
                    onChangeText={(v) => set('model', v)}
                    maxLength={120}
                  />
                </>
              )}
              {fields.storage || fields.colour ? (
                <VariantSelect
                  value={values.variant}
                  onChange={(v) => set('variant', v)}
                  storage={fields.storage}
                  colour={fields.colour}
                />
              ) : null}
            </View>
          </Section>

          {/* 4 ── The category's other attributes ───────────────────────────── */}
          {fields.others.length > 0 ? (
            <Section title={t('catalog.form.section.details')}>
              <View style={styles.fields}>
                {fields.others.map((a) =>
                  a.type === 'enum' && a.options?.length ? (
                    <View key={a.key} style={styles.tracking}>
                      <Text variant="caption" tone="secondary">
                        {attributeLabel(a)}
                      </Text>
                      <View style={styles.trackingChoices}>
                        {a.options.map((o) => (
                          <FilterChip
                            key={o}
                            label={optionLabel(o)}
                            selected={values.specifications[a.key] === o}
                            onPress={() =>
                              set('specifications', {
                                ...values.specifications,
                                [a.key]: values.specifications[a.key] === o ? '' : o,
                              })
                            }
                          />
                        ))}
                      </View>
                    </View>
                  ) : (
                    <TextField
                      key={a.key}
                      label={attributeLabel(a)}
                      value={values.specifications[a.key] ?? ''}
                      onChangeText={(v) => set('specifications', { ...values.specifications, [a.key]: v })}
                      keyboardType={a.type === 'number' || a.type === 'measurement' ? 'decimal-pad' : 'default'}
                      maxLength={80}
                    />
                  ),
                )}
              </View>
            </Section>
          ) : null}

          {/* 5 ── Barcode ──────────────────────────────────────────────────────── */}
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

          {renderExtra?.(values)}
        </>
      ) : null}

      <SelectSheet
        open={categorySheet}
        onClose={() => setCategorySheet(false)}
        title={t('catalog.form.category.sheet')}
        items={requiresCategory ? selectable : [{ id: '', name: t('catalog.form.category.none'), isActive: true } as Category, ...selectable]}
        keyExtractor={(c: Category) => c.id}
        labelExtractor={(c: Category) => (c.id ? fullLabel(c) : c.name)}
        onSelect={(c: Category) => {
          setCategorySheet(false);
          setLocalErrors((e) => ({ ...e, categoryId: undefined }));
          if (c.id === '') {
            set('categoryId', null);
            return;
          }
          setValues((v) => withCategory(v, c, scanRestriction));
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
 * The mode is always sent: the category RECOMMENDS it and the Owner may choose
 * another it allows (D223), and the server refuses one it does not. The
 * category's own attributes go in `specifications`, only those filled in, typed
 * as the schema says. No price, ever: intake records the buying cost, and the
 * Sale decides the price.
 */
export function toProductPayload(v: ProductFormValues, category?: Category | null) {
  const specifications = specificationsPayload(fieldsFor(category ?? null).others, v.specifications);
  return {
    brand: v.brand.trim(),
    model: v.model.trim(),
    // Empty optional values are normalized the same way everywhere: omitted.
    ...(v.variant.trim() ? { variant: v.variant.trim() } : {}),
    ...(v.categoryId ? { categoryId: v.categoryId } : {}),
    trackingType: v.trackingType,
    ...(v.barcode.trim() ? { barcode: v.barcode.trim() } : {}),
    ...(specifications ? { specifications } : {}),
  };
}

const styles = StyleSheet.create({
  tracking: { gap: space.sm },
  trackingChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  fields: { gap: space.base },
  hint: { marginTop: space.sm },
  footer: { gap: space.sm },
});
