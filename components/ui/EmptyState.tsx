import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { Button, type IconComponent } from './Button';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Empty state.
 *
 * Per docs/05, an empty screen is an onboarding opportunity: it should say what
 * goes here and offer the action that puts something there ("No stock yet —
 * scan your first item"). An empty state without an action is a dead end, so
 * `action` is strongly encouraged wherever the user can actually do something.
 */

export interface EmptyStateProps {
  icon?: IconComponent;
  title?: string;
  /** One line of coaching. Say what to do, not what is absent. */
  body?: string;
  action?: {
    label: string;
    onPress: () => void;
    icon?: IconComponent;
  };
  /** Quieter alternative beneath the primary action. */
  secondaryAction?: {
    label: string;
    onPress: () => void;
  };
  /** `inline` for an empty region inside a populated screen. */
  size?: 'inline' | 'page';
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  secondaryAction,
  size = 'page',
  style,
}: EmptyStateProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const isPage = size === 'page';

  return (
    <View style={[styles.container, isPage ? styles.page : styles.inline, style]}>
      {Icon ? (
        <View style={[styles.badge, isPage ? styles.badgeLarge : null]}>
          <Icon color={colors.text.tertiary} size={isPage ? 28 : 20} />
        </View>
      ) : null}

      <View style={styles.copy}>
        <Text variant={isPage ? 'heading' : 'bodyStrong'} align="center">
          {title ?? t('state.empty.title')}
        </Text>
        {body ? (
          <Text variant="body" tone="secondary" align="center">
            {body}
          </Text>
        ) : null}
      </View>

      {action ? (
        <Button
          title={action.label}
          icon={action.icon}
          onPress={action.onPress}
          size={isPage ? 'md' : 'sm'}
          style={styles.action}
        />
      ) : null}

      {secondaryAction ? (
        <Button
          title={secondaryAction.label}
          variant="tertiary"
          size="sm"
          onPress={secondaryAction.onPress}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    alignItems: 'center',
    gap: space.base,
  },
  page: {
    paddingVertical: space['5xl'],
    paddingHorizontal: space.xl,
  },
  inline: {
    paddingVertical: space.xl,
    paddingHorizontal: space.base,
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface.sunken,
  },
  badgeLarge: {
    width: 60,
    height: 60,
  },
  copy: {
    gap: space.xs,
    maxWidth: 320,
  },
  action: {
    marginTop: space.xs,
    minWidth: 180,
  },
}));
