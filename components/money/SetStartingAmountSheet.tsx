import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { BottomSheet } from '../overlay';
import { Button, MoneyField, Text, TextField } from '../ui';
import { ApiError } from '../../lib/api-client';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { useRecordMoneyAnchor, type TrackedMethod } from '../../lib/money-overview';
import { RequestTimeout } from '../../lib/offline/classify';
import { parseAmount } from '../../lib/price-input';
import { toast } from '../../lib/toast';

/**
 * Setting the amount an account holds now — what Money tracks it from (0082).
 *
 * The Owner reads the figure off the account's own app: this app never asks a
 * provider for a balance. From then on the card shows that amount plus what is
 * recorded here, and the sheet says so before anything is saved. Zero is an
 * amount (an empty wallet); nothing below it, nothing past two decimals.
 */
export function SetStartingAmountSheet({
  open,
  account,
  onClose,
}: {
  open: boolean;
  /** Kept by the caller after closing, so the title does not blank while the sheet slides away. */
  account: Pick<TrackedMethod, 'accountId' | 'label'> | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const record = useRecordMoneyAnchor();
  const { reset: newAttempt } = record;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  // Each opening is one attempt: a retry inside it keeps its key, and a later opening never replays an older save.
  useEffect(() => {
    if (open) newAttempt();
  }, [open, newAttempt]);

  // Emptied once the sheet is away, however it was closed: a figure typed for one account must never be saved for another.
  const close = () => {
    setAmount('');
    setNote('');
    newAttempt();
    onClose();
  };

  const parsed = parseAmount(amount);
  // Said once typing on cannot fix it; an empty field just waits.
  const invalid = !parsed.ok && parsed.reason === 'too_precise';
  const name = account?.label ?? '';

  const save = () => {
    if (!account?.accountId || !parsed.ok) return;
    record.mutate(
      { accountId: account.accountId, amount: parsed.value, note },
      {
        onSuccess: () => {
          toast.success(t('moneyTab.anchor.saved'));
          onClose();
        },
        // No answer is not a refusal: the amount may be saved, and Money is read again either way.
        onError: (e) =>
          toast.error(
            t(e instanceof RequestTimeout ? 'moneyTab.anchor.maybeSaved' : e instanceof ApiError && e.status === 403 ? 'moneyTab.anchor.forbidden' : 'moneyTab.anchor.failed'),
          ),
      },
    );
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={t('moneyTab.anchor.title', { account: name })}
      titleLines={2}
      // Pinned, so Save stays above the keyboard while the fields scroll beneath it.
      footer={
        <Button
          title={t('moneyTab.anchor.save')}
          onPress={save}
          loading={record.isPending}
          disabled={record.isPending || !online || !parsed.ok}
          fullWidth
        />
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text variant="body" tone="secondary">
          {t('moneyTab.anchor.body', { account: name })}
        </Text>
        {/* A company account: the one amount every shop sees (docs/63) — said before anything is saved. */}
        <Text variant="bodyStrong" tone="secondary">
          {t('moneyTab.anchor.company')}
        </Text>
        <MoneyField
          label={t('moneyTab.anchor.amount')}
          value={amount}
          onChangeText={setAmount}
          error={invalid ? t('closeDay.count.invalid') : undefined}
          editable={!record.isPending}
          required
          autoFocus
        />
        <TextField label={t('moneyTab.anchor.note')} value={note} onChangeText={setNote} maxLength={255} editable={!record.isPending} />
      </ScrollView>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: space.base },
}));
