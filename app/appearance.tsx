import React from 'react';
import { View } from 'react-native';
import { InlineNotice, RowGroup, Screen, Text, Toggle } from '../components/ui';
import { LanguageRow } from '../components/navigation/LanguageRow';
import { space } from '../lib/design/tokens';
import { useI18n, useTranslation } from '../lib/i18n';
import { makeStyles, useTheme } from '../lib/design/theme';

/**
 * Account & security → Appearance & language.
 *
 * How the app looks and what language it speaks. Both are **personal
 * preferences, not business configuration** — two people sharing a shop can
 * disagree about them without either being wrong — so they live here rather
 * than in store-wide Settings, where a change means "this is how the shop
 * works" and everybody inherits it.
 *
 * ## One panel, not two cards
 *
 * The two preferences sit in a single bordered surface — a dark-mode row and a
 * language row, separated by a hairline. They used to be a card wrapping a
 * bordered toggle and, beneath it, a second card wrapping the language rows:
 * boxes inside boxes. One `RowGroup` with flat rows is the whole panel now, and
 * the restart notice a language change may raise sits outside it, because a
 * bordered notice inside the panel would be the same nesting again.
 *
 * ## Why the dark control is a switch and not three options
 *
 * A "System" option makes the control ambiguous: with it selected, the switch
 * shows the *current* appearance, so a shopkeeper toggling it at dusk cannot
 * tell whether they changed the setting or the sun did. Off means Light, on
 * means Dark, and existing users default to Light so nobody's app changes
 * appearance on its own after an update.
 *
 * ## Whose preference is it
 *
 * The theme is stored on the DEVICE, not against the account. A shop's counter
 * phone is shared, and the person who prefers dark is choosing for that handset
 * in that lighting, not for themselves everywhere. Signing out deliberately
 * leaves it alone rather than resetting the screen somebody just set up.
 */
export default function AppearanceScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { isDark, setTheme } = useTheme();
  const restartRequired = useI18n((s) => s.restartRequired);

  return (
    <Screen>
      <View style={styles.intro}>
        <Text variant="title">{t('appearance.title')}</Text>
        <Text variant="caption" tone="secondary">
          {t('appearance.subtitle')}
        </Text>
      </View>

      <RowGroup>
        <Toggle
          flat
          label={t('appearance.darkMode')}
          hint={t('appearance.darkMode.hint')}
          value={isDark}
          onValueChange={(next) => void setTheme(next ? 'dark' : 'light')}
          onLabel={t('appearance.dark')}
          offLabel={t('appearance.light')}
        />
        <LanguageRow />
      </RowGroup>

      {restartRequired ? (
        <InlineNotice tone="warning" title={t('settings.language.restartTitle')} style={styles.notice}>
          <Text variant="caption" tone="secondary">
            {t('settings.language.restartBody')}
          </Text>
        </InlineNotice>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  intro: { gap: space.xs, marginBottom: space.md },
  notice: { marginTop: space.md },
}));
