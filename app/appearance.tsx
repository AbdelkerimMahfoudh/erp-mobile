import React from 'react';
import { View } from 'react-native';
import { Card, Screen, Text, Toggle } from '../components/ui';
import { LanguageRow } from '../components/navigation/LanguageRow';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
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
 * The language selector MOVED here; it is not a second copy. It used to be
 * rendered inline by the Account hub, which was the only sensible home before
 * this screen existed.
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
 * phone is shared, and the person who prefers dark is choosing for that
 * handset in that lighting, not for themselves everywhere. It is also not
 * sensitive: it reveals nothing about the account, so signing out deliberately
 * leaves it alone rather than resetting the screen somebody just set up.
 */
export default function AppearanceScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { isDark, setTheme } = useTheme();

  return (
    <Screen>
      <View style={styles.intro}>
        <Text variant="title">{t('appearance.title')}</Text>
        <Text variant="caption" tone="secondary">
          {t('appearance.subtitle')}
        </Text>
      </View>

      <Card style={styles.card}>
        <Toggle
          label={t('appearance.darkMode')}
          hint={t('appearance.darkMode.hint')}
          value={isDark}
          onValueChange={(next) => void setTheme(next ? 'dark' : 'light')}
          onLabel={t('appearance.dark')}
          offLabel={t('appearance.light')}
        />
      </Card>

      <LanguageRow />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  intro: { gap: space.xs, marginBottom: space.md },
  card: { padding: space.md, marginBottom: space.md },
}));
