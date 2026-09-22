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

  /**
   * Four states, kept apart, because collapsing them is what produced the
   * defect a device found.
   *
   * The list was fetched into an array and nothing recorded WHY the array might
   * be empty. An empty array from a failed request looked exactly like an empty
   * array from a search that matched nothing — so a request failure rendered
   * "Nothing matches" and "The list could not be loaded" at the same time, and
   * offered no way to try again.
   *
   * `loading` is the initial state on purpose: showing an empty chooser while
   * a request is in flight is the same lie in a smaller font.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  /** Bumped by Retry, which is all Retry has to do. */
  const [attempt, setAttempt] = useState(0);

  const [storageOpen, setStorageOpen] = useState(false);
  const [colourOpen, setColourOpen] = useState(false);
  const [storageQuery, setStorageQuery] = useState('');
  const [colourQuery, setColourQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void fetchAttributes().then((r) => {
      if (cancelled) return;
      if (!r.attributes) {
        // Nothing came back and no cached copy exists. That is an ERROR, not an
        // empty list, and the two must never read the same on screen.
        setOrigin(r.origin);
        setStatus('error');
        return;
      }
      setStorage(r.attributes.storage);
      setColour(r.attributes.colour);
      setSeparator(r.attributes.separator);
      setOrigin(r.origin);
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => setAttempt((n) => n + 1);

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

  /**
   * One chooser body, used by both selectors.
   *
   * Written once so Storage and Colour cannot drift apart — the defect report
   * described both behaving identically wrongly, and two copies of this would
   * eventually mean two behaviours.
   *
   * The states are mutually exclusive and rendered in order of what the person
   * needs to know. Nothing here can produce "Nothing matches" and "could not be
   * loaded" together, because a failure returns before the filter is consulted.
   */
  const chooserBody = (
    options: AttributeOption[],
    visible: AttributeOption[],
    query: string,
    selectedKey: string | null,
    onChoose: (o: AttributeOption) => void,
  ) => {
    if (status === 'loading') {
      return (
        <Text variant="caption" tone="secondary" style={styles.empty}>
          {t('catalog.select.loading')}
        </Text>
      );
    }

    if (status === 'error') {
      /*
       * A real failure: say so, and offer the way out of it. Manual entry stays
       * available underneath — an unreachable list must never block booking a
       * phone in — but it is a fallback, not the answer.
       */
      return (
        <View style={styles.list}>
          <Text variant="caption" tone="warning" style={styles.empty}>
            {t('catalog.select.unavailable')}
          </Text>
          <ListRow title={t('action.retry')} onPress={retry} />
        </View>
      );
    }

    // Loaded, and genuinely nothing in it. Different from a failure, and from
    // a search that matched nothing.
    if (options.length === 0) {
      return (
        <Text variant="caption" tone="secondary" style={styles.empty}>
          {t('catalog.select.empty')}
        </Text>
      );
    }

    // Loaded, populated, and the SEARCH excluded everything. The list is fine;
    // the query is the problem, and saying "could not be loaded" here would be
    // a lie about a working list.
    if (visible.length === 0) {
      return (
        <Text variant="caption" tone="secondary" style={styles.empty}>
          {t('catalog.select.noMatch', { query })}
        </Text>
      );
    }

    return (
      <>
        {visible.map((o) => (
          <ListRow
            key={o.key}
            title={o.key === OTHER_KEY ? t('catalog.variant.other') : o.label}
            // Marked with a tick AND the row's own label — never colour alone.
            accessory={
              selectedKey === o.key ? <Check size={18} color={colors.brand[600]} /> : undefined
            }
            onPress={() => onChoose(o)}
          />
        ))}
      </>
    );
  };

  return (
    <View style={styles.wrap}>
      {/* ── Storage ───────────────────────────────────────────────────────── */}
      <Card style={styles.card}>
        <ListRow
          flat
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
            {chooserBody(storage, visibleStorage, storageQuery, parts.storageKey, chooseStorage)}
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
          flat
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
            {chooserBody(colour, visibleColour, colourQuery, parts.colourKey, chooseColour)}
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
      {/*
        Only the CACHED case is reported here now. A failure belongs inside the
        chooser next to its Retry — reporting it out here as well is what put
        two contradictory messages on screen at once.
      */}
      {status === 'ready' && origin === 'cached' ? (
        <Text variant="caption" tone="secondary">
          {t('catalog.select.offline')}
        </Text>
      ) : null}

      {/*
        The bundled baseline is in use.

        Non-blocking on purpose: the options below are real and selectable, so
        this is a note, not an error. It is still a WARNING tone rather than a
        quiet aside, because the newest options genuinely could not be fetched
        and the shopkeeper should know before they conclude a capacity is
        missing. Retry sits with it, so acting on the note takes one tap.
      */}
      {status === 'ready' && origin === 'fallback' ? (
        <View style={styles.list}>
          <Text variant="caption" tone="warning">
            {t('catalog.select.fallback')}
          </Text>
          <ListRow title={t('action.retry')} onPress={retry} />
        </View>
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
