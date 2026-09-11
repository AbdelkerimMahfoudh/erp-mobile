import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Chip, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { money } from '../../lib/theme';
import { sourceExplanation, sourceLabel } from '../../lib/pricing';
import type { EffectivePrice } from '../../types/api';

/**
 * What this sells for here, and why.
 *
 * Every store role sees this — an employee at the counter needs the price more
 * than anyone. The "why" matters as much as the number: a manager who cannot
 * tell a branch price from the company fallback cannot tell whether their branch
 * has been priced at all.
 *
 * Source is shown in words with a tone, never by colour alone.
 */

export interface PriceSummaryProps {
  pricing: EffectivePrice;
  branchName: string;
}

export function PriceSummary({ pricing, branchName }: PriceSummaryProps) {
  const { t } = useTranslation();
  const unpriced = pricing.source === 'unpriced';

  return (
    <Card>
      <View style={styles.headline}>
        <Text variant="caption" tone="tertiary">
          {t('pricing.effective')}
        </Text>
        <Text variant="title">
          {/* Never a fake zero: no price is a state, not an amount. */}
          {pricing.price === null ? t('pricing.source.unpriced') : money(pricing.price)}
        </Text>
        <Text variant="caption" tone="tertiary">
          {t('pricing.inBranch', { branch: branchName })}
        </Text>
      </View>

      <View style={styles.sourceRow}>
        <Chip label={sourceLabel(pricing.source)} tone={unpriced ? 'warning' : 'info'} size="sm" />
      </View>
      <Text variant="caption" tone="tertiary" style={styles.explain}>
        {sourceExplanation(pricing.source)}
      </Text>

      {/*
        An override that belongs to another branch is reported, not applied.
        Saying so is the difference between "the app is wrong" and "that price
        was set somewhere else".
      */}
      {pricing.staleOverrideIgnored ? (
        <Text variant="caption" tone="warning" style={styles.explain}>
          {t('pricing.staleOverrideIgnored')}
        </Text>
      ) : null}

      {unpriced ? (
        <Text variant="caption" tone="warning" style={styles.explain}>
          {t('pricing.unpricedBody')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headline: { gap: space.xs },
  sourceRow: { flexDirection: 'row', marginTop: space.md },
  explain: { marginTop: space.sm },
});
