import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, MoneyField, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { parseBuyingCost } from '../../lib/missing-cost';
import { toErrorMessage } from '../../lib/errors';

/**
 * Entering a buying cost that was not known when the stock was received (D223, 0107).
 *
 * For an Owner or a Manager (`cost.complete`). Saving is audited on the server,
 * moves no money and never changes a sale's price. The sheet closes only after
 * the server confirmed the cost; a refusal stays on screen, interactive, with
 * what was typed still there.
 */
export function AddCostSheet({
  open,
  subtitle,
  onClose,
  onSave,
}: {
  open: boolean;
  /** What the cost is for — the item, or the received line. */
  subtitle?: string;
  onClose: () => void;
  /** Resolves once the server saved it; throws to keep the sheet open with the error. */
  onSave: (cost: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCost('');
    setError(undefined);
  }, [open]);

  const save = async () => {
    if (saving) return;
    const parsed = parseBuyingCost(cost);
    if (parsed === null || parsed === 'invalid') {
      setError(t('cost.invalid'));
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      onClose();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      scroll
      open={open}
      onClose={onClose}
      title={t('cost.complete.title')}
      footer={<Button title={t('cost.missing.add')} fullWidth loading={saving} disabled={saving} onPress={() => void save()} />}
    >
      <View style={styles.body}>
        {subtitle ? (
          <Text variant="body" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
        <MoneyField
          label={t('cost.label')}
          hint={t('cost.optional.hint')}
          value={cost}
          error={error}
          onChangeText={(v) => {
            setCost(v);
            setError(undefined);
          }}
          autoFocus
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
});
