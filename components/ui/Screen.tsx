import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';

/**
 * The page wrapper.
 *
 * Owns safe area, background and the standard page gutter so no screen sets its
 * own padding — that is what keeps every screen's content on the same vertical
 * and horizontal rhythm.
 *
 * `footer` is pinned outside the scroll area, which is where the primary action
 * belongs: thumb-reachable and never scrolled away mid-sale.
 */

export interface ScreenProps {
  children: React.ReactNode;
  /** Scrollable body. Turn off for screens that manage their own list. */
  scroll?: boolean;
  /** Sticky region above the scroll area — search bars, filters, totals. */
  header?: React.ReactNode;
  /** Sticky region below — primary actions, cart totals. */
  footer?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Remove the standard gutter for edge-to-edge lists. */
  padded?: boolean;
  gap?: keyof typeof space;
  edges?: readonly Edge[];
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  style?: StyleProp<ViewStyle>;
  /** Accepted so existing NativeWind-styled screens keep working unchanged. */
  className?: string;
}

export function Screen({
  children,
  scroll = true,
  header,
  footer,
  onRefresh,
  refreshing = false,
  padded = true,
  gap,
  edges = ['top'],
  contentContainerStyle,
  style,
  className,
}: ScreenProps) {
  const styles = useStyles();
  const colors = useColors();
  const gutter = padded ? space.base : 0;

  return (
    <SafeAreaView style={[styles.safe, style]} edges={edges}>
      {header ? <View style={styles.header}>{header}</View> : null}

      {scroll ? (
        <ScrollView
          className={className}
          contentContainerStyle={[
            {
              padding: gutter,
              // Clears the tab bar and any floating footer.
              paddingBottom: gutter + space['3xl'],
              gap: gap ? space[gap] : undefined,
            },
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.brand[600]}
                colors={[colors.brand[600]]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View className={className} style={[styles.body, { padding: gutter, gap: gap ? space[gap] : undefined }]}>
          {children}
        </View>
      )}

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: {
    flex: 1,
    backgroundColor: colors.surface.canvas,
  },
  body: {
    flex: 1,
  },
  header: {
    backgroundColor: colors.surface.card,
    paddingHorizontal: space.base,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
    gap: space.md,
  },
  footer: {
    backgroundColor: colors.surface.card,
    paddingHorizontal: space.base,
    paddingTop: space.md,
    paddingBottom: space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    gap: space.sm,
  },
}));
