import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Building2, Store, User, UserPlus } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  SkeletonList,
  Text,
  TextField,
} from './ui';
import { ApiError } from '../lib/api-client';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import {
  useCounterparties,
  useCreateCounterparty,
  type Counterparty,
} from '../lib/consignment';

/**
 * Choosing who the other side is — for a consignment or for a loan.
 *
 * Shared because both milestones need exactly the same thing, and because the
 * rule underneath is one both must obey: somebody who does not use the app is
 * recorded as a **counterparty**, never as a fabricated Company, branch or
 * user. A made-up company would show up in searches, own inventory it cannot
 * have, and quietly become a tenant nobody meant to create.
 */

const ICON: Record<Counterparty['kind'], typeof Store> = {
  connected_store: Building2,
  manual_store: Store,
  manual_person: User,
  employee: User,
};

export function CounterpartyPicker({
  selectedId,
  onSelect,
  onError,
  initialId,
}: {
  selectedId: string | null;
  onSelect: (c: Counterparty) => void;
  onError?: (message: string) => void;
  /** Preselect this counterparty once the list arrives — used when opened from a partner. */
  initialId?: string | null;
}) {
  const { t } = useTranslation();
  const query = useCounterparties();
  const create = useCreateCounterparty();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  /*
   * Stores that cannot take NEW business (connection not accepted, or a shop
   * recorded by hand before the Partners rule) sort after the ones that can,
   * and say why instead of failing only when the proposal is sent. The server
   * refuses them regardless; this is so nobody fills in a form for nothing.
   */
  const rows = [...(query.data?.rows ?? [])]
    .filter((c) => c.canStartDealing !== false || c.kind !== 'manual_store')
    .sort((a, b) => Number(b.canStartDealing !== false) - Number(a.canStartDealing !== false));

  const preselected = React.useRef(false);
  React.useEffect(() => {
    if (preselected.current || !initialId || selectedId) return;
    const found = rows.find((c) => c.id === initialId && c.canStartDealing !== false);
    if (found) {
      preselected.current = true;
      onSelect(found);
    }
  }, [initialId, rows, selectedId, onSelect]);

  const add = () => {
    create.mutate(
      { kind: 'manual_person', name: name.trim(), phone: phone.trim() || undefined },
      {
        onSuccess: (data) => {
          setAdding(false);
          setName('');
          setPhone('');
          // Select what was just added, so nobody has to go and find it.
          const made = data.rows.find((c) => c.name === name.trim());
          if (made) onSelect(made);
        },
        onError: (e) =>
          onError?.(e instanceof ApiError ? e.message : t('counterparty.add.failed')),
      },
    );
  };

  if (query.isLoading) return <SkeletonList count={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <View style={styles.wrap}>
      {rows.length === 0 && !adding ? (
        <EmptyState
          icon={UserPlus}
          title={t('counterparty.empty.title')}
          body={t('counterparty.empty.body')}
        />
      ) : (
        rows.map((c) => {
          const closed = c.canStartDealing === false;
          return (
            <ListRow
              key={c.id}
              leading={ICON[c.kind]}
              title={c.name}
              subtitle={[
                t(`counterparty.kind.${c.kind}`),
                closed ? t('partners.closedForNew') : (c.phone ?? c.city),
              ]
                .filter(Boolean)
                .join(' · ')}
              accessory={
                c.id === selectedId ? (
                  <Chip tone="success" label={t('counterparty.selected')} size="sm" dot />
                ) : undefined
              }
              disabled={closed}
              onPress={closed ? undefined : () => onSelect(c)}
            />
          );
        })
      )}

      {adding ? (
        <Card style={styles.card}>
          <Text variant="caption" tone="secondary">
            {/* Says outright that no account is being made for them. */}
            {t('counterparty.add.hint')}
          </Text>
          <TextField label={t('counterparty.add.name')} value={name} onChangeText={setName} />
          <TextField
            label={t('counterparty.add.phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <View style={styles.actions}>
            <Button
              title={t('counterparty.add.save')}
              disabled={name.trim().length < 2 || create.isPending}
              onPress={add}
            />
            <Button title={t('action.cancel')} variant="ghost" onPress={() => setAdding(false)} />
          </View>
        </Card>
      ) : (
        <Button
          title={t('counterparty.add')}
          icon={UserPlus}
          variant="ghost"
          onPress={() => setAdding(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  card: { gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm },
});
