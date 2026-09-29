import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { ListRow, MoneyValue, RowGroup, Text } from '../ui';
import { SetStartingAmountSheet } from './SetStartingAmountSheet';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import type { TrackedMethod } from '../../lib/money-overview';

/**
 * Setting what a company account holds (docs/63) — the Owner's separate,
 * company-wide action. A shop's opening only ever carries the accounts forward:
 * an account belongs to the company, so changing its amount changes it for
 * every shop, and it is done here, saying so, never as a side effect of opening
 * one shop.
 *
 * The accounts as the app tracks them; choosing one asks for the amount its own
 * app shows now (`SetStartingAmountSheet`, 0082). After saving, the list comes
 * back, so another can be set.
 *
 * One sheet at a time, each shown only once the one before it is gone: iOS does
 * not present a modal while another is still being dismissed (`BottomSheet`'s
 * `onDismissed`, the user's phone report of 2026-09-29).
 */
type Step = 'list' | 'toAmount' | 'amount' | 'toList';

export function CompanyAccountsSheet({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: readonly TrackedMethod[] }) {
  const styles = useStyles();
  const { t } = useTranslation();
  // The account being set is kept after closing, so the amount sheet's title stays while it slides away.
  const [chosen, setChosen] = useState<TrackedMethod | null>(null);
  const [step, setStep] = useState<Step>('list');
  /** Moves on only from the step that is ending — a late report from an earlier sheet changes nothing. */
  const from = (at: Step, to: Step) => () => setStep((s) => (s === at ? to : s));

  return (
    <>
      <BottomSheet
        open={open && step === 'list'}
        // Closed by the person: the whole action ends. Stepping aside for an account's amount is not a close.
        onClose={() => {
          if (step === 'list') onClose();
        }}
        onDismissed={from('toAmount', 'amount')}
        title={t('moneyTab.company.title')}
        titleLines={2}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <Text variant="body" tone="secondary">
            {t('moneyTab.company.body')}
          </Text>
          <RowGroup>
            {accounts.map((m) => (
              <ListRow
                key={m.key}
                flat
                title={m.label}
                // The account's whole name — the one being chosen — however long, in any language.
                titleLines={0}
                value={
                  m.position !== null ? (
                    <MoneyValue value={m.position} size="small" signed={m.position < 0} />
                  ) : (
                    <Text variant="bodyStrong" tone="secondary">
                      {t('moneyTab.held.unknown')}
                    </Text>
                  )
                }
                subtitle={t('moneyTab.held.setAmount')}
                onPress={() => {
                  setChosen(m);
                  setStep('toAmount');
                }}
              />
            ))}
          </RowGroup>
        </ScrollView>
      </BottomSheet>
      <SetStartingAmountSheet open={step === 'amount'} account={chosen} onClose={from('amount', 'toList')} onDismissed={from('toList', 'list')} />
    </>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: space.base, paddingBottom: space.base },
}));
