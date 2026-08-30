import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Card, InlineNotice, ListRow, SearchInput, Text, TextField } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import {
  fetchBrands,
  fetchModels,
  matches,
  OTHER_BRAND_KEY,
  type CatalogueBrand,
  type CatalogueModel,
  type CatalogueOrigin,
} from '../../lib/device-catalogue';

/**
 * Choosing a phone: brand first, then the models of that brand.
 *
 * ## Why this replaced two text boxes
 *
 * "Brand" and "Model" were free text, so one shop's stock held `Samsung`,
 * `samsung`, `SAMSUNG` and `Sansung`, and no report could add them up. A list
 * fixes the spelling without taking away the ability to sell something the list
 * has never heard of.
 *
 * ## Typing is never a failure
 *
 * `Other brand` and `Other model` are ordinary options, not error states. A
 * shop that receives a handset nobody has catalogued must be able to book it in
 * **now**, so the manual field is one tap away and carries no warning. The
 * catalogue is a source of choices, not a constraint on what a product may be
 * called — and a legacy product whose brand was typed years ago still opens,
 * still edits and still saves.
 *
 * ## Changing the brand
 *
 * A model belongs to a brand, so changing the brand invalidates the model. That
 * is explained before it happens rather than silently repaired: somebody who
 * picked the wrong brand and is one tap from losing "Galaxy A16" should be told
 * so, and nothing else on the form is touched.
 */

export interface BrandModelValue {
  brand: string;
  model: string;
}

export interface BrandModelSelectProps {
  value: BrandModelValue;
  onChange: (next: BrandModelValue) => void;
  brandError?: string;
  modelError?: string;
  disabled?: boolean;
}

/** Free text that does not match a catalogue row — a legacy or manual value. */
const isCustom = (value: string, known: { name: string }[]) =>
  value.trim().length > 0 && !known.some((k) => k.name.toLowerCase() === value.trim().toLowerCase());

export function BrandModelSelect({
  value,
  onChange,
  brandError,
  modelError,
  disabled = false,
}: BrandModelSelectProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();

  const [brands, setBrands] = useState<CatalogueBrand[]>([]);
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [origin, setOrigin] = useState<CatalogueOrigin>('live');

  const [brandOpen, setBrandOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');

  /**
   * Which brand row the current text corresponds to, if any.
   *
   * Derived rather than stored, so a legacy product carrying `samsung` in
   * lower case opens with Samsung selected instead of looking broken.
   */
  const selectedBrand = brands.find(
    (b) => b.name.toLowerCase() === value.brand.trim().toLowerCase(),
  );

  /*
   * Manual entry is a MODE somebody chose, not a state inferred from an empty
   * field. Inferring it meant a brand-new form opened with "type the brand"
   * already showing, which is the opposite of offering a list.
   *
   * It starts on for a value the catalogue does not know — a product typed by
   * hand long before this list existed opens ready to edit rather than looking
   * broken.
   */
  const [brandMode, setBrandMode] = useState<'catalogue' | 'manual'>('catalogue');
  const [modelMode, setModelMode] = useState<'catalogue' | 'manual'>('catalogue');

  useEffect(() => {
    if (brands.length > 0 && value.brand.trim() && !selectedBrand) setBrandMode('manual');
  }, [brands.length, selectedBrand, value.brand]);

  useEffect(() => {
    if (models.length > 0 && isCustom(value.model, models)) setModelMode('manual');
  }, [models, value.model]);

  useEffect(() => {
    let cancelled = false;
    void fetchBrands().then((r) => {
      if (cancelled) return;
      setBrands(r.items);
      setOrigin(r.origin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Models follow the brand. Loaded only once a brand is chosen, because
   * "every model of every brand" is a list nobody can use and a request nobody
   * should make on a phone.
   */
  /*
   * The KEY, not the object. `find` returns a new reference every render, so
   * depending on the object would refetch the model list on every keystroke.
   */
  const selectedBrandKey = selectedBrand?.key ?? null;

  useEffect(() => {
    if (!selectedBrandKey || selectedBrandKey === OTHER_BRAND_KEY) {
      setModels([]);
      return;
    }
    let cancelled = false;
    void fetchModels(selectedBrandKey).then((r) => {
      if (!cancelled) setModels(r.items);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedBrandKey]);

  const chooseBrand = useCallback(
    (brand: CatalogueBrand) => {
      /*
       * A model belongs to a brand. Changing the brand clears the model — and
       * only the model. Nothing else on the form is touched, so somebody who
       * picked Samsung by mistake does not lose the cost they just typed.
       */
      const keepsModel = brand.name.toLowerCase() === value.brand.trim().toLowerCase();
      const other = brand.key === OTHER_BRAND_KEY;
      setBrandMode(other ? 'manual' : 'catalogue');
      // A brand from the catalogue means its models are worth offering again.
      if (!other) setModelMode('catalogue');
      onChange({
        brand: other ? '' : brand.name,
        model: keepsModel ? value.model : '',
      });
      setBrandOpen(false);
      setBrandQuery('');
    },
    [onChange, value.brand, value.model],
  );

  const visibleBrands = brands.filter((b) => matches(b.name + ' ' + b.key, brandQuery));
  const visibleModels = models.filter((m) => matches(m.name + ' ' + m.family, modelQuery));

  return (
    <View style={styles.wrap}>
      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <Card style={styles.card}>
        <ListRow
          title={t('catalog.form.brand')}
          value={value.brand.trim() || t('catalog.select.choose')}
          valueTone={value.brand.trim() ? 'primary' : 'secondary'}
          onPress={disabled ? undefined : () => setBrandOpen((v) => !v)}
        />

        {brandOpen ? (
          <View style={styles.list}>
            <SearchInput
              value={brandQuery}
              onChangeText={setBrandQuery}
              placeholder={t('catalog.select.searchBrand')}
            />
            {visibleBrands.map((b) => (
              <ListRow
                key={b.key}
                title={b.name}
                // Marked, never carried by colour alone.
                accessory={
                  b.name.toLowerCase() === value.brand.trim().toLowerCase() ? (
                    <Check size={18} color={colors.brand[600]} />
                  ) : undefined
                }
                selected={b.name.toLowerCase() === value.brand.trim().toLowerCase()}
                chevron={false}
                onPress={() => chooseBrand(b)}
              />
            ))}
          </View>
        ) : null}
      </Card>

      {/*
        The manual brand field, shown when the catalogue has no row for what is
        typed — whether somebody just chose `Other brand`, or opened a product
        whose brand was typed by hand long before this list existed.
      */}
      {brandMode === 'manual' ? (
        <TextField
          label={t('catalog.form.brand.manual')}
          hint={t('catalog.form.brand.manual.hint')}
          required
          value={value.brand}
          error={brandError}
          editable={!disabled}
          onChangeText={(v) => onChange({ ...value, brand: v })}
          maxLength={80}
        />
      ) : null}
      {brandError && brandMode !== 'manual' ? (
        <Text variant="caption" tone="danger">
          {brandError}
        </Text>
      ) : null}

      {/* ── Model ─────────────────────────────────────────────────────────── */}
      <Card style={styles.card}>
        <ListRow
          title={t('catalog.form.model')}
          value={
            value.model.trim() ||
            (value.brand.trim() ? t('catalog.select.choose') : t('catalog.select.brandFirst'))
          }
          valueTone={value.model.trim() ? 'primary' : 'secondary'}
          // Disabled until a brand is chosen: the list depends on it.
          onPress={disabled || !value.brand.trim() ? undefined : () => setModelOpen((v) => !v)}
        />

        {modelOpen && value.brand.trim() ? (
          <View style={styles.list}>
            <SearchInput
              value={modelQuery}
              onChangeText={setModelQuery}
              placeholder={t('catalog.select.searchModel')}
            />
            {visibleModels.map((m) => (
              <ListRow
                key={m.id}
                title={m.name}
                subtitle={m.family}
                accessory={
                  m.name.toLowerCase() === value.model.trim().toLowerCase() ? (
                    <Check size={18} color={colors.brand[600]} />
                  ) : undefined
                }
                selected={m.name.toLowerCase() === value.model.trim().toLowerCase()}
                chevron={false}
                onPress={() => {
                  setModelMode('catalogue');
                  onChange({ ...value, model: m.name });
                  setModelOpen(false);
                  setModelQuery('');
                }}
              />
            ))}
            {/* Always last, always present, never an error state. */}
            <ListRow
              title={t('catalog.select.otherModel')}
              chevron={false}
              onPress={() => {
                setModelMode('manual');
                onChange({ ...value, model: '' });
                setModelOpen(false);
                setModelQuery('');
              }}
            />
          </View>
        ) : null}
      </Card>

      {modelMode === 'manual' && !modelOpen ? (
        <TextField
          label={t('catalog.form.model.manual')}
          hint={t('catalog.form.model.manual.hint')}
          required
          value={value.model}
          error={modelError}
          editable={!disabled}
          onChangeText={(v) => onChange({ ...value, model: v })}
          maxLength={120}
        />
      ) : null}

      {/*
        Said plainly when it is true. A stored copy is still useful — the names
        have not changed — but the app must not imply it just asked the server.
      */}
      {origin === 'cached' ? (
        <InlineNotice tone="info" title={t('catalog.select.offline')}>
          <Text variant="caption" tone="secondary">
            {t('catalog.select.offline.body')}
          </Text>
        </InlineNotice>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.sm },
  card: { paddingVertical: space.xs },
  list: { gap: space.xs, paddingHorizontal: space.xs, paddingBottom: space.xs },
}));
