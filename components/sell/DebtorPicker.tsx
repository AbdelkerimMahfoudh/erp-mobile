import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ChevronRight, Plus, Store, UserRound } from 'lucide-react-native';
import { Button, SegmentedControl, Text, TextField } from '../ui';
import { SelectSheet } from '../overlay';
import { radius, space, touch } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { isRTL, useTranslation } from '../../lib/i18n';
import { useCounterparties } from '../../lib/consignment';
import { useCustomers, type Customer } from '../../lib/customers';
import type { DebtorDraft } from '../../lib/sale-payment-rules';

/**
 * Who owes what was not paid at the counter (0074).
 *
 * Two kinds, one choice: a customer, or a partner store. A customer is typed
 * as someone new — a name, and a phone number if they give one — or picked
 * from the list so nobody is recorded twice; a new customer is created inside
 * the sale itself, never beforehand. A store must be a connected one the shop
 * may still start business with; adding one happens in Partners.
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
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const [kind, setKind] = useState<'customer' | 'store'>(value.kind === 'store' ? 'store' : 'customer');
  const [picking, setPicking] = useState(false);
  const [storesOpen, setStoresOpen] = useState(false);
  const [search, setSearch] = useState('');
  const customers = useCustomers(search, kind === 'customer' && picking);
  const counterparties = useCounterparties();
  const stores = (counterparties.data?.rows ?? []).filter((c) => c.kind === 'connected_store' && c.canStartDealing !== false);

  const typed = value.kind === 'customer_new' ? value : { name: '', phone: '' };

  return (
    <View style={styles.wrap}>
      <Text variant="label">{t('sellDebt.who')}</Text>
      <SegmentedControl<'customer' | 'store'>
        variant="buttons"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setPicking(false);
          onChange({ kind: 'none' });
        }}
        options={[
          { value: 'customer', label: t('sellDebt.customer'), icon: UserRound },
          { value: 'store', label: t('sellDebt.store'), icon: Store },
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
        ) : picking ? (
          <View style={styles.wrap}>
            <TextField label={t('sellDebt.searchCustomers')} value={search} onChangeText={setSearch} autoFocus />
            {(customers.data?.rows ?? []).slice(0, 6).map((c: Customer) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => {
                  setPicking(false);
                  onChange({ kind: 'customer_existing', customerId: c.id, name: c.name ?? c.phone ?? '' });
                }}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              >
                <UserRound size={18} color={colors.text.tertiary} />
                <View style={styles.grow}>
                  <Text variant="body">{c.name ?? c.phone ?? '—'}</Text>
                  {c.name && c.phone ? (
                    <Text variant="caption" tone="secondary">
                      {c.phone}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
            <Button title={t('sellDebt.typeNew')} variant="tertiary" size="sm" onPress={() => setPicking(false)} />
          </View>
        ) : (
          <View style={styles.wrap}>
            <Button title={t('sellDebt.selectExisting')} variant="tertiary" size="sm" onPress={() => setPicking(true)} />
            <TextField
              label={t('sellDebt.name')}
              value={typed.name}
              onChangeText={(name) => onChange({ kind: 'customer_new', name, phone: typed.phone })}
              required
            />
            <TextField
              label={t('sellDebt.phone')}
              value={typed.phone}
              onChangeText={(phone) => onChange({ kind: 'customer_new', name: typed.name, phone })}
              keyboardType="phone-pad"
            />
          </View>
        )
      ) : (
        <View style={styles.wrap}>
          <Text variant="label">{t('sellDebt.storePick')}</Text>
          {stores.length === 0 ? (
            <Text variant="caption" tone="tertiary">
              {t('sellDebt.noStores')}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('sellDebt.storePick')}
              onPress={() => setStoresOpen(true)}
              style={({ pressed }) => [styles.select, pressed && styles.pressed]}
            >
              <Text variant="body" tone={value.kind === 'store' ? 'primary' : 'placeholder'} style={styles.grow}>
                {value.kind === 'store' ? value.name : t('sellDebt.chooseStore')}
              </Text>
              <View style={isRTL() ? styles.flip : undefined}>
                <ChevronRight size={18} color={colors.text.tertiary} />
              </View>
            </Pressable>
          )}
          <Button
            title={t('sellDebt.addStore')}
            variant="tertiary"
            size="sm"
            icon={Plus}
            onPress={() => {
              onLeave();
              router.push('/partners' as Href);
            }}
          />
          {value.kind === 'store' ? (
            <Text variant="caption" tone="secondary">
              {t('sellDebt.linkedStore', { name: value.name })}
            </Text>
          ) : null}
          <SelectSheet
            open={storesOpen}
            onClose={() => setStoresOpen(false)}
            title={t('sellDebt.storePick')}
            items={stores}
            keyExtractor={(s) => s.id}
            labelExtractor={(s) => s.name}
            leadingIcon={Store}
            selectedKeys={value.kind === 'store' ? [value.counterpartyId] : []}
            onSelect={(s) => {
              onChange({ kind: 'store', counterpartyId: s.id, name: s.name });
              setStoresOpen(false);
            }}
          />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: space.sm },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  pressed: { opacity: 0.6 },
  flip: { transform: [{ scaleX: -1 }] },
}));
