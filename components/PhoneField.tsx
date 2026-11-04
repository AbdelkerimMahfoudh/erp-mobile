import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { ListRow, Text, TextField, type TextFieldProps } from './ui';
import { BottomSheet } from './overlay';
import { space, type as typeScale } from '../lib/design/tokens';
import { useColors } from '../lib/design/theme';
import { useTranslation } from '../lib/i18n';
import { composePhone, countriesFor, countryName, countryOf, searchCountries, splitPhone, typedInternational, type PhoneCountry } from '../lib/phone-input';

type PhoneFieldProps = Omit<TextFieldProps, 'value' | 'onChangeText' | 'keyboardType' | 'variant' | 'leading'> & {
  /** One international string, or empty. */
  value: string;
  onChangeText: (value: string) => void;
  /** The field's own text, for a caller that keeps what was typed (the sign-in field, post-Build-4). */
  onTypedChange?: (typed: string) => void;
};

/** A row's height in the country list: fixed, so the list can open on the chosen country. */
const ROW = 64;

/**
 * A person's phone number, everywhere one is asked for (D227; post-Build-4). Quiet until the first digit, then the
 * country code beside the number on the same row — a fixed-width area, a divider, the number — left to right in every
 * language, the code read first. The code opens every country and territory, in the reading language's alphabetical
 * order, with a search fixed above the list (name, English name, ISO code or calling code) and the chosen country in
 * view. What is typed is never rewritten; the form receives one international string, and the server still decides.
 * Never for an IMEI, a price or a payer's account number.
 */
export const PhoneField = forwardRef<TextInputInstance, PhoneFieldProps>(function PhoneField({ value, onChangeText, onTypedChange, ...rest }, ref) {
  const [iso, setIso] = useState(() => splitPhone(value).iso);
  const [typed, setTyped] = useState(() => splitPhone(value).national);
  const sent = useRef(value);

  // A value from outside (a loaded profile, a cleared form) replaces what is here; our own echo does not.
  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    const next = splitPhone(value, iso);
    setIso(next.iso);
    setTyped(next.national);
  }, [value, iso]);

  const emit = (nextIso: string, nextTyped: string) => {
    const composed = composePhone(nextIso, nextTyped);
    sent.current = composed;
    onChangeText(composed);
  };

  const showCode = typed.trim() !== '' && !typedInternational(typed);

  return (
    <>
      <TextField
        ref={ref}
        {...rest}
        value={typed}
        onChangeText={(next) => {
          setTyped(next);
          onTypedChange?.(next);
          emit(iso, next);
        }}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        variant="identifier"
        leading={showCode ? <CountryCodeChooser iso={iso} onChange={(next) => { setIso(next); emit(next, typed); }} /> : undefined}
      />
    </>
  );
});

/**
 * The country code beside a number, and the list it opens (post-Build-4): the phone field's, and the sign-in field's when
 * what is typed is a number. Every country and territory, sorted in the reading language, a search fixed above the list,
 * the chosen one in view when it opens.
 */
export function CountryCodeChooser({ iso, onChange }: { iso: string; onChange: (iso: string) => void }) {
  const { t, language } = useTranslation();
  const colors = useColors();
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState('');
  const sorted = useMemo(() => countriesFor(language), [language]);
  const shown = useMemo(() => searchCountries(sorted, query, language), [sorted, query, language]);
  const chosenAt = Math.max(0, shown.findIndex((c) => c.iso === iso));
  const country = countryOf(iso);
  const choose = (c: PhoneCountry) => {
    onChange(c.iso);
    setChoosing(false);
    setQuery('');
  };
  return (
    <>
      <Pressable
        testID="phone-country"
        accessibilityRole="button"
        accessibilityLabel={t('phone.country.choose', { country: countryName(country, language) })}
        onPress={() => setChoosing(true)}
        hitSlop={8}
        style={[styles.code, { borderEndColor: colors.border.subtle }]}
      >
        <Text variant="bodyStrong" numberOfLines={1} style={styles.codeText}>{`+${country.code}`}</Text>
      </Pressable>
      <BottomSheet open={choosing} onClose={() => setChoosing(false)} title={t('phone.country.title')}>
        <View style={styles.sheet}>
          <TextField
            testID="phone-country-search"
            label={t('phone.country.search')}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {shown.length === 0 ? (
            <Text tone="secondary">{t('phone.country.none')}</Text>
          ) : (
            <FlatList
              testID="phone-country-list"
              data={shown}
              keyExtractor={(c) => c.iso}
              keyboardShouldPersistTaps="handled"
              initialScrollIndex={query === '' ? chosenAt : 0}
              getItemLayout={(_d, index) => ({ length: ROW, offset: ROW * index, index })}
              renderItem={({ item: c }) => (
                <View style={styles.row}>
                  <ListRow title={countryName(c, language)} subtitle={`+${c.code} · ${c.iso}`} selected={c.iso === iso} onPress={() => choose(c)} />
                </View>
              )}
            />
          )}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  // The code's own area: one width whatever the code (+1 or +1868), the number's height and divider after it. Its text
  // takes the input's exact metrics (Field.tsx `input`), and both are centred in the row, so the code and the number
  // share one line in every platform.
  code: { minHeight: 44, minWidth: 64, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs, borderEndWidth: StyleSheet.hairlineWidth, marginEnd: space.xs },
  codeText: {
    fontVariant: ['tabular-nums'],
    fontSize: Platform.OS === 'web' ? typeScale.inputWeb.fontSize : typeScale.body.fontSize,
    lineHeight: Platform.OS === 'web' ? typeScale.inputWeb.lineHeight : Platform.OS === 'ios' ? undefined : typeScale.body.lineHeight,
  },
  sheet: { gap: space.sm, flexShrink: 1, minHeight: 320 },
  row: { height: ROW, justifyContent: 'center' },
});
