import React from 'react';
import { View } from 'react-native';
import { TextField } from '../ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { arabicNameHint, latinNameHint, type NameHint } from '../../lib/display-name';

export interface BilingualNameValue {
  name: string;
  nameAr: string;
}

const HINT_KEY = {
  latin_has_arabic: 'names.hint.latinHasArabic',
  latin_needs_letter: 'names.hint.latinNeedsLetter',
  arabic_needs_arabic: 'names.hint.arabicNeedsArabic',
} as const;

/** What a submit refuses before the server does: the same rule (`src/common/bilingual-name.ts`), in the reader's words. */
export function bilingualNameErrors(
  value: BilingualNameValue,
  options: { arabicRequired: boolean },
): { name?: NameHint | 'blank'; nameAr?: NameHint | 'blank' } {
  const out: { name?: NameHint | 'blank'; nameAr?: NameHint | 'blank' } = {};
  if (!value.name.trim()) out.name = 'blank';
  else if (latinNameHint(value.name)) out.name = latinNameHint(value.name);
  if (!value.nameAr.trim()) {
    if (options.arabicRequired) out.nameAr = 'blank';
  } else if (arabicNameHint(value.nameAr)) out.nameAr = arabicNameHint(value.nameAr);
  return out;
}

/**
 * A business's, a store's or a person's two names (D225): "Name in the Latin alphabet" and "الاسم بالعربية", side by
 * side wherever one is created or edited. Each field is written in its own script's direction whatever the interface's,
 * and guides while typing — Arabic letters in the Latin field, none in the Arabic one — without refusing a real shop
 * name such as "PS5 Center" or "مركز PS5". The Arabic name is required for a new record and optional when completing
 * an older one.
 */
export function BilingualNameFields({
  value,
  onChange,
  errors,
  arabicRequired,
  latinLabel,
  arabicLabel,
}: {
  value: BilingualNameValue;
  onChange: (next: BilingualNameValue) => void;
  errors?: { name?: string; nameAr?: string };
  arabicRequired: boolean;
  latinLabel?: string;
  arabicLabel?: string;
}) {
  const { t } = useTranslation();
  const latinHint = latinNameHint(value.name);
  const arabicHint = arabicNameHint(value.nameAr);
  return (
    <View style={{ gap: space.base }}>
      <TextField
        label={latinLabel ?? t('names.field.latin')}
        required
        script="latin"
        value={value.name}
        error={errors?.name ?? (latinHint ? t(HINT_KEY[latinHint]) : undefined)}
        hint={t('names.field.latinHint')}
        onChangeText={(name) => onChange({ ...value, name })}
        autoCapitalize="words"
        maxLength={160}
      />
      <TextField
        label={arabicLabel ?? t('names.field.arabic')}
        required={arabicRequired}
        script="arabic"
        value={value.nameAr}
        error={errors?.nameAr ?? (arabicHint ? t(HINT_KEY[arabicHint]) : undefined)}
        hint={arabicRequired ? t('names.field.arabicHint') : t('names.field.arabicLater')}
        onChangeText={(nameAr) => onChange({ ...value, nameAr })}
        maxLength={160}
      />
    </View>
  );
}

/** The error text for one field, from {@link bilingualNameErrors}. */
export function nameErrorText(
  problem: NameHint | 'blank' | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string | undefined {
  if (!problem) return undefined;
  if (problem === 'blank') return t('names.error.blank');
  return t(HINT_KEY[problem]);
}
