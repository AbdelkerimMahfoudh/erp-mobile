import { useCallback } from 'react';
import { categoryLabel, type LabelledCategory } from './category-label';
import { hasKey, useTranslation } from './i18n';

/** A category's shown name in the reader's language: built-ins by key, a shop's own by its name. */
export function useCategoryLabel(): (category: LabelledCategory) => string {
  const { t, language } = useTranslation();
  return useCallback(
    (category: LabelledCategory) => categoryLabel(category, (k) => (hasKey(k) ? t(k) : k), hasKey),
    // The language is what changes the answer; `t` reads the active catalogue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, language],
  );
}
