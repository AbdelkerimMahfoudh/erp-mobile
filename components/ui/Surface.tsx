import React from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { elevation, radius, space } from '../../lib/design/tokens';
import { Text } from './Text';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Containers.
 *
 * The house style is flat surfaces separated by hairlines. Shadows are reserved
 * for things that genuinely float above the page (sheets, toasts, the FAB) —
 * a screen full of drop shadows reads as consumer app, not business software.
 */

/**
 * `accent` and `warning` are washes: the one figure a screen is opened for
 * (cash in the store, a sale's price) and the one that needs attention (what is
 * still owed). A wash carries meaning, so it is used once per screen at most.
 */
export type SurfaceVariant = 'card' | 'sunken' | 'plain' | 'outlined' | 'accent' | 'warning';

export interface CardProps extends ViewProps {
  variant?: SurfaceVariant;
  /** Inner padding. `none` when the card holds its own edge-to-edge rows. */
  padding?: keyof typeof space;
  /** Lift off the page. Leave `none` unless the surface actually floats. */
  raised?: keyof typeof elevation;
  children?: React.ReactNode;
}

export function Card({
  variant = 'card',
  padding = 'base',
  raised = 'none',
  style,
  children,
  ...rest
}: CardProps) {
  const colors = useColors();
  const variantStyle: ViewStyle =
    variant === 'card'
      ? { backgroundColor: colors.surface.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border.subtle }
      : variant === 'sunken'
        ? { backgroundColor: colors.surface.sunken }
        : variant === 'outlined'
          ? { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border.default }
          : variant === 'accent'
            ? { backgroundColor: colors.intent.info.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.intent.info.border }
            : variant === 'warning'
              ? { backgroundColor: colors.intent.warning.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.intent.warning.border }
              : { backgroundColor: 'transparent' };

  return (
    <View
      style={[
        { borderRadius: radius.lg, padding: space[padding] },
        variantStyle,
        elevation[raised],
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

export interface SectionProps extends ViewProps {
  /** Small caps heading above the group. Omit for an unlabelled group. */
  title?: string;
  /** One quiet line of context under the title. */
  subtitle?: string;
  /** Rendered opposite the title — usually a "See all" affordance. */
  action?: React.ReactNode;
  /**
   * A glyph before the title.
   *
   * Decoration is not the point: on a screen of six similarly-shaped groups it
   * is what lets somebody find "worst performing" without reading every
   * heading. The title still says it in words, so the icon never carries the
   * meaning alone.
   */
  icon?: React.ReactNode;
  gap?: keyof typeof space;
  children?: React.ReactNode;
}

/**
 * A titled group of content. Screens are built from stacked Sections, which is
 * what keeps vertical rhythm identical everywhere.
 */
export function Section({ title, subtitle, action, icon, gap = 'md', style, children, ...rest }: SectionProps) {
  const styles = useStyles();
  return (
    <View style={[{ gap: space[gap] }, style]} {...rest}>
      {title || action || icon ? (
        <View style={styles.header}>
          {icon}
          <View style={styles.headerText}>
            {title ? <Text variant="heading">{title}</Text> : null}
            {subtitle ? (
              <Text variant="caption" tone="tertiary">
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Hairline rule. `inset` aligns it with text that sits beside a leading icon. */
export function Divider({ inset = false, style }: { inset?: boolean; style?: ViewStyle }) {
  const styles = useStyles();
  return <View style={[styles.divider, inset ? styles.dividerInset : null, style]} />;
}

/** Vertical whitespace as a component, so screens never hardcode a margin. */
export function Spacer({ size = 'base' }: { size?: keyof typeof space }) {
  return <View style={{ height: space[size] }} />;
}

const useStyles = makeStyles((colors) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.subtle,
  },
  dividerInset: {
    // Clears a 40pt leading icon plus its gap — keeps rules from cutting under
    // an avatar or product thumbnail.
    marginStart: space['3xl'] + space.md,
  },
}));
