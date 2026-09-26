import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TabHeader, Text } from '../ui';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * Home's header (docs/56): the store's name and the greeting, compact, on one
 * small, restrained gradient — the accent's soft tint fading into the canvas —
 * with the bell and the store's calendar date at the end edge.
 *
 * It is the shared `TabHeader` inside a tinted panel, so Home keeps the one
 * header every tab has. The date is informational and never a range picker;
 * it is the server's, in the store's timezone, so it is simply absent until
 * the first reply rather than the phone's guess. Before 06:00 the calendar
 * date and the business date differ, and the line under the greeting says
 * which business day new sales still belong to.
 *
 * Drawn with react-native-svg, already installed for the app: no dependency
 * is added, and a header of text and one tint stays cheap to mount.
 */
export interface HomeHeaderProps {
  context: string;
  title: string;
  /** The store's calendar date, already formatted, once known. */
  date?: string | null;
  /** Said only before 06:00: the business day new sales still count for. */
  note?: string | null;
}

export function HomeHeader({ context, title, date, note }: HomeHeaderProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.panel}>
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%" accessible={false} importantForAccessibility="no">
        <Defs>
          <LinearGradient id="home-header-tint" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.semantic.primarySoft} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.surface.canvas} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#home-header-tint)" />
      </Svg>
      <TabHeader
        context={context}
        title={title}
        subtitle={note}
        bell
        actions={
          date ? (
            <Text variant="label" tone="secondary" numberOfLines={1} style={styles.date}>
              {date}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  panel: { borderRadius: radius.xl, overflow: 'hidden', padding: space.base, marginHorizontal: -space.xs },
  date: { paddingHorizontal: space.xs },
}));
