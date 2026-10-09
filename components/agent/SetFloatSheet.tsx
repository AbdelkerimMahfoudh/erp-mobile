import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, ListRow, MoneyField, MoneyValue, RowGroup, Text, TextField } from '../ui';
import { ApiError } from '../../lib/api-client';
import { useSetFloat } from '../../lib/agent';
import type { FloatTarget } from '../../lib/agent-money';
import { useConnectivity } from '../../lib/connectivity';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toAgentError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { RequestTimeout } from '../../lib/offline/classify';
import { parseAmount } from '../../lib/price-input';
import { toast } from '../../lib/toast';

/**
 * Setting what a float holds — the Owner's alone (`agent.position.set`,
 * docs/73 §4.4). The floats of THIS branch: a float is the branch's own stock
 * of a provider's credit, never the company's receiving account of the same
 * provider, which the company accounts sheet sets (A9). The sheet says so
 * before anything is saved.
 *
 * The list of the branch's floats and held commissions as the app tracks them;
 * choosing one asks for the amount the provider's app shows now. From the
 * server's instant on, the app tracks that amount plus every exchange recorded
 * after it. After saving, the list comes back, so another can be set.
 *
 * One sheet at a time, the next shown only once the one before it is gone (iOS
 * presents no modal while another is being dismissed — `BottomSheet`'s
 * `onDismissed`), exactly as the company accounts sheet steps.
 */
type Step = 'list' | 'toAmount' | 'amount' | 'toList';

export function SetFloatSheet({ open, onClose, targets }: { open: boolean; onClose: () => void; targets: readonly FloatTarget[] }) {
  const styles = useStyles();
  const { t } = useTranslation();
  // The float being set is kept after closing, so the amount sheet's title stays while it slides away.
  const [chosen, setChosen] = useState<FloatTarget | null>(null);
  const [step, setStep] = useState<Step>('list');
  const from = (at: Step, to: Step) => () => setStep((s) => (s === at ? to : s));
  const name = (f: FloatTarget) => (f.accountKind === 'provider' ? t('agent.positions.float', { provider: f.label }) : t('agent.positions.held', { provider: f.label }));

  return (
    <>
      <BottomSheet
        open={open && step === 'list'}
        onClose={() => {
          if (step === 'list') onClose();
        }}
        onDismissed={from('toAmount', 'amount')}
        title={t('agent.setFloat.title')}
        titleLines={2}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <Text variant="body" tone="secondary">
            {t('agent.setFloat.body')}
          </Text>
          <RowGroup>
            {targets.map((f) => (
              <ListRow
                key={f.key}
                flat
                title={name(f)}
                titleLines={0}
                value={
                  f.position !== null ? (
                    <MoneyValue value={f.position} size="small" signed={f.position < 0} />
                  ) : (
                    <Text variant="bodyStrong" tone="secondary">
                      {t('moneyTab.held.unknown')}
                    </Text>
                  )
                }
                subtitle={t('moneyTab.held.setAmount')}
                onPress={() => {
                  setChosen(f);
                  setStep('toAmount');
                }}
              />
            ))}
          </RowGroup>
        </ScrollView>
      </BottomSheet>
      <FloatAmountSheet open={step === 'amount'} target={chosen} title={chosen ? name(chosen) : ''} onClose={from('amount', 'toList')} onDismissed={from('toList', 'list')} />
    </>
  );
}

/**
 * The amount one float holds now. Zero is an amount (an empty float); nothing
 * below it, nothing past two decimals. Each opening is one attempt: a retry
 * inside it keeps its key, and a later opening never replays an older save.
 */
function FloatAmountSheet({
  open,
  target,
  title,
  onClose,
  onDismissed,
}: {
  open: boolean;
  target: FloatTarget | null;
  title: string;
  onClose: () => void;
  onDismissed: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const record = useSetFloat();
  const { reset: newAttempt } = record;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) newAttempt();
  }, [open, newAttempt]);

  // Emptied however the sheet was closed: a figure typed for one float must never be saved for another.
  const close = () => {
    setAmount('');
    setNote('');
    newAttempt();
    onClose();
  };

  const parsed = parseAmount(amount);
  const invalid = !parsed.ok && parsed.reason === 'too_precise';

  const save = () => {
    if (!target || !parsed.ok) return;
    record.mutate(
      { providerId: target.providerId, accountKind: target.accountKind, amount: parsed.value, note },
      {
        onSuccess: () => {
          toast.success(t('agent.setFloat.saved'));
          setAmount('');
          setNote('');
          onClose();
        },
        // No answer is not a refusal: the amount may be saved, and the floats are read again either way.
        onError: (e) =>
          toast.error(
            e instanceof RequestTimeout
              ? t('agent.setFloat.maybeSaved')
              : e instanceof ApiError && e.status === 403 && e.code !== 'activity_not_subscribed' && e.code !== 'ENTITLEMENT_WRITE_BLOCKED'
                ? t('agent.setFloat.forbidden')
                : toAgentError(e).body,
          ),
      },
    );
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      onDismissed={onDismissed}
      title={t('agent.setFloat.amountTitle', { account: title })}
      titleLines={2}
      footer={<Button title={t('moneyTab.anchor.save')} onPress={save} loading={record.isPending} disabled={record.isPending || !online || !parsed.ok} fullWidth />}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text variant="body" tone="secondary">
          {t('agent.setFloat.amountBody', { provider: target?.label ?? '' })}
        </Text>
        {/* This branch's float, not the company's account of the same provider (A9) — said before anything is saved. */}
        <Text variant="bodyStrong" tone="secondary">
          {t('agent.setFloat.branchOnly', { provider: target?.label ?? '' })}
        </Text>
        {!online ? (
          <Text variant="caption" tone="warning">
            {t('agent.setFloat.offline')}
          </Text>
        ) : null}
        <MoneyField
          label={t('agent.setFloat.amount')}
          accessibilityLabel={t('agent.setFloat.amount')}
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
  body: { gap: space.base, paddingBottom: space.base },
}));
