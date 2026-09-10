import React from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { DEFAULT_SEPARATOR_INSET } from './RowGroup';

/**
 * The hairline between two rows of a `FlatList`.
 *
 * A one-line component with a real job: eight index screens each needed a
 * separator, and eight screens each deciding their own inset is eight chances
 * to write `marginLeft` and have the rule indent from the wrong side in Arabic.
 * Deciding it once means the mistake can only be made once.
 *
 * Pass to `ItemSeparatorComponent`, which renders it BETWEEN items only —
 * never above the first or below the last. That is why a list's rows should not
 * draw their own edges: the container already knows where the gaps are.
 */
export function ListSeparator({ inset = true }: { inset?: boolean }) {
  const styles = useStyles();
  return <View style={[styles.line, inset ? styles.inset : null]} />;
}

const useStyles = makeStyles((colors) => ({
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.semantic.divider,
  },
  /**
   * Indented past a leading icon so the rule aligns under the text.
   *
   * `marginStart`, never `marginLeft` — a physical margin indents from the left
   * in Arabic too, which puts the gap under the text and the rule under the
   * icon: exactly inverted, and invisible to anyone testing in English.
   */
  inset: {
    marginStart: space.base + DEFAULT_SEPARATOR_INSET,
  },
}));
