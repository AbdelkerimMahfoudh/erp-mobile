import React, { useState } from 'react';
import { View } from 'react-native';
import { Check, Languages } from 'lucide-react-native';
import { Card, InlineNotice, ListRow, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  useI18n,
  useTranslation,
  type Language,
} from '../../lib/i18n';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Choosing the language the app speaks.
 *
 * Lives in Account & security since milestone N — it is a personal preference,
 * not a company rule, and it belongs beside the devices you would change it on.
 *
 * Expands in place rather than pushing a screen: it is the same number of taps
 * either way, and somebody who cannot read the menu should not have to navigate
 * deeper into it to escape.
 *
 * Every language is written in its own words. "Arabic" spelled in French is no
 * use to somebody who only reads Arabic.
 *
 * Switching to or from Arabic changes the layout direction, which React Native
 * applies natively only at startup. The notice says so plainly rather than
 * leaving somebody to wonder why the words changed and the layout did not.
 */
export function LanguageRow() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const language = useI18n((s) => s.language);
  const setLanguage = useI18n((s) => s.setLanguage);
  const restartRequired = useI18n((s) => s.restartRequired);
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        <ListRow
          title={t('settings.language')}
          leading={Languages}
          value={LANGUAGE_LABELS[language]}
          valueTone="secondary"
          onPress={() => setOpen((v) => !v)}
        />

        {open
          ? LANGUAGES.map((lang: Language) => (
              <ListRow
                key={lang}
                title={LANGUAGE_LABELS[lang]}
                // Marked, not merely coloured — status is never carried by
                // colour alone.
                accessory={
                  lang === language ? <Check size={18} color={colors.brand[600]} /> : undefined
                }
                selected={lang === language}
                chevron={false}
                onPress={() => {
                  void setLanguage(lang);
                  setOpen(false);
                }}
              />
            ))
          : null}
      </Card>

      {restartRequired ? (
        <InlineNotice
          tone="warning"
          title={t('settings.language.restartTitle')}
          style={styles.notice}
        >
          <Text variant="caption" tone="secondary">
            {t('settings.language.restartBody')}
          </Text>
        </InlineNotice>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: space.sm },
  card: { paddingVertical: space.xs },
  notice: { marginTop: space.xs },
}));
