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
 */
export function CompanyAccountsSheet({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: readonly TrackedMethod[] }) {
  const styles = useStyles();
  const { t } = useTranslation();
  // The account being set is kept after closing, so the amount sheet's title stays while it slides away.
  const [chosen, setChosen] = useState<TrackedMethod | null>(null);
  const [setting, setSetting] = useState(false);

  return (
    <>
      {/* Its close is reported after the exit animation: while an account's amount is being set, the list only steps aside. */}
      <BottomSheet open={open && !setting} onClose={() => {
          if (!setting) onClose();
        }} title={t('moneyTab.company.title')} titleLines={2}>
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
                  setSetting(true);
                }}
              />
            ))}
          </RowGroup>
        </ScrollView>
      </BottomSheet>
      <SetStartingAmountSheet open={setting} account={chosen} onClose={() => setSetting(false)} />
    </>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: space.base, paddingBottom: space.base },
}));
