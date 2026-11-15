import React, { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Check, ChevronDown, Globe } from 'lucide-react-native';
import { pressedOpacity, radius, space, touch } from '../../lib/design/tokens';
import { InlineNotice } from './InlineNotice';
import { usePressed } from './use-pressed';
import { Text } from './Text';
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  useI18n,
  useTranslation,
  type Language,
} from '../../lib/i18n';
import { makeStyles, useColors } from '../../lib/design/theme';
import { DIRECTION_NOTICE_KEYS } from '../../lib/design/direction-restart';

/**
 * Choosing the language **before** signing in.
 *
 * The settings screen has had a language row for a long time, and it is behind
 * the sign-in screen — which is no use at all to the person who most needs it.
 * Somebody handed a phone showing a language they cannot read cannot sign in to
 * change the language, and cannot change the language without signing in.
 *
 * A globe button showing the language in use, which opens the three languages
 * (the owner's choice B, 2026-11-15). The globe is recognisable whatever the
 * language on screen, and every language is written in its own words — **there
 * are no flags**. A flag is a country, not a language: Arabic is not one
 * country's, and a French flag on a screen in Nouakchott says something nobody
 * meant to say.
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
  /** Kept for the screens that pass it; the globe button is compact on every screen. */
  compact?: boolean;
}

export function AuthLanguageSwitch({ style }: AuthLanguageSwitchProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const language = useI18n((s) => s.language);
  const setLanguage = useI18n((s) => s.setLanguage);
  const direction = useI18n((s) => s.direction);

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
  const [open, setOpen] = useState(false);
  const button = usePressed();

  /*
   * Fire and forget, deliberately. `setLanguage` writes a preference and
   * updates a store; awaiting it here would mean a spinner on a control whose
   * whole job is to feel instant. Nothing on these screens depends on the write
   * having landed — and nothing here is a form submission, so a language change
   * cannot become a second sign-in attempt.
   */
  const choose = (lang: Language) => {
    setOpen(false);
    if (lang === language) return;
    setSwitched(true);
    void setLanguage(lang);
  };

  return (
    <View style={[styles.wrap, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('settings.language')}: ${LANGUAGE_LABELS[language]}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        testID="auth-language-button"
        onPress={() => setOpen((o) => !o)}
        {...button.pressHandlers}
        style={[styles.button, button.pressed && styles.pressed]}
      >
        <Globe size={16} color={colors.text.accent} />
        <Text variant="label">{LANGUAGE_LABELS[language]}</Text>
        <ChevronDown size={16} color={colors.text.tertiary} />
      </Pressable>
      {open ? (
        <View style={styles.list} accessibilityRole="radiogroup">
          {LANGUAGES.map((lang) => (
            <LanguageOption key={lang} lang={lang} isCurrent={lang === language} onChoose={choose} />
          ))}
        </View>
      ) : null}
      {switched && direction !== 'ok' ? (
        <InlineNotice tone="info" title={t(DIRECTION_NOTICE_KEYS[direction].title)}>
          <Text variant="caption" tone="secondary">
            {t(DIRECTION_NOTICE_KEYS[direction].body)}
          </Text>
        </InlineNotice>
      ) : null}
    </View>
  );
}

/** One language in the list: a radio, checked with a tick as well as a tint. */
function LanguageOption({ lang, isCurrent, onChoose }: { lang: Language; isCurrent: boolean; onChoose: (lang: Language) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { pressed, pressHandlers } = usePressed();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: isCurrent }}
      aria-checked={isCurrent}
      onPress={() => onChoose(lang)}
      {...pressHandlers}
      style={[styles.option, isCurrent && styles.optionCurrent, pressed && styles.pressed]}
    >
      <Text variant="body" style={lang === 'ar' ? styles.rtl : undefined}>
        {LANGUAGE_LABELS[lang]}
      </Text>
      {isCurrent ? <Check size={18} color={colors.text.accent} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: space.sm, alignItems: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingHorizontal: space.base,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
  },
  list: {
    alignSelf: 'stretch',
    maxWidth: 320,
    width: '100%',
    marginHorizontal: 'auto',
    padding: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touch.min,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  optionCurrent: { backgroundColor: colors.surface.hover },
  pressed: { opacity: pressedOpacity },
  rtl: { writingDirection: 'rtl' },
}));
