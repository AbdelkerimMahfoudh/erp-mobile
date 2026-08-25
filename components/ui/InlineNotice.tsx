import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  Info,
  type LucideIcon,
} from 'lucide-react-native';
import { type Intent } from '../../lib/design/colors';
import { icon as iconSize, radius, space } from '../../lib/design/tokens';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * A message attached to the thing it is about.
 *
 * Distinct from `ErrorState`, which takes over a whole screen when there is
 * nothing to show. This sits *inside* working content: a below-cost warning
 * above the price field, an explanation of why a button is disabled, a note
 * that a refund is reported but not yet confirmed.
 *
 * Every notice carries an icon **and** words. The icon differs per tone rather
 * than being one shape in five colours, so the meaning survives a colourblind
 * reader and a bad screen in direct sun.
 */

export interface InlineNoticeProps {
  tone?: Intent;
  /** Optional bold first line. Omit for a single-sentence notice. */
  title?: string;
  children: React.ReactNode;
  /** Overrides the tone's default icon. Pass `null` for no icon. */
  icon?: LucideIcon | null;
  /** A single action — "Retry", "Change price". More than one belongs elsewhere. */
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TONE_ICON: Record<Intent, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  danger: CircleAlert,
};

export function InlineNotice({
  tone = 'info',
  title,
  children,
  icon,
  action,
  style,
  testID,
}: InlineNoticeProps) {
  const colors = useColors();
  const styles = useStyles();
  const palette = colors.intent[tone];
  const Icon = icon === null ? null : (icon ?? TONE_ICON[tone]);

  return (
    <View
      testID={testID}
      // Announced as one unit, so a screen reader does not read the icon's
      // meaning and the sentence as two unrelated things.
      accessible
      accessibilityRole="alert"
      style={[
        styles.container,
        { backgroundColor: palette.bg, borderColor: palette.border },
        style,
      ]}
    >
      {Icon ? <Icon size={iconSize.md} color={palette.fg} style={styles.icon} /> : null}
      <View style={styles.body}>
        {title ? (
          <Text variant="bodyStrong" style={{ color: palette.fg }}>
            {title}
          </Text>
        ) : null}
        <Text variant="body" style={{ color: palette.fg }}>
          {children}
        </Text>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Nudged to sit on the first line's optical centre rather than its box top.
  icon: { marginTop: 1 },
  body: { flex: 1, gap: space.xs },
  action: { marginTop: space.xs, alignSelf: 'flex-start' },
}));
