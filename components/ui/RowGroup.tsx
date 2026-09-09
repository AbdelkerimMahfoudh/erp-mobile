import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';

/**
 * A run of related rows inside ONE surface, separated by hairlines.
 *
 * This exists because the app had two bad habits and no middle ground between
 * them. Detail screens wrapped every single field in its own `Card`, so a sale
 * became six floating boxes and nothing looked more important than anything
 * else. The correction — flat rows everywhere — is right for a list of forty
 * products and wrong for eight related facts about one order, which stop
 * reading as a group at all.
 *
 * So: one bordered surface, and the rows inside it share edges. The border says
 * "these belong together"; the hairlines say "these are separate facts". A
 * screen then has a handful of groups instead of thirty cards or one
 * undifferentiated column.
 *
 * ## What goes in it
 *
 * Rows that answer questions about the SAME thing — an order's status, branch
 * and payment; a product's brand, category and barcode. Not a list of records:
 * that is a flat list, and it does not want a box around it. Not a metric or a
 * warning: those are `Card`, because they are meant to be looked at rather than
 * read through.
 *
 * ## Separators
 *
 * Drawn between children, never above the first or below the last — a leading
 * hairline reads as a broken border, and a trailing one as a missing row. They
 * are inset from the start edge by default so they align under the text rather
 * than cutting the leading icon in half, and that inset is a **margin on the
 * start side**, so it follows the writing direction into Arabic without any
 * direction-specific code.
 */

export interface RowGroupProps {
  children: React.ReactNode;
  /**
   * Indent the separators past a leading icon.
   *
   * Default is the icon column used by `ListRow`. Pass `0` for rows with no
   * leading element, where a full-width rule is correct.
   */
  separatorInset?: number;
  style?: StyleProp<ViewStyle>;
}

/** Matches `ListRow`'s leading badge (40) plus its gap, so rules line up with the text. */
export const DEFAULT_SEPARATOR_INSET = 40 + space.md;

export function RowGroup({ children, separatorInset = DEFAULT_SEPARATOR_INSET, style }: RowGroupProps) {
  const styles = useStyles();

  // `Children.toArray` drops nulls and false, so a conditionally rendered row
  // cannot leave a separator with nothing under it.
  const rows = React.Children.toArray(children);

  return (
    <View style={[styles.group, style]}>
      {rows.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <View style={[styles.separator, { marginStart: separatorInset }]} /> : null}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  group: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.semantic.border,
    backgroundColor: colors.semantic.surface,
    // Clips the children's corners to the group's radius, so the first and last
    // rows round with the surface instead of squaring off inside it.
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.semantic.divider,
  },
}));
