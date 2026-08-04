import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react-native';
import { colors, type Intent } from '../../lib/design/colors';
import { elevation, radius, space } from '../../lib/design/tokens';
import { useToastStore, type Toast, type ToastTone } from '../../lib/toast';
import { useTranslation } from '../../lib/i18n';
import { Text } from '../ui/Text';
import { usePressed } from '../ui/use-pressed';
import type { IconComponent } from '../ui/Button';

/**
 * Renders the toast queue.
 *
 * Anchored to the TOP of the screen on purpose. Workflow screens pin their
 * primary action to the bottom — "Charge 45 000 MRU", "Finish receiving" — and
 * a toast over that button would either hide it or swallow the tap that was
 * already on its way.
 *
 * Mounted once, at the app root, above the navigator.
 */

const TONE_META: Record<ToastTone, { intent: Intent; icon: IconComponent }> = {
  success: { intent: 'success', icon: CircleCheck },
  error: { intent: 'danger', icon: CircleAlert },
  warning: { intent: 'warning', icon: TriangleAlert },
  info: { intent: 'info', icon: Info },
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View style={[styles.host, { paddingTop: insets.top + space.sm }]}>
      {toasts.map((item) => (
        <ToastCard key={item.id} toast={item} />
      ))}
    </View>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismiss);
  const actionPress = usePressed();
  const { intent, icon: Icon } = TONE_META[toast.tone];
  const palette = colors.intent[intent];

  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(160)}
      layout={LinearTransition.duration(180)}
      style={[styles.card, { borderColor: palette.border, backgroundColor: palette.bg }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${toast.message}. ${t('toast.dismiss')}`}
        onPress={() => dismiss(toast.id)}
        style={styles.pressable}
      >
        <Icon color={palette.fg} size={20} />
        <View style={styles.body}>
          <Text variant="bodyStrong" style={{ color: palette.fg }} numberOfLines={2}>
            {toast.message}
          </Text>
          {toast.description ? (
            <Text variant="caption" style={{ color: palette.fg, opacity: 0.85 }} numberOfLines={3}>
              {toast.description}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {toast.action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
          onPress={() => {
            toast.action?.onPress();
            dismiss(toast.id);
          }}
          hitSlop={8}
          {...actionPress.pressHandlers}
          style={[
            styles.action,
            { borderColor: palette.border },
            actionPress.pressed ? { opacity: 0.6 } : null,
          ]}
        >
          <Text variant="label" style={{ color: palette.fg, fontWeight: '700' }}>
            {toast.action.label}
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.base,
    gap: space.sm,
    // Above the navigator, below nothing.
    zIndex: 1000,
    // Taps pass through the container's empty area to the screen underneath —
    // a toast must never swallow a press aimed at the button behind it.
    pointerEvents: 'box-none',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...elevation.md,
  },
  pressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  action: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
