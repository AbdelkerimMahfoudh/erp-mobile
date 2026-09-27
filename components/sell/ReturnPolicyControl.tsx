import React from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '../../lib/design/tokens';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { allowedWindowChoices, describeWindow } from '../../lib/return-policy';
import { FilterChip } from '../ui/Chip';
import { Text } from '../ui/Text';

/**
 * The return policy this sale will carry, shown as it is being completed.
 *
 * An employee sees it and cannot change it. The control is **read-only rather
 * than hidden**: knowing what the customer is being promised is part of serving
 * them, and a policy nobody at the counter can see is one nobody states.
 *
 * A manager or owner may remove the window or lengthen it, but the choices
 * deliberately exclude shortening a positive window to another positive value —
 * trimming 48 hours to 2 sells a worse promise under the same banner. The server
 * refuses that regardless of what this screen offers; the screen simply does not
 * offer what would be refused.
 *
 * No reason is asked (2026-09-27): the change is recorded with who made it and
 * the window it set, on the sale and in the audit.
 */

export interface ReturnPolicyControlProps {
  /** The shop's setting, as the server reports it. */
  companyDefaultHours: number;
  /** What this sale will carry. Equal to the default until somebody changes it. */
  windowHours: number;
  onWindowChange: (hours: number) => void;
  canOverride: boolean;
}

export function ReturnPolicyControl({
  companyDefaultHours,
  windowHours,
  onWindowChange,
  canOverride,
}: ReturnPolicyControlProps) {
  const { t } = useTranslation();
  const choices = allowedWindowChoices(companyDefaultHours, canOverride);

  /**
   * A preview, and only a preview. The sale does not exist yet, so there is no
   * server deadline to show — this is computed from the device to answer "until
   * when?" before the customer pays. The authoritative deadline is the one that
   * comes back on the sale and is printed on the receipt, measured from the
   * server's own clock.
   */
  const preview =
    windowHours > 0 ? new Date(Date.now() + windowHours * 3_600_000) : null;

  return (
    <View style={styles.group}>
      <Text variant="label" tone="secondary">
        {t('returns.policy.title')}
      </Text>

      {canOverride && choices.length > 1 ? (
        // Wrapping chips: five windows do not fit one segmented row at phone width.
        <View style={styles.chips} accessibilityRole="radiogroup">
          {choices.map((hours) => (
            <FilterChip
              key={hours}
              label={describeWindow(hours, t)}
              selected={windowHours === hours}
              onPress={() => onWindowChange(hours)}
            />
          ))}
        </View>
      ) : (
        <Text variant="body">{describeWindow(windowHours, t)}</Text>
      )}

      <Text variant="caption" tone="tertiary">
        {preview
          ? t('returns.policy.deadlinePreview', { deadline: formatDateTime(preview) })
          : t('returns.policy.noReturnsPreview')}
      </Text>

      {!canOverride ? (
        // Said plainly rather than by a disabled control with no explanation.
        <Text variant="caption" tone="tertiary">
          {t('returns.policy.readOnly')}
        </Text>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
