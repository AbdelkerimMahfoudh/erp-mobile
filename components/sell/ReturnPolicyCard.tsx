import React, { useState } from 'react';
import { View } from 'react-native';
import { radius, space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { customWindowProblem, describeWindow, RETURN_WINDOW_MAX_DAYS, reviewWindowChoices } from '../../lib/return-policy';
import { FilterChip } from '../ui/Chip';
import { TextField } from '../ui/Field';
import { Text } from '../ui/Text';

/**
 * The return policy this sale will carry, on the Review sale screen (the owner's
 * brief of 2026-10-17, Picture 1) — where the seller states it to the customer,
 * before taking any money.
 *
 * 1, 2 and 3 days, the shop's own default when it is something else, no returns
 * for whoever may change the policy, and "Choose duration" for any number of
 * days up to a year. The existing rules hold (`reviewWindowChoices`): an
 * employee sees the shop's policy and cannot change it, and nobody shortens a
 * positive default to another positive window — a choice the server would
 * refuse is not offered, and one sentence says why.
 *
 * The deadline shown is a preview from the phone's clock. The server sets the
 * real one from the moment the sale is confirmed, and that is what the receipt
 * prints.
 */
export interface ReturnPolicyCardProps {
  companyDefaultHours: number;
  windowHours: number;
  onWindowChange: (hours: number) => void;
  canOverride: boolean;
}

export function ReturnPolicyCard({ companyDefaultHours, windowHours, onWindowChange, canOverride }: ReturnPolicyCardProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const choices = reviewWindowChoices(companyDefaultHours, canOverride);
  const offered = choices.filter((c) => c.allowed);
  const fixed = offered.some((c) => c.hours === windowHours);
  /** "Choose duration" is open, or the window chosen is one of its own. */
  const [custom, setCustom] = useState(!fixed);
  const [daysText, setDaysText] = useState(!fixed && windowHours > 0 && windowHours % 24 === 0 ? String(windowHours / 24) : '');
  const problem = custom ? customWindowProblem(daysText, companyDefaultHours) : null;
  /** The preview counts from when the screen opened; the server counts from the confirmed sale. */
  const [shownAt] = useState(() => Date.now());

  const chooseFixed = (hours: number) => {
    setCustom(false);
    onWindowChange(hours);
  };
  const typeDays = (text: string) => {
    setDaysText(text);
    // Only a valid duration becomes the sale's; until then the last valid one stays.
    if (customWindowProblem(text, companyDefaultHours) === null) onWindowChange(Number(text.trim()) * 24);
  };

  /** A choice's own label: "No returns" as Settings says it, else "2 days". */
  const labelOf = (hours: number) => (hours <= 0 ? t('settings.returns.none') : describeWindow(hours, t));
  const preview = windowHours > 0 ? new Date(shownAt + windowHours * 3_600_000) : null;
  const hidden = choices.length - offered.length;

  return (
    <View style={styles.card}>
      <Text variant="labelStrong">{t('returns.policy.title')}</Text>

      {canOverride && offered.length > 0 ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {offered.map(({ hours }) => (
            <FilterChip key={hours} label={labelOf(hours)} selected={!custom && windowHours === hours} onPress={() => chooseFixed(hours)} />
          ))}
          <FilterChip label={t('returns.card.custom')} selected={custom} onPress={() => setCustom(true)} />
        </View>
      ) : (
        <Text variant="bodyStrong">{labelOf(windowHours)}</Text>
      )}

      {canOverride && custom ? (
        <TextField
          label={t('returns.card.customLabel')}
          accessibilityLabel={t('returns.card.customLabel')}
          value={daysText}
          onChangeText={typeDays}
          keyboardType="number-pad"
          maxLength={3}
          error={
            problem && problem !== 'empty'
              ? t(`returns.card.problem.${problem}` as never, { max: RETURN_WINDOW_MAX_DAYS, window: describeWindow(companyDefaultHours, t) })
              : undefined
          }
        />
      ) : null}

      <Text variant="body" tone="secondary">
        {preview ? t('returns.policy.deadlinePreview', { deadline: formatDateTime(preview) }) : t('returns.policy.noReturnsPreview')}
      </Text>
      <Text variant="caption" tone="tertiary">
        {t('returns.card.finalNote')}
      </Text>
      {canOverride && hidden > 0 ? (
        <Text variant="caption" tone="tertiary">
          {t('returns.card.shorterNote', { window: describeWindow(companyDefaultHours, t) })}
        </Text>
      ) : null}
      {!canOverride ? (
        <Text variant="caption" tone="tertiary">
          {t('returns.policy.readOnly')}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: space.sm,
    padding: space.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.intent.info.bg,
    borderColor: colors.intent.info.border,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
