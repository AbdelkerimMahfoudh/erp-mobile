import React, { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
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
 *
 * ## The keyboard
 *
 * A pinned footer and a soft keyboard are natural enemies, and the first
 * physical-device test found exactly that: with the keyboard open on the intake
 * form, the footer was underneath it and the last fields could not be scrolled
 * to at all. The form was unfinishable on a real phone.
 *
 * Three things fix it, and all three are needed:
 *
 *   1. `KeyboardAvoidingView` lifts the whole frame — including the pinned
 *      footer — on iOS. Android resizes the window itself, so it must NOT be
 *      given a behaviour or the two corrections fight and the footer jumps.
 *   2. The scroll area reserves the footer's REAL measured height, so the last
 *      field can always be scrolled clear of it. A guessed constant is wrong on
 *      every screen whose footer has two buttons instead of one.
 *   3. Tapping blank space dismisses the keyboard, because on a form with a
 *      pinned footer there is often nowhere else to tap.
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

  /**
   * Measured, never assumed.
   *
   * The footer is one button on some screens and three on others; a constant
   * would leave the last field under it on exactly the screens that have the
   * most to fill in.
   */
  const [footerHeight, setFooterHeight] = useState(0);
  const measureFooter = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setFooterHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  };

  const body = scroll ? (
    <ScrollView
      className={className}
      contentContainerStyle={[
        {
          padding: gutter,
          // The tab bar, the pinned footer and a comfortable overscroll, so the
          // last field can always be brought above the keyboard.
          paddingBottom: gutter + footerHeight + space['3xl'],
        },
        contentContainerStyle,
      ]}
      /*
       * `handled` is what lets a button be pressed on the FIRST tap while the
       * keyboard is open, instead of the tap being spent closing it. Without
       * it, every submit under an open keyboard takes two taps.
       */
      keyboardShouldPersistTaps="handled"
      /*
       * iOS can drag the keyboard away under the finger and take it back; on
       * Android that mode does not exist, and dismissing on any drag is the
       * closest equivalent.
       */
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
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
      {/*
        Blank space closes the keyboard.

        `accessible={false}` keeps it out of the screen reader's order — it is a
        gesture surface, not a control, and announcing "button" over the whole
        form would be worse than the problem it solves. Real controls inside
        still win the touch, because the deepest responder handles it.
      */}
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        style={gap ? { gap: space[gap] } : undefined}
      >
        {children}
      </Pressable>
    </ScrollView>
  ) : (
    <View
      className={className}
      style={[styles.body, { padding: gutter, gap: gap ? space[gap] : undefined }]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, style]} edges={edges}>
      <KeyboardAvoidingView
        style={styles.fill}
        /*
         * iOS only. Android's window already resizes for the keyboard, and
         * adding a second correction on top makes the footer jump twice.
         */
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header ? <View style={styles.header}>{header}</View> : null}
        {body}
        {footer ? (
          <View style={styles.footer} onLayout={measureFooter}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: {
    flex: 1,
    backgroundColor: colors.surface.canvas,
  },
  fill: {
    flex: 1,
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
