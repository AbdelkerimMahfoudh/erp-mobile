import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion, ZoomIn } from 'react-native-reanimated';
import { motion } from '../../lib/design/motion';
import { elevation, radius, space, touch } from '../../lib/design/tokens';
import { useDialogStore, type DialogChoice } from '../../lib/dialog';
import { isTopSheet, useSheetStack } from '../../lib/sheet-stack';
import { useKeyboardHeight } from '../../lib/use-keyboard-height';
import { useTranslation } from '../../lib/i18n';
import { Button } from '../ui/Button';
import { ModalBoundary } from './ModalBoundary';
import { TextField } from '../ui/Field';
import { Text } from '../ui/Text';
import { makeStyles } from '../../lib/design/theme';
import { usePressed } from '../ui/use-pressed';

/**
 * Renders the active dialog.
 *
 * Two hosts share one card. `DialogHost` is mounted once at the app root and
 * presents the dialog in its own modal — but only while no bottom sheet is
 * open. When a sheet IS open, the top-most sheet renders `SheetDialogLayer`
 * inside its own modal instead, so the dialog is drawn in the layer the person
 * is already looking at rather than as a second native modal stacked on the
 * first. On iOS that second modal is not reliably shown, and a confirmation
 * nobody can see is a promise that never resolves: the payment sheet's button
 * spins forever. This is what happened when a sale needed a below-cost reason
 * or a "does this look right?" answer while the payment sheet was up.
 *
 * Dismissal is intentionally stricter than a bottom sheet's: the backdrop and
 * the Android back button cancel, but there is no drag-away. A dialog is only
 * used where the decision genuinely matters, so it should not be possible to
 * dismiss one with a stray thumb during a sale.
 */
export function DialogHost() {
  const sheetOpen = useSheetStack((s) => s.ids.length > 0);
  const active = useDialogStore((s) => s.queue[0]);
  const resolveTop = useDialogStore((s) => s.resolveTop);
  if (!active || sheetOpen) return null;
  const cancel = () => resolveTop({ confirmed: false });
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={cancel}>
      <ModalBoundary>
        <DialogCard />
      </ModalBoundary>
    </Modal>
  );
}

/** The dialog, drawn inside the sheet that is on top. Nothing when this sheet is not the top one. */
export function SheetDialogLayer({ sheetId }: { sheetId: string }) {
  const top = useSheetStack((s) => isTopSheet(s.ids, sheetId));
  const active = useDialogStore((s) => s.queue[0]);
  if (!top || !active) return null;
  return <DialogCard inline />;
}

/**
 * The vertical room a dialog card may take, so its actions are never pushed off the screen (D225).
 *
 * The backdrop pads the card by `space.xl` on every side; a raised keyboard takes its own height
 * away. Whatever the copy needs beyond what remains scrolls INSIDE the card, while the actions below
 * the scrolled body stay where a thumb can reach them — at 320 pt and at the largest text size alike.
 */
export function dialogMaxHeight(windowHeight: number, keyboardHeight: number): number {
  return Math.max(0, windowHeight - keyboardHeight - 2 * space.xl);
}

function DialogCard({ inline = false }: { inline?: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const active = useDialogStore((s) => s.queue[0]);
  const resolveTop = useDialogStore((s) => s.resolveTop);
  const keyboardHeight = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
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
    <Animated.View
      entering={FadeIn.duration(motion.reveal).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(motion.press).reduceMotion(ReduceMotion.System)}
      style={[
        styles.backdrop,
        inline ? StyleSheet.absoluteFill : null,
        keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null,
      ]}
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
        style={[styles.card, { maxHeight: dialogMaxHeight(windowHeight, keyboardHeight) }]}
      >
        {/*
          The copy, the reason and the answers scroll; the confirm and cancel buttons do not.
          `flexShrink` lets the body give up height to the actions instead of pushing them out
          of the card, and `bounces` off keeps a short dialog from looking like a list.
        */}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          bounces={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
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

          {active.choices ? (
            <View style={styles.choices}>
              {active.choices.map((choice, index) => (
                <DialogChoiceOption
                  key={`${index}:${choice.title}`}
                  choice={choice}
                  onPress={() => resolveTop({ confirmed: true, choice: index })}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          {active.choices ? null : (
            <Button
              title={active.confirmLabel ?? t('action.confirm')}
              variant={active.tone === 'danger' ? 'danger' : 'primary'}
              fullWidth
              wrap
              disabled={confirmDisabled}
              onPress={confirm}
            />
          )}
          {active.acknowledgeOnly ? null : (
            <Button
              title={active.cancelLabel ?? t('action.cancel')}
              variant="secondary"
              fullWidth
              wrap
              onPress={cancel}
            />
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * One answer, drawn as an option rather than a button (D225).
 *
 * A button's label is one line and is cut when it does not fit; an answer to a question that
 * decides how stock is recorded must be read whole. So the title and its description wrap freely,
 * the option grows with them, and the whole option is one target of at least 48 pt. Every answer
 * looks the same: none is pre-selected by colour, because the person — not the app — decides.
 */
export function DialogChoiceOption({ choice, onPress }: { choice: DialogChoice; onPress: () => void }) {
  const styles = useStyles();
  const { pressed, pressHandlers } = usePressed();
  const label = choice.description ? `${choice.title}. ${choice.description}` : choice.title;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...pressHandlers}
      style={[styles.choice, pressed ? styles.choicePressed : null]}
    >
      <Text variant="bodyStrong">{choice.title}</Text>
      {choice.description ? (
        <Text variant="body" tone="secondary">
          {choice.description}
        </Text>
      ) : null}
    </Pressable>
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
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    gap: space.lg,
  },
  copy: {
    gap: space.xs,
  },
  choices: {
    gap: space.sm,
  },
  choice: {
    minHeight: touch.min,
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
  },
  choicePressed: {
    backgroundColor: colors.surface.sunken,
    borderColor: colors.border.strong,
  },
  actions: {
    gap: space.sm,
  },
}));
