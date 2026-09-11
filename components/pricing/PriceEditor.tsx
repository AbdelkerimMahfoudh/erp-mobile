import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheet } from '../overlay';
import { Button, Card, MoneyField, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { useTranslation } from '../../lib/i18n';
import { money } from '../../lib/theme';
import { canSave, parsePrice } from '../../lib/price-input';
import {
  fetchEffectivePrice,
  isStaleEdit,
  sourceLabel,
  staleEditMessage,
  useSavePrice,
  type PriceScope,
} from '../../lib/pricing';
import type { EffectivePrice } from '../../types/api';

/**
 * The one price editor — branch variant, one exact phone, and quantity stock all
 * use it.
 *
 * Three separate editors would be three chances for the version handling, the
 * below-cost flow or the "what does this affect?" wording to drift apart, and a
 * pricing mistake is money.
 *
 * It never decides anything financial itself: the current price, its source and
 * its version all come from the server, and the below-cost conversation belongs
 * to `useSavePrice`.
 */

export interface PriceEditorProps {
  open: boolean;
  onClose: () => void;
  /** What is being priced — decides the endpoint and the explanation shown. */
  scope: PriceScope;
  /** The server's current answer for this thing. */
  current: EffectivePrice;
  /** Product label, for the "this affects every …" sentence. */
  productLabel: string;
  branchName: string;
  /** Invalidated by the mutation; the caller only needs to close. */
  onSaved?: () => void;
}

export function PriceEditor({
  open,
  onClose,
  scope,
  current,
  productLabel,
  branchName,
  onSaved,
}: PriceEditorProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const save = useSavePrice();

  const dirty = input.trim().length > 0;
  const parsed = parsePrice(input);
  const ready = canSave(input, current.price);

  const scopeSentence =
    scope.kind === 'unit'
      ? t('pricing.editor.scopeUnit', { branch: branchName })
      : scope.kind === 'stock_item'
        ? t('pricing.editor.scopeStock', { label: productLabel, branch: branchName })
        : t('pricing.editor.scopeBranch', { label: productLabel, branch: branchName });

  /** Closing with an unsaved number should not lose it silently. */
  const requestClose = async () => {
    if (!dirty || save.isPending) {
      setInput('');
      onClose();
      return;
    }
    const confirmed = await dialog.confirm({
      title: t('pricing.editor.discard'),
      message: t('pricing.editor.discardBody'),
      confirmLabel: t('pricing.editor.discardConfirm'),
      tone: 'danger',
    });
    if (confirmed) {
      setInput('');
      onClose();
    }
  };

  const submit = async () => {
    if (!parsed.ok) return;
    try {
      await save.mutateAsync({
        scope,
        price: parsed.value,
        // Exactly what the server last returned. A fallback has no row, so it
        // has no version, and the server treats that as a create.
        expectedVersion: current.version,
        productId: scope.kind === 'unit' ? undefined : scope.productId,
      });
      setInput('');
      onClose();
      onSaved?.();
    } catch (error) {
      /**
       * A stale edit is explained, never retried for the user. Refreshing and
       * resubmitting would overwrite the decision someone else just made.
       */
      if (isStaleEdit(error)) {
        /**
         * Ask the server what the price actually is now. `current` is the
         * snapshot this editor opened with, and it is precisely the thing that
         * just turned out to be stale — quoting it back would tell the user the
         * wrong "current" price in the very message warning them about staleness.
         */
        let latest = current.price;
        try {
          latest = (await fetchEffectivePrice(scope)).price;
        } catch {
          // Offline or refused: fall back to explaining without a stale claim.
          latest = null;
        }
        await dialog.alert({
          title: t('pricing.conflict.title'),
          message: staleEditMessage(parsed.value, latest),
          confirmLabel: t('pricing.conflict.reload'),
        });
        setInput('');
        onClose();
        onSaved?.(); // caller refetches; the user sees the real current price
        return;
      }
      // Below-cost refusal and everything else already surfaced by the mutation.
    }
  };

  const validationMessage =
    !dirty || parsed.ok
      ? null
      : parsed.reason === 'negative'
        ? t('pricing.editor.negative')
        : t('pricing.editor.invalid');

  return (
    <BottomSheet open={open} onClose={requestClose} title={t('pricing.section')}>
      <View style={styles.body}>
        <Card>
          <View style={styles.row}>
            <Text tone="secondary">{t('pricing.editor.currentPrice')}</Text>
            <Text variant="bodyStrong">
              {current.price === null ? t('pricing.source.unpriced') : money(current.price)}
            </Text>
          </View>
          {/* Source in words — never colour alone. */}
          <Text variant="caption" tone="tertiary">
            {sourceLabel(current.source)}
          </Text>
        </Card>

        <MoneyField
          label={t('pricing.editor.newPrice')}
          value={input}
          onChangeText={setInput}
          autoFocus
          error={validationMessage ?? undefined}
        />

        <Text variant="caption" tone="tertiary" style={styles.scope}>
          {scopeSentence}
        </Text>

        <Button
          title={t('pricing.editor.save')}
          onPress={submit}
          // Disabled until the number is real AND different: a Save that does
          // nothing still looks like it did something.
          disabled={!ready || save.isPending}
          loading={save.isPending}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.base },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scope: {},
});
