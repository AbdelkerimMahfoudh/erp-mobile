import React from 'react';
import { TextField } from '../ui/Field';
import { useTranslation } from '../../lib/i18n';
import { parsePayerNumber, PAYER_NUMBER_MAX_DIGITS, PAYER_NUMBER_MAX_INPUT } from '../../lib/payer-number';

/**
 * The number a bank or wallet payment came from (docs/21 D151) — optional,
 * shown only beside a non-cash place, one per payment part.
 *
 * Never the customer's saved phone (nothing copies it in) and never the
 * transfer's reference. The phone pad has the `+`; digits stay left to right in
 * Arabic; the field stops at {@link PAYER_NUMBER_MAX_INPUT} characters, and
 * autofill is off so the phone never proposes its owner's own number.
 */
export function PayerNumberField({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) {
  const { t } = useTranslation();
  const parsed = parsePayerNumber(value);
  // A lone "+" is a number on its way, not a mistake yet; Complete still waits for a digit.
  const error =
    parsed.ok || value.trim() === '+'
      ? undefined
      : parsed.reason === 'too_long'
        ? t('sell.payment.payerNumber.tooLong', { max: PAYER_NUMBER_MAX_DIGITS })
        : t('sell.payment.payerNumber.invalid');
  return (
    <TextField
      label={t('sell.payment.payerNumber')}
      // The visible label is a sibling; VoiceOver hears it on the input itself.
      accessibilityLabel={t('sell.payment.payerNumber')}
      hint={t('sell.payment.payerNumber.hint')}
      error={error}
      value={value}
      onChangeText={onChangeText}
      variant="identifier"
      keyboardType="phone-pad"
      autoComplete="off"
      textContentType="none"
      maxLength={PAYER_NUMBER_MAX_INPUT}
    />
  );
}
