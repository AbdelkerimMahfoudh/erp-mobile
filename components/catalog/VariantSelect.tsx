import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Card, ListRow, SearchInput, Text, TextField } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import {
  fetchAttributes,
  matches,
  type AttributeOption,
  type CatalogueOrigin,
} from '../../lib/device-catalogue';
import { OTHER_KEY, composeVariant, parseVariant, type VariantParts } from '../../lib/variant.ts';

/**
 * Storage and colour, as lists instead of a text box.
 *
 * ## Why this replaced one free-text field
 *
 * `variant` was a single box holding storage and colour together, and it caught
 * the same disease brand and model had: one shop's shelf held `128GB`,
 * `128 gb`, `128 Go` and `128`, which is four product rows, four lines in every
 * report, and a count somebody had to add up by eye. Same cure as the brand and
 * model selectors, for the same reason.
 *
 * ## Two selectors, not three
 *
 * There is no market or region list here, and that is a finding rather than an
 * omission: `schema.prisma` states that `products.variant` carries storage and
 * colour, and nothing in the schema has ever recorded a region. Adding one
 * would put a fourth term into the `(company, brand, model, variant)` unique
 * key — a new product row per market, for a distinction no shop has made.
 *
 * `Pro`, `Plus` and `Ultra` are absent for the opposite reason: they are part
 * of the model name and already arrive from the model selector. Offering them
 * again here would file one phone under two identities.
 *
 * ## Typing still works, and old values still open
 *
 * `Other` is an ordinary row at the end of each list, not an error state.
 * Choosing it reveals a field and the typed value is stored verbatim. A product
 * saved years ago with `Dual SIM export unit` opens showing exactly that, ready
 * to edit — and with no signal and no cached lists, everything falls back to
 * that same field rather than to a blocked form.
 *
 * ## Changing one selector never touches the other
 *
 * Picking a colour leaves the storage alone, and vice versa. Nothing else on
 * the form is touched either: somebody correcting the colour must not lose the
 * cost they just typed.
 */

export interface VariantSelectProps {
  /** The stored `variant` string. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function VariantSelect({ value, onChange, disabled = false }: VariantSelectProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();

  const [storage, setStorage] = useState<AttributeOption[]>([]);
  const [colour, setColour] = useState<AttributeOption[]>([]);
  const [separator, setSeparator] = useState(' · ');
  const [origin, setOrigin] = useState<CatalogueOrigin>('live');

  const [storageOpen, setStorageOpen] = useState(false);
  const [colourOpen, setColourOpen] = useState(false);
  const [storageQuery, setStorageQuery] = useState('');
  const [colourQuery, setColourQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchAttributes().then((r) => {
      if (cancelled || !r.attributes) {
        if (!cancelled) setOrigin(r.origin);
        return;
      }
      setStorage(r.attributes.storage);
      setColour(r.attributes.colour);
      setSeparator(r.attributes.separator);
      setOrigin(r.origin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Derived from the stored string every render, never held separately.
   *
   * A second copy of the selection would be a second truth, and the two would
   * disagree the first time the form was reset or reloaded with a draft.
   */
  const parts = parseVariant(value, storage, colour, separator);

  const apply = (next: VariantParts) => onChange(composeVariant(next, storage, colour, separator));

  const chooseStorage = (option: AttributeOption) => {
    // Colour is untouched. Only the half that was chosen changes.
    apply({ ...parts, storageKey: option.key, storageCustom: '' });
    setStorageOpen(false);
    setStorageQuery('');
  };

  const chooseColour = (option: AttributeOption) => {
    apply({ ...parts, colourKey: option.key, colourCustom: '' });
    setColourOpen(false);
    setColourQuery('');
  };

  const labelOf = (options: AttributeOption[], key: string | null, custom: string) => {
    if (key === OTHER_KEY) return custom.trim() || t('catalog.variant.other');
    return options.find((o) => o.key === key)?.label ?? '';
  };

  const storageLabel = labelOf(storage, parts.storageKey, parts.storageCustom);
  const colourLabel = labelOf(colour, parts.colourKey, parts.colourCustom);

  const visibleStorage = storage.filter((o) => matches(o.label + ' ' + o.key, storageQuery));
  const visibleColour = colour.filter((o) => matches(o.label + ' ' + o.key, colourQuery));

  return (
    <View style={styles.wrap}>
      {/* ── Storage ───────────────────────────────────────────────────────── */}
      <Card style={styles.card}>
        <ListRow
          title={t('catalog.form.storage')}
          value={storageLabel || t('catalog.select.choose')}
          valueTone={storageLabel ? 'primary' : 'secondary'}
          onPress={disabled ? undefined : () => setStorageOpen((v) => !v)}
        />

        {storageOpen ? (
          <View style={styles.list}>
            <SearchInput
              value={storageQuery}
              onChangeText={setStorageQuery}
              placeholder={t('catalog.select.searchStorage')}
            />
            {visibleStorage.map((o) => (
              <ListRow
                key={o.key}
                title={o.key === OTHER_KEY ? t('catalog.variant.other') : o.label}
                // Marked with a tick AND the row's own label — never colour alone.
                accessory={
                  parts.storageKey === o.key ? <Check size={18} color={colors.brand[600]} /> : undefined
                }
                onPress={() => chooseStorage(o)}
              />
            ))}
            {visibleStorage.length === 0 ? (
              <Text variant="caption" tone="secondary" style={styles.empty}>
                {t('catalog.select.noMatch')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/*
          The manual field, shown when `Other` is chosen — and also whenever the
          lists could not be loaded, so no signal never means no stock intake.
        */}
        {parts.storageKey === OTHER_KEY || (storage.length === 0 && parts.storageCustom) ? (
          <TextField
            label={t('catalog.form.storage.manual')}
            hint={t('catalog.form.storage.manual.hint')}
            value={parts.storageCustom}
            editable={!disabled}
            onChangeText={(v) => apply({ ...parts, storageKey: OTHER_KEY, storageCustom: v })}
            maxLength={40}
          />
        ) : null}
      </Card>

      {/* ── Colour ────────────────────────────────────────────────────────── */}
      <Card style={styles.card}>
        <ListRow
          title={t('catalog.form.colour')}
          value={colourLabel || t('catalog.select.choose')}
          valueTone={colourLabel ? 'primary' : 'secondary'}
          onPress={disabled ? undefined : () => setColourOpen((v) => !v)}
        />

        {colourOpen ? (
          <View style={styles.list}>
            <SearchInput
              value={colourQuery}
              onChangeText={setColourQuery}
              placeholder={t('catalog.select.searchColour')}
            />
            {visibleColour.map((o) => (
              <ListRow
                key={o.key}
                title={o.key === OTHER_KEY ? t('catalog.variant.other') : o.label}
                accessory={
                  parts.colourKey === o.key ? <Check size={18} color={colors.brand[600]} /> : undefined
                }
                onPress={() => chooseColour(o)}
              />
            ))}
            {visibleColour.length === 0 ? (
              <Text variant="caption" tone="secondary" style={styles.empty}>
                {t('catalog.select.noMatch')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {parts.colourKey === OTHER_KEY || (colour.length === 0 && parts.colourCustom) ? (
          <TextField
            label={t('catalog.form.colour.manual')}
            hint={t('catalog.form.colour.manual.hint')}
            value={parts.colourCustom}
            editable={!disabled}
            onChangeText={(v) => apply({ ...parts, colourKey: OTHER_KEY, colourCustom: v })}
            maxLength={60}
          />
        ) : null}
      </Card>

      {/*
        Said in words when the lists came from a stored copy or not at all —
        never left to be inferred from a short list.
      */}
      {origin !== 'live' ? (
        <Text variant="caption" tone="secondary">
          {origin === 'cached' ? t('catalog.select.offline') : t('catalog.select.unavailable')}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.md },
  card: { gap: space.sm },
  list: { gap: space.xs },
  empty: { paddingVertical: space.sm },
}));
