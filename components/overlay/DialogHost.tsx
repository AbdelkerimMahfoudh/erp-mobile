import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion, ZoomIn } from 'react-native-reanimated';
import { motion } from '../../lib/design/motion';
import { elevation, radius, space } from '../../lib/design/tokens';
import { useDialogStore } from '../../lib/dialog';
import { useKeyboardHeight } from '../../lib/use-keyboard-height';
import { useTranslation } from '../../lib/i18n';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Text } from '../ui/Text';
import { makeStyles } from '../../lib/design/theme';

/**
 * Renders the active dialog. Mounted once at the app root.
 *
 * Dismissal is intentionally stricter than a bottom sheet's: the backdrop and
 * the Android back button cancel, but there is no drag-away. A dialog is only
 * used where the decision genuinely matters, so it should not be possible to
 * dismiss one with a stray thumb during a sale.
 */
export function DialogHost() {
  const styles = useStyles();
  const { t } = useTranslation();
  const active = useDialogStore((s) => s.queue[0]);
  const resolveTop = useDialogStore((s) => s.resolveTop);
  const keyboardHeight = useKeyboardHeight();
  const [reason, setReason] = useState('');

  // Clear the field between dialogs so a previous override reason can never be
  // carried into the next one.
  useEffect(() => {
    setReason('');
  }, [active?.id]);

  if (!active) return null;

  const cancel = () => resolveTop({ confirmed: false });
  const confirm = () =>
    resolveTop({ confirmed: true, reason: active.requireReason ? reason.trim() : undefined });

  const confirmDisabled = active.requireReason && reason.trim().length === 0;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={cancel}>
      <Animated.View
        entering={FadeIn.duration(motion.reveal).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(motion.press).reduceMotion(ReduceMotion.System)}
        style={[styles.backdrop, keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null]}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" onPress={cancel} />

        {/*
          No spring, and Reduce Motion takes the scale away entirely.

          This used to be `.springify().damping(18)` — the card overshot and
          settled. A dialog is where the app asks "are you sure you want to
          refund this?", and a control that bounces cheerfully into view reads
          as playful exactly where the answer matters most. It also made the
          text unreadable for the length of the wobble.
        */}
        <Animated.View
          entering={ZoomIn.duration(motion.reveal).reduceMotion(ReduceMotion.System)}
          style={styles.card}
        >
          <View style={styles.copy}>
            <Text variant="heading" align="center">
              {active.title}
            </Text>
            {active.message ? (
              <Text variant="body" tone="secondary" align="center">
                {active.message}
              </Text>
            ) : null}
          </View>

          {active.requireReason ? (
            <TextField
              label={active.reasonLabel}
              placeholder={active.reasonPlaceholder}
              value={reason}
              onChangeText={setReason}
              autoFocus
              multiline
              required
              maxLength={255}
            />
          ) : null}

          <View style={styles.actions}>
            <Button
              title={active.confirmLabel ?? t('action.confirm')}
              variant={active.tone === 'danger' ? 'danger' : 'primary'}
              fullWidth
              disabled={confirmDisabled}
              onPress={confirm}
            />
            {active.acknowledgeOnly ? null : (
              <Button
                title={active.cancelLabel ?? t('action.cancel')}
                variant="secondary"
                fullWidth
                onPress={cancel}
              />
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.surface.scrim,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface.card,
    ...elevation.lg,
  },
  copy: {
    gap: space.xs,
  },
  actions: {
    gap: space.sm,
  },
}));
