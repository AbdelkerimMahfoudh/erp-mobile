import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Text } from '../ui/Text';
import type { RefundMethod, ReturnPayout, Settings } from '../../types/api';

/**
 * How the refund was paid — used both to report it and to correct it.
 *
 * One sheet for both because they ask the same question. The **amount is never
 * editable**: it is the immutable net refund due, and a payout that does not
 * match it is not a correction, it is a different obligation. It is displayed
 * so the person handing money over can check it against what is in their hand.
 *
 * There is no "Other" method. The server accepts exactly `cash` and `account`,
 * and offering a third would be inventing a contract the backend would refuse.
 *
 * Nothing here talks to a payment provider, looks up a balance or asks for a
 * credential. It records what a human says happened at the counter.
 */
export function RefundPayoutSheet({
  open,
  onClose,
  mode,
  netAmountDue,
  payout,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** `report` creates the claim; `correct` fixes one before confirmation. */
  mode: 'report' | 'correct';
  netAmountDue: number;
  /** The existing payout when correcting, so the form opens on what was said. */
  payout?: ReturnPayout | null;
  submitting: boolean;
  onSubmit: (input: {
    method: RefundMethod;
    receivingAccountId?: string;
    transactionReference?: string;
    note?: string;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  /**
   * Active accounts, from the same settings response the till uses.
   *
   * `GET /settings` narrows itself: a non-manager receives only ACTIVE accounts,
   * which is exactly the rule for reporting. Managers receive all of them with
   * an `isActive` flag, so the filter below is what makes the two agree.
   */
  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<Settings>('/settings'),
    enabled: open,
  });

  const accounts = useMemo(() => {
    const rows = settings.data?.receivingAccounts ?? [];
    return rows.filter((a) => ('isActive' in a ? a.isActive : true));
  }, [settings.data]);

  // Open on what the payout actually says, so a correction starts from the
  // truth rather than from a blank form the user has to retype.
  useEffect(() => {
    if (!open) return;
    setMethod(payout?.method ?? 'cash');
    setReference(payout?.transactionReference ?? '');
    setNote(payout?.note ?? '');
    setAccountId(null);
  }, [open, payout]);

  /**
   * An account is required to CHOOSE `account`, but an already-recorded payout
   * stays confirmable if its account was deactivated afterwards — so this only
   * blocks picking a new one.
   */
  const needsAccount = method === 'account' && !accountId && !(mode === 'correct' && payout?.method === 'account');
  const canSubmit = !submitting && !needsAccount;

  const submit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      method,
      ...(accountId ? { receivingAccountId: accountId } : {}),
      ...(reference.trim() ? { transactionReference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t(mode === 'report' ? 'refund.report.title' : 'refund.correct.title')}
    >
      <View style={styles.body}>
        {/* Displayed, locked. There is no partial payout. */}
        <View style={styles.amount}>
          <Text variant="caption" tone="secondary">
            {t('refund.amountLabel')}
          </Text>
          <Text variant="title">{formatMoney(netAmountDue)}</Text>
          <Text variant="caption" tone="tertiary">
            {t('refund.amountLocked')}
          </Text>
        </View>

        <Text variant="label">{t('refund.method')}</Text>
        <SegmentedControl
          options={[
            { value: 'cash', label: t('refund.method.cash') },
            { value: 'account', label: t('refund.method.account') },
          ]}
          value={method}
          onChange={(v) => setMethod(v as RefundMethod)}
        />

        {method === 'account' ? (
          accounts.length === 0 ? (
            <Text variant="caption" tone="warning">
              {t('refund.noAccounts')}
            </Text>
          ) : (
            <View style={styles.accounts}>
              <Text variant="label">{t('refund.account')}</Text>
              <SegmentedControl
                options={accounts.map((a) => ({ value: a.id, label: a.label }))}
                value={accountId ?? ''}
                onChange={setAccountId}
              />
              {mode === 'correct' && payout?.accountLabel && !accountId ? (
                // The stored snapshot, not a live lookup: a renamed account must
                // not retitle a movement that already happened.
                <Text variant="caption" tone="tertiary">
                  {t('refund.keepingAccount', { account: payout.accountLabel })}
                </Text>
              ) : null}
            </View>
          )
        ) : null}

        <TextField
          label={t('refund.reference')}
          value={reference}
          onChangeText={setReference}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={t('refund.reference.placeholder')}
        />
        <TextField
          label={t('refund.note')}
          value={note}
          onChangeText={setNote}
          placeholder={t('refund.note.placeholder')}
        />

        {/* Said before the button, not after: reporting is not paying-and-done. */}
        <Text variant="caption" tone="secondary">
          {t(mode === 'report' ? 'refund.report.stillNeedsApproval' : 'refund.correct.hint')}
        </Text>

        <Button
          title={t(mode === 'report' ? 'refund.report.submit' : 'refund.correct.submit')}
          onPress={() => void submit()}
          loading={submitting}
          disabled={!canSubmit}
          fullWidth
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.base },
  amount: { gap: space.xs },
  accounts: { gap: space.sm },
});
