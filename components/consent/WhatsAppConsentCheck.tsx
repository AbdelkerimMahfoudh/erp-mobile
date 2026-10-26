import React, { forwardRef } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { Check } from 'lucide-react-native';
import { Button, InlineNotice, Text } from '../ui';
import { LegalPageButtons } from '../legal/LegalPages';
import { radius, space, touch } from '../../lib/design/tokens';
import { useColors } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import type { WhatsAppConsentCopy } from '../../types/api';

/**
 * The operational WhatsApp consent, as a box the person ticks (the owner's brief of 2026-10-19; D213).
 *
 * The words are the server's — the copy whose version the agreement sends back — so the screen can never show one
 * text and record another. The box starts unticked wherever it appears and is ticked only by the person: nothing
 * else on a screen may set it. The whole row is the target, at least a thumb's height, and a screen reader hears it
 * as a checkbox with its state, the agreement as its name, and the problem, when there is one, as its hint.
 *
 * Beside it, the privacy policy — a page to read in the phone's browser, never a purchase.
 */
export interface WhatsAppConsentCheckProps {
  copy: WhatsAppConsentCopy | null | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Why the screen cannot go on: shown under the box and read with it. */
  error?: string;
  /** Show the copy's explanation above the box: why WhatsApp is the contact it asks about. */
  explain?: boolean;
  disabled?: boolean;
}

export const WhatsAppConsentCheck = forwardRef<ViewInstance, WhatsAppConsentCheckProps>(function WhatsAppConsentCheck(
  { copy, loading, failed, onRetry, checked, onChange, error, explain = true, disabled = false },
  ref,
) {
  const { t } = useTranslation();
  const colors = useColors();

  if (!copy) {
    if (failed) {
      return (
        <View style={styles.stack}>
          <InlineNotice tone="danger">{t('consent.loadFailed')}</InlineNotice>
          <Button title={t('action.retry')} variant="secondary" size="sm" onPress={onRetry} />
        </View>
      );
    }
    return (
      <Text variant="caption" tone="secondary">
        {loading ? t('consent.loading') : t('consent.loadFailed')}
      </Text>
    );
  }

  const boxColor = error ? colors.intent.danger.solid : checked ? colors.intent.info.solid : colors.border.strong;

  return (
    <View style={styles.stack}>
      {explain ? (
        <Text variant="caption" tone="secondary">
          {copy.body}
        </Text>
      ) : null}
      <Pressable
        ref={ref}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        aria-checked={checked}
        accessibilityLabel={copy.agreement}
        accessibilityHint={error ?? t('consent.a11y.hint')}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        style={styles.row}
        testID="whatsapp-consent-check"
      >
        <View
          style={[
            styles.box,
            { borderColor: boxColor, backgroundColor: checked ? colors.intent.info.solid : colors.surface.card },
          ]}
        >
          {checked ? <Check size={18} color={colors.intent.info.onSolid} strokeWidth={3} /> : null}
        </View>
        <Text variant="body" style={styles.label}>
          {copy.agreement}
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <LegalPageButtons pages={['privacy']} />
    </View>
  );
});

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: touch.min, paddingVertical: space.xs },
  box: {
    width: 26,
    height: 26,
    borderWidth: 2,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  label: { flex: 1 },
});
