import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { CloudOff, Lock, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { radius, space } from '../../lib/design/tokens';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { Button } from './Button';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Error state.
 *
 * Takes the raw thrown value and does the interpretation itself, so no screen
 * has to decide how to word a failure — that is exactly how cryptic errors
 * leak into a shop. A 403 renders as a calm "not available to you" with no
 * retry button, because retrying a permission boundary just teaches people to
 * mash a button that will never work.
 */

export interface ErrorStateProps {
  /** The thrown value, passed through untouched. */
  error: unknown;
  onRetry?: () => void;
  /** `inline` for a failed region inside an otherwise working screen. */
  size?: 'inline' | 'page';
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({ error, onRetry, size = 'page', style }: ErrorStateProps) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const friendly = toFriendlyError(error);
  const isPage = size === 'page';

  const { Icon, tone } = friendly.permissionDenied
    ? { Icon: Lock, tone: colors.text.tertiary }
    : friendly.status === undefined && friendly.retryable
      ? { Icon: CloudOff, tone: colors.intent.warning.fg }
      : { Icon: TriangleAlert, tone: colors.intent.danger.fg };

  return (
    <View style={[styles.container, isPage ? styles.page : styles.inline, style]}>
      <View style={[styles.badge, isPage ? styles.badgeLarge : null]}>
        <Icon color={tone} size={isPage ? 26 : 20} />
      </View>

      <View style={styles.copy}>
        <Text variant={isPage ? 'heading' : 'bodyStrong'} align="center">
          {friendly.title}
        </Text>
        <Text variant="body" tone="secondary" align="center">
          {friendly.body}
        </Text>
      </View>

      {onRetry && friendly.retryable ? (
        <Button
          title={t('action.retry')}
          variant="secondary"
          size={isPage ? 'md' : 'sm'}
          icon={RefreshCw}
          onPress={onRetry}
          style={styles.action}
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
    paddingVertical: space['4xl'],
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
    width: 56,
    height: 56,
  },
  copy: {
    gap: space.xs,
    maxWidth: 320,
  },
  action: {
    marginTop: space.xs,
    minWidth: 160,
  },
}));
