import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, Text } from '../ui';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { formatDate } from '../../lib/format';
import { isolateLtr } from '../../lib/design/direction';
import { useTranslation } from '../../lib/i18n';
import { reopenOptions, type ReopenMode } from '../../lib/home-day';

/**
 * The before-06:00 choice (docs/50 §3.2, reference 06).
 *
 * Shown only when the server offered more than "continue": after local
 * midnight, before 06:00, to somebody who may start a day early — the Owner.
 * The choices and the time in the title are the server's: at 07:25 by the
 * store's clock the early start is never offered, whatever the phone says.
 * The safe default is selected; the early start is a deliberate second tap.
 * Selling is never blocked while the sheet is open, and the sheet says so.
 */
export interface ReopenSheetProps {
  open: boolean;
  onClose: () => void;
  /** The day being reopened, YYYY-MM-DD. */
  businessDate: string;
  /** The day an early start would begin, YYYY-MM-DD. */
  nextDate: string;
  /** The store's wall clock as the server read it, HH:mm — the title never uses the phone's clock. */
  now: string;
  /** What the server offered. */
  choices: readonly ReopenMode[];
  busy?: boolean;
  onConfirm: (mode: ReopenMode) => void;
}

export function ReopenSheet({ open, onClose, businessDate, nextDate, now, choices, busy, onConfirm }: ReopenSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const options = reopenOptions(choices);
  const [mode, setMode] = useState<ReopenMode>(options[0].mode);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('reopen.title', { time: isolateLtr(now) })}
      subtitle={t('reopen.question')}
      footer={
        <View style={styles.footer}>
          <Button title={t('reopen.confirm')} fullWidth loading={busy} disabled={busy} onPress={() => onConfirm(mode)} />
          <Text variant="caption" tone="tertiary" align="center">
            {t('reopen.note')}
          </Text>
        </View>
      }
    >
      <View style={styles.options} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Choice
            key={o.mode}
            selected={mode === o.mode}
            title={o.mode === 'continue' ? t('reopen.continue.title', { date: formatDate(businessDate) }) : t('reopen.startNew.title', { date: formatDate(nextDate) })}
            body={o.mode === 'continue' ? t('reopen.continue.body') : t('reopen.startNew.body')}
            onPress={() => setMode(o.mode)}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

function Choice({ selected, title, body, onPress }: { selected: boolean; title: string; body: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}
    >
      <View style={[styles.radio, selected && { borderColor: colors.semantic.primary }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: colors.semantic.primary }]} /> : null}
      </View>
      <View style={styles.choiceText}>
        <Text variant="heading">{title}</Text>
        <Text variant="body" tone="secondary">
          {body}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  options: { gap: space.md, paddingVertical: space.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.card,
    minHeight: 72,
  },
  choiceSelected: { borderColor: colors.semantic.primary, backgroundColor: colors.semantic.primarySoft },
  pressed: { opacity: 0.8 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 12, height: 12, borderRadius: radius.full },
  choiceText: { flex: 1, minWidth: 0, gap: 2 },
  footer: { gap: space.sm },
}));
