import React, { useState } from 'react';
import { Check, Languages } from 'lucide-react-native';
import { ListRow } from '../ui';
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  useI18n,
  useTranslation,
  type Language,
} from '../../lib/i18n';
import { useColors } from '../../lib/design/theme';

/**
 * Choosing the language the app speaks.
 *
 * Lives in Appearance & language since milestone N — it is a personal
 * preference, not a company rule, and it belongs beside the devices you would
 * change it on.
 *
 * Expands in place rather than pushing a screen: it is the same number of taps
 * either way, and somebody who cannot read the menu should not have to navigate
 * deeper into it to escape.
 *
 * Every language is written in its own words. "Arabic" spelled in French is no
 * use to somebody who only reads Arabic.
 *
 * ## Flat rows, no surface of its own
 *
 * This renders **flat** rows and nothing else — no Card. It is meant to sit
 * inside the one surface Appearance draws (a `RowGroup`), beside the dark-mode
 * row, so the two personal preferences read as one panel rather than two cards
 * stacked in a third. The restart notice that a language change may raise is the
 * screen's to render, outside that surface — a bordered notice inside the panel
 * would be the very card-in-card this flattening removed.
 *
 * Switching to or from Arabic changes the layout direction, which React Native
 * applies natively only at startup; `useI18n().restartRequired` tells the screen
 * to say so.
 */
export function LanguageRow() {
  const colors = useColors();
  const { t } = useTranslation();
  const language = useI18n((s) => s.language);
  const setLanguage = useI18n((s) => s.setLanguage);
  const [open, setOpen] = useState(false);

  return (
    <>
      <ListRow
        flat
        title={t('settings.language')}
        leading={Languages}
        value={LANGUAGE_LABELS[language]}
        valueTone="secondary"
        onPress={() => setOpen((v) => !v)}
      />

      {open
        ? LANGUAGES.map((lang: Language) => (
            <ListRow
              flat
              key={lang}
              title={LANGUAGE_LABELS[lang]}
              // Marked, not merely coloured — status is never carried by colour alone.
              accessory={lang === language ? <Check size={18} color={colors.brand[600]} /> : undefined}
              selected={lang === language}
              chevron={false}
              onPress={() => {
                void setLanguage(lang);
                setOpen(false);
              }}
            />
          ))
        : null}
    </>
  );
}
