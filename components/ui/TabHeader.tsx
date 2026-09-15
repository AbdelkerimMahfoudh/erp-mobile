import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';

/**
 * The one header every primary tab uses.
 *
 * Context line (branch, sometimes role) → one heading → at most one short line,
 * with actions on the far side. Because every tab renders this, the title sits
 * at the same height on Home, Partners, Money, Stock and More, and a loading
 * list below it can never push it down: nothing in here waits for data.
 *
 * `actions` sits at the END edge, which flexbox mirrors on its own in Arabic.
 */
export interface TabHeaderProps {
  context?: string | null;
  title: string;
  subtitle?: string | null;
  /** Show the notifications bell. */
  bell?: boolean;
  actions?: React.ReactNode;
}

export function TabHeader({ context, title, subtitle, bell, actions }: TabHeaderProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        {context ? (
          <Text variant="label" tone="secondary" numberOfLines={1}>
            {context}
          </Text>
        ) : null}
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" tone="tertiary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions || bell ? (
        <View style={styles.actions}>
          {actions}
          {bell ? (
            <IconButton
              icon={Bell}
              variant="plain"
              accessibilityLabel={t('more.notifications.a11y')}
              onPress={() => router.push('/notifications' as Href)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  text: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
}));
