import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { ListRow, Text, TextField, type TextFieldProps } from './ui';
import { BottomSheet } from './overlay';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import { composePhone, countryName, countryOf, PHONE_COUNTRIES, splitPhone, typedInternational } from '../lib/phone-input';

type PhoneFieldProps = Omit<TextFieldProps, 'value' | 'onChangeText' | 'keyboardType' | 'variant' | 'leading'> & {
  /** One international string, or empty. */
  value: string;
  onChangeText: (value: string) => void;
};

/**
 * A person's phone number, everywhere one is asked for (D227). Quiet until the first digit, then a compact country code
 * beside the number, left to right in every language. The form receives one international string; the server still decides.
 * Never for an IMEI, a price or a payer's account number.
 */
export const PhoneField = forwardRef<TextInputInstance, PhoneFieldProps>(function PhoneField({ value, onChangeText, ...rest }, ref) {
  const { t, language } = useTranslation();
  const [choosing, setChoosing] = useState(false);
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

  const country = countryOf(iso);
  const showCode = typed.trim() !== '' && !typedInternational(typed);

  return (
    <>
      <TextField
        ref={ref}
        {...rest}
        value={typed}
        onChangeText={(next) => {
          setTyped(next);
          emit(iso, next);
        }}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        variant="identifier"
        leading={
          showCode ? (
            <Pressable
              testID="phone-country"
              accessibilityRole="button"
              accessibilityLabel={t('phone.country.choose', { country: countryName(country, language) })}
              onPress={() => setChoosing(true)}
              hitSlop={8}
              style={styles.code}
            >
              <Text variant="bodyStrong">{`+${country.code}`}</Text>
            </Pressable>
          ) : undefined
        }
      />
      <BottomSheet scroll open={choosing} onClose={() => setChoosing(false)} title={t('phone.country.title')}>
        <View style={styles.list}>
          {PHONE_COUNTRIES.map((c) => (
            <ListRow
              key={c.iso}
              title={countryName(c, language)}
              subtitle={`+${c.code}`}
              onPress={() => {
                setIso(c.iso);
                emit(c.iso, typed);
                setChoosing(false);
              }}
            />
          ))}
        </View>
      </BottomSheet>
    </>
  );
});

const styles = StyleSheet.create({
  code: { minHeight: 44, justifyContent: 'center', paddingEnd: space.xs },
  list: { gap: space.xs },
});
