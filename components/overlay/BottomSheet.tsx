import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { colors } from '../../lib/design/colors';
import { duration, elevation, radius, space } from '../../lib/design/tokens';
import { useKeyboardHeight } from '../../lib/use-keyboard-height';
import { useTranslation } from '../../lib/i18n';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';

/**
 * Bottom sheet — the app's standard way to ask for one thing without leaving
 * the current screen.
 *
 * Built on `Modal` + Reanimated rather than pulling in a sheet library: this is
 * the surface every picker, scanner and confirmation sits on, and owning it
 * means no third-party breakage under the New Architecture and no guessing at
 * someone else's gesture semantics.
 *
 * Dismissal is deliberately generous — drag down, tap the backdrop, press the
 * close button, or Android back. A sheet that traps someone mid-sale is worse
 * than one dismissed by accident, because everything here is re-openable.
 */

/** Drag distance past which the release dismisses instead of springing back. */
const DISMISS_DISTANCE = 110;
/** Fling speed that dismisses regardless of distance travelled. */
const DISMISS_VELOCITY = 800;

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Fraction of screen height the sheet may occupy. */
  maxHeightRatio?: number;
  /** Pinned below the content — the sheet's primary action. */
  footer?: React.ReactNode;
  /** Hide the grab handle and close button for a sheet that must be answered. */
  dismissible?: boolean;
  /** Remove content padding for edge-to-edge lists. */
  padded?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  maxHeightRatio = 0.85,
  footer,
  dismissible = true,
  padded = true,
  children,
  style,
}: BottomSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();

  // The Modal must outlive `open` so the exit animation can play; `mounted`
  // trails `open` and is cleared only once the sheet is off-screen.
  const [mounted, setMounted] = useState(open);
  const translateY = useSharedValue(screenHeight);
  const backdrop = useSharedValue(0);

  const finishClose = useCallback(() => {
    setMounted(false);
    onClose();
  }, [onClose]);

  const animateOut = useCallback(() => {
    backdrop.value = withTiming(0, { duration: duration.fast });
    translateY.value = withTiming(
      screenHeight,
      { duration: duration.base, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
  }, [backdrop, translateY, screenHeight, finishClose]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      translateY.value = screenHeight;
      backdrop.value = withTiming(1, { duration: duration.base });
      translateY.value = withTiming(0, {
        duration: duration.base,
        easing: Easing.out(Easing.cubic),
      });
    } else if (mounted) {
      animateOut();
    }
    // `mounted` is intentionally excluded: reacting to it would re-run the
    // entry animation when the exit animation clears it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pan = Gesture.Pan()
    .onChange((event) => {
      // Downward only. Dragging up must not detach the sheet from the bottom.
      translateY.value = Math.max(0, translateY.value + event.changeY);
    })
    .onEnd((event) => {
      const shouldDismiss =
        translateY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY;
      if (shouldDismiss && dismissible) {
        runOnJS(animateOut)();
      } else {
        translateY.value = withTiming(0, { duration: duration.fast });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;

  const maxHeight = screenHeight * maxHeightRatio;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={dismissible ? animateOut : undefined}
    >
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={t('action.close')}
            onPress={dismissible ? animateOut : undefined}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight,
              // Lift clear of the keyboard; fall back to the home indicator.
              paddingBottom: keyboardHeight > 0 ? keyboardHeight : insets.bottom,
            },
            sheetStyle,
            style,
          ]}
        >
          {/*
            The drag gesture covers the handle and header only, not the whole
            sheet. Sheets contain scrollable lists, and a pan over the content
            would compete with the list's own scroll — pulling the sheet down
            when the user meant to scroll up through suppliers.
          */}
          <GestureDetector gesture={pan}>
            <View>
              {dismissible ? <View style={styles.handle} /> : null}

              {title ? (
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text variant="heading" numberOfLines={1}>
                      {title}
                    </Text>
                    {subtitle ? (
                      <Text variant="caption" tone="tertiary" numberOfLines={2}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {dismissible ? (
                    <IconButton
                      icon={X}
                      accessibilityLabel={t('action.close')}
                      onPress={animateOut}
                      size={36}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          </GestureDetector>

          <View style={[styles.body, padded ? styles.bodyPadded : null]}>{children}</View>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: colors.surface.scrim,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface.card,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    ...elevation.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border.strong,
    marginTop: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingStart: space.lg,
    paddingEnd: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  body: {
    flexShrink: 1,
  },
  bodyPadded: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.base,
  },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    gap: space.sm,
  },
});
