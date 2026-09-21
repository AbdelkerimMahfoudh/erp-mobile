import React from 'react';
import { View } from 'react-native';
import { Banknote, Landmark } from 'lucide-react-native';
import { FilterChip, SegmentedControl, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';

/** Where money arrived, or where it was paid from: the drawer, or one account. */
export type MoneySource = { kind: 'cash' } | { kind: 'account'; accountId: string | null };

export interface SourceAccount {
  id: string;
  label: string;
  provider?: string;
  providerName?: string | null;
}

/**
 * Cash, or one named account — the one question every payment and every
 * expense asks. Two buttons; the account chips appear only when an account is
 * the answer. With exactly one account it is picked on the way in, because one
 * option is not a choice worth making. With none, the control says why the
 * account side cannot be completed rather than offering an empty list.
 *
 * Cash carries no account — the drawer is not a wallet, and the server refuses
 * an account on a cash payment — so choosing cash drops any account chosen.
 */
export function ReceivedVia({
  label,
  value,
  onChange,
  accounts,
}: {
  label: string;
  value: MoneySource;
  onChange: (next: MoneySource) => void;
  accounts: SourceAccount[];
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const chosen = value.kind === 'account' ? (accounts.find((a) => a.id === value.accountId) ?? null) : null;

  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <SegmentedControl<'cash' | 'account'>
        variant="buttons"
        value={value.kind}
        onChange={(kind) =>
          onChange(kind === 'cash' ? { kind: 'cash' } : { kind: 'account', accountId: accounts.length === 1 ? accounts[0].id : null })
        }
        options={[
          { value: 'cash', label: t('payment.cash'), icon: Banknote },
          { value: 'account', label: t('receivedVia.account'), icon: Landmark },
        ]}
      />
      {value.kind === 'account' ? (
        accounts.length === 0 ? (
          <Text variant="caption" tone="warning">
            {t('sell.payment.account.none')}
          </Text>
        ) : (
          <>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {accounts.map((a) => (
                <FilterChip
                  key={a.id}
                  label={a.label}
                  selected={value.accountId === a.id}
                  onPress={() => onChange({ kind: 'account', accountId: a.id })}
                />
              ))}
            </View>
            {/* Provider AND label once chosen, so nobody confirms against a name alone. */}
            <Text variant="caption" tone={chosen ? 'secondary' : 'warning'}>
              {chosen ? describe(chosen, t) : t('sell.payment.account.required')}
            </Text>
          </>
        )
      ) : null}
    </View>
  );
}

function describe(account: SourceAccount, t: ReturnType<typeof useTranslation>['t']): string {
  if (!account.provider) return account.label;
  const provider =
    account.provider === 'other'
      ? (account.providerName ?? t('payment.provider.other'))
      : t(`payment.provider.${account.provider}` as never);
  return t('sell.payment.account.chosen', { provider, label: account.label });
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
