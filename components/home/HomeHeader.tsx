import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TabHeader, Text } from '../ui';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Home's header (docs/56): the store's name, the greeting and its line, compact,
 * on one small, restrained gradient — the accent's soft tint fading into the
 * canvas — with the bell and the store's calendar date at the end edge.
 *
 * It is the shared `TabHeader` inside a tinted panel, so Home keeps the one
 * header every tab has. The date is informational and never a range picker;
 * it is the server's, in the store's timezone, so it is simply absent until
 * the first reply rather than the phone's guess. Before 06:00 the calendar
 * date and the business date differ, and a line under the header says which
 * business day new sales still belong to — beside the greeting, never in its
 * place.
 *
 * Drawn with react-native-svg, already installed for the app: no dependency
 * is added, and a header of text and one tint stays cheap to mount.
 *
 * ## Why the tint and the padding live on two different views
 *
 * The gradient fills its parent with `width="100%"`, positioned absolutely.
 * On a phone, React Native's default layout conformance resolves an absolute
 * child's percentage against the parent's CONTENT box — the box inside the
 * padding — not against the padded box the way the web does. With the padding
 * on the same view as the tint, the tint came up 32 pt short on the end side:
 * the card looked cut off before the screen margin (the Home screenshot of
 * 6 Oct). The web renders never showed it, because CSS resolves against the
 * padded box. So the outer view owns the shape and the tint and carries no
 * padding, and an inner view carries the padding and the content: there is
 * then no content box smaller than the card for the tint to be measured by.
 */
export interface HomeHeaderProps {
  context: string;
  title: string;
  /** The greeting's own line — "Ready when you are." on an ordinary day. */
  subtitle?: string | null;
  /** The store's calendar date, already formatted, once known. */
  date?: string | null;
  /** Said only before 06:00: the business day new sales still count for. */
  note?: string | null;
}

export function HomeHeader({ context, title, subtitle, date, note }: HomeHeaderProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.panel} testID="home-header">
      {/* The tint: the only child of an unpadded view, so 100% is the whole card on every platform. */}
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%" accessible={false} importantForAccessibility="no">
        <Defs>
          <LinearGradient id="home-header-tint" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.semantic.primarySoft} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.surface.canvas} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#home-header-tint)" />
      </Svg>
      <View style={styles.inner} testID="home-header-content">
        <TabHeader
          context={context}
          title={title}
          subtitle={subtitle}
          bell
          actions={
            date ? (
              <Text variant="label" tone="secondary" numberOfLines={1} style={styles.date}>
                {date}
              </Text>
            ) : null
          }
        />
        {note ? (
          <Text variant="captionStrong" tone="secondary" style={styles.note}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  /** The shape and the tint. No padding here — see the note above. */
  panel: { borderRadius: radius.xl, overflow: 'hidden', marginHorizontal: -space.xs },
  /** The content, padded symmetrically; the bell keeps its full touch target inside. */
  inner: { padding: space.base, gap: space.sm },
  date: { paddingHorizontal: space.xs },
  note: { borderTopWidth: 1, borderTopColor: colors.border.subtle, paddingTop: space.sm },
}));
