import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Store, UserRound } from 'lucide-react-native';
import { Button, FilterChip, SegmentedControl, Text, TextField } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { useCounterparties } from '../../lib/consignment';
import { useCustomers } from '../../lib/customers';
import type { DebtorDraft } from '../../lib/sale-payment-rules';

/**
 * Who owes what was not paid at the counter (0074).
 *
 * Two kinds, one choice: a customer, or a partner store. A customer is picked
 * from the list — so nobody is recorded twice — or typed as someone new, with a
 * name and an optional phone number; a new customer is created inside the sale
 * itself, never beforehand. A store must be a connected one the shop may still
 * start business with; adding one happens in Partners.
 */
export function DebtorPicker({
  value,
  onChange,
  onLeave,
}: {
  value: DebtorDraft;
  onChange: (next: DebtorDraft) => void;
  /** Called before navigating away to add a store, so the sheet can close. */
  onLeave: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const [kind, setKind] = useState<'customer' | 'store'>(value.kind === 'store' ? 'store' : 'customer');
  const [search, setSearch] = useState('');
  const customers = useCustomers(search, kind === 'customer');
  const counterparties = useCounterparties();
  const stores = (counterparties.data?.rows ?? []).filter((c) => c.kind === 'connected_store' && c.canStartDealing !== false);

  const typing = value.kind === 'customer_new';

  return (
    <View style={styles.wrap}>
      <Text variant="label">{t('sellDebt.who')}</Text>
      <SegmentedControl<'customer' | 'store'>
        value={kind}
        onChange={(k) => {
          setKind(k);
          onChange({ kind: 'none' });
        }}
        options={[
          { value: 'customer', label: t('sellDebt.customer') },
          { value: 'store', label: t('sellDebt.store') },
        ]}
      />

      {kind === 'customer' ? (
        value.kind === 'customer_existing' ? (
          <View style={styles.chosen}>
            <Text variant="bodyStrong" style={styles.grow}>
              {t('sellDebt.chosen', { name: value.name })}
            </Text>
            <Button title={t('sellDebt.change')} variant="tertiary" size="sm" onPress={() => onChange({ kind: 'none' })} />
          </View>
        ) : typing ? (
          <View style={styles.wrap}>
            <TextField
              label={t('sellDebt.name')}
              value={value.name}
              onChangeText={(name) => onChange({ ...value, name })}
              required
            />
            <TextField
              label={t('sellDebt.phone')}
              value={value.phone}
              onChangeText={(phone) => onChange({ ...value, phone })}
              keyboardType="phone-pad"
            />
            <Button title={t('sellDebt.searchCustomers')} variant="tertiary" size="sm" onPress={() => onChange({ kind: 'none' })} />
          </View>
        ) : (
          <View style={styles.wrap}>
            <TextField label={t('sellDebt.searchCustomers')} value={search} onChangeText={setSearch} />
            <View style={styles.chips}>
              {(customers.data?.rows ?? []).slice(0, 6).map((c) => (
                <FilterChip
                  key={c.id}
                  label={c.name ?? c.phone ?? '—'}
                  selected={false}
                  onPress={() => onChange({ kind: 'customer_existing', customerId: c.id, name: c.name ?? c.phone ?? '' })}
                />
              ))}
            </View>
            <Button
              title={t('sellDebt.newCustomer')}
              variant="secondary"
              icon={UserRound}
              onPress={() => onChange({ kind: 'customer_new', name: search.trim(), phone: '' })}
            />
          </View>
        )
      ) : (
        <View style={styles.wrap}>
          <Text variant="caption" tone="secondary">
            {t('sellDebt.storePick')}
          </Text>
          {stores.length === 0 ? (
            <Text variant="caption" tone="tertiary">
              {t('sellDebt.noStores')}
            </Text>
          ) : (
            <View style={styles.chips}>
              {stores.map((s) => (
                <FilterChip
                  key={s.id}
                  label={s.name}
                  selected={value.kind === 'store' && value.counterpartyId === s.id}
                  onPress={() => onChange({ kind: 'store', counterpartyId: s.id, name: s.name })}
                />
              ))}
            </View>
          )}
          {value.kind === 'store' ? (
            <Text variant="caption" tone="secondary">
              {t('sellDebt.linkedStore', { name: value.name })}
            </Text>
          ) : null}
          <Button
            title={t('sellDebt.addStore')}
            variant="tertiary"
            size="sm"
            icon={Store}
            onPress={() => {
              onLeave();
              router.push('/partners' as Href);
            }}
          />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
}));
