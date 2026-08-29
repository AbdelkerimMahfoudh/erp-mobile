import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { space } from '../../lib/design/tokens';
import { InlineNotice } from './InlineNotice';
import { SegmentedControl } from './SegmentedControl';
import { Text } from './Text';
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  useI18n,
  useTranslation,
  type Language,
} from '../../lib/i18n';
import { makeStyles } from '../../lib/design/theme';

/**
 * Choosing the language **before** signing in.
 *
 * The settings screen has had a language row for a long time, and it is behind
 * the sign-in screen — which is no use at all to the person who most needs it.
 * Somebody handed a phone showing a language they cannot read cannot sign in to
 * change the language, and cannot change the language without signing in.
 *
 * So this is deliberately not the settings control. It is compact, it sits on
 * the screens somebody meets first, and it changes the words immediately.
 *
 * Every language is written in its own words and **there are no flags**. A flag
 * is a country, not a language: Arabic is not one country's, and a French flag
 * on a screen in Nouakchott says something nobody meant to say.
 *
 * The preference is the same one the settings row writes — `erp.language`,
 * ordinary preference storage, never the secure store. It is not a secret, and
 * putting it beside the tokens would only make the tokens easier to find.
 *
 * Switching to or from Arabic changes layout direction, which React Native
 * applies natively at startup. The words change now; the mirroring follows on
 * the next launch, and the notice says so rather than leaving somebody to
 * wonder why half of it moved.
 */
export interface AuthLanguageSwitchProps {
  style?: StyleProp<ViewStyle>;
  /** Hide the label above the control where the screen is already tight. */
  compact?: boolean;
}

export function AuthLanguageSwitch({ style, compact = false }: AuthLanguageSwitchProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const language = useI18n((s) => s.language);
  const setLanguage = useI18n((s) => s.setLanguage);
  const restartRequired = useI18n((s) => s.restartRequired);

  /*
   * The notice appears only after somebody switches HERE.
   *
   * `restartRequired` is also set during hydration, when the stored language
   * and the native layout direction disagree at launch — which is a real
   * condition, and is the settings screen's business. On a sign-in screen it
   * meant "restart the app to finish switching language" greeting somebody who
   * had not switched anything, which is worse than saying nothing.
   */
  const [switched, setSwitched] = useState(false);

  const options = LANGUAGES.map((lang: Language) => ({
    value: lang,
    label: LANGUAGE_LABELS[lang],
  }));

  return (
    <View style={[styles.wrap, style]}>
      {compact ? null : (
        <Text variant="caption" tone="secondary" style={styles.label}>
          {t('settings.language')}
        </Text>
      )}
      <SegmentedControl
        options={options}
        value={language}
        size="sm"
        /*
         * Fire and forget, deliberately. `setLanguage` writes a preference and
         * updates a store; awaiting it here would mean a spinner on a control
         * whose whole job is to feel instant. Nothing on these screens depends
         * on the write having landed — and nothing here is a form submission,
         * so a language change cannot become a second sign-in attempt.
         */
        onChange={(lang) => {
          setSwitched(true);
          void setLanguage(lang);
        }}
      />
      {switched && restartRequired ? (
        <InlineNotice tone="info" title={t('settings.language.restartTitle')}>
          <Text variant="caption" tone="secondary">
            {t('settings.language.restartBody')}
          </Text>
        </InlineNotice>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.xs },
  label: { textAlign: 'center' },
}));
