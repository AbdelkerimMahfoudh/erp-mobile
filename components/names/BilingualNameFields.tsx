import React from 'react';
import { View } from 'react-native';
import { TextField } from '../ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { latinNameHint, type NameHint } from '../../lib/display-name';

export interface BilingualNameValue {
  name: string;
  nameAr: string;
}

const HINT_KEY = {
  latin_has_arabic: 'names.hint.latinHasArabic',
  latin_needs_letter: 'names.hint.latinNeedsLetter',
} as const;

/** What a submit refuses before the server does: the same rule (`src/common/bilingual-name.ts`), in the reader's words. */
export function bilingualNameErrors(
  value: BilingualNameValue,
  /** The optional trading name may be left blank; a store's or a person's may not (D227). */
  options: { nameOptional?: boolean } = {},
): { name?: NameHint | 'blank'; nameAr?: NameHint | 'blank' } {
  const out: { name?: NameHint | 'blank'; nameAr?: NameHint | 'blank' } = {};
  if (!value.name.trim()) {
    if (!options.nameOptional) out.name = 'blank';
  } else if (latinNameHint(value.name)) out.name = latinNameHint(value.name);
  return out;
}

/**
 * A business's, a store's or a person's two names (D225): "Name in the Latin alphabet" and "الاسم بالعربية", side by
 * side wherever one is created or edited. Each field is written in its own script's direction whatever the interface's,
 * and guides while typing — Arabic letters in the Latin field — without refusing a real shop
 * name such as "PS5 Center" or "مركز PS5". The Arabic name is required for a new record and optional when completing
 * an older one.
 */
export function BilingualNameFields({
  value,
  onChange,
  errors,
  nameOptional,
  hint,
  latinLabel,
  arabicLabel,
}: {
  value: BilingualNameValue;
  onChange: (next: BilingualNameValue) => void;
  errors?: { name?: string; nameAr?: string };
  nameOptional?: boolean;
  hint?: string;
  latinLabel?: string;
  arabicLabel?: string;
}) {
  const { t } = useTranslation();
  const latinHint = latinNameHint(value.name);
  return (
    <View style={{ gap: space.base }}>
      <TextField
        label={latinLabel ?? t('names.field.latin')}
        required={!nameOptional}
        script="latin"
        value={value.name}
        error={errors?.name ?? (latinHint ? t(HINT_KEY[latinHint]) : undefined)}
        hint={hint ?? t('names.field.latinHint')}
        onChangeText={(name) => onChange({ ...value, name })}
        autoCapitalize="words"
        maxLength={160}
      />
      <TextField
        label={arabicLabel ?? t('names.field.arabic')}
        script="arabic"
        value={value.nameAr}
        error={errors?.nameAr}
        hint={t('names.field.arabicHint')}
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
