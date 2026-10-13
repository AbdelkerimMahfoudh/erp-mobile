import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, InlineNotice, Text } from '../ui';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { deliveryLines, deliveryTone, type EligibleTrialSetup } from '../../lib/trial-setup';

/**
 * The Owner's word on the free trial, on the closed screen (0095; the owner's
 * correction of 2026-10-13).
 *
 * DISPLAY ONLY. It says what the server knows: the business is eligible, the
 * trial has not started, how many days it lasts once it is claimed, which
 * verified contacts the setup instructions go to (as the server masks them),
 * and whether they were sent — or, honestly, that they cannot be sent right
 * now. Nothing in it can be pressed: no button, no link, no countdown, no
 * request. The trial is started on the Dukan ERP website alone, and sending
 * the instructions again happens there once the Owner has signed in, or
 * through support; `lib/access-boundary.test.ts` and the bundle audit keep it
 * that way.
 *
 * Shown only for an eligible answer of `GET account/trial-setup`, which the
 * server gives the business's Owner alone.
 */
export function TrialSetupCard({ status }: { status: EligibleTrialSetup }) {
  const { t } = useTranslation();
  return (
    <Card testID="trial-setup-card" style={styles.card}>
      <Text variant="heading">{t('trialSetup.title')}</Text>
      <Text tone="secondary">{t('trialSetup.notStarted')}</Text>

      <View style={styles.rows}>
        {/* Read aloud as available AND not started, so it is never heard as a trial that is running. */}
        <Text variant="bodyStrong" accessibilityLabel={t('trialSetup.status.label')}>
          {t('trialSetup.status')}
        </Text>
        {/* The server's number of days: nothing here divides hours. */}
        <Text>{t('trialSetup.duration', { durationDays: status.durationDays })}</Text>
        <Text>{t('trialSetup.startsAfterClaim')}</Text>
        {status.destinations.map((destination) => (
          <Text key={`${destination.channel}:${destination.masked}`}>
            {t('trialSetup.contact', { masked: isolateLtr(destination.masked) })}
          </Text>
        ))}
      </View>

      {deliveryLines(status).map((key) => (
        <InlineNotice key={key} tone={deliveryTone(status.delivery)}>
          {t(key)}
        </InlineNotice>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  rows: { gap: space.xs, marginTop: space.xs },
});
