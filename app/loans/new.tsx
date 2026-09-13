import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import {
  Button,
  Card,
  InlineNotice,
  MoneyField,
  Screen,
  Section,
  SegmentedControl,
  Text,
  TextField,
} from '../../components/ui';
import { CounterpartyPicker } from '../../components/CounterpartyPicker';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { useCreateLoan, type LoanDirection } from '../../lib/loans';
import type { Counterparty } from '../../lib/consignment';
import { uuidv4 } from '../../lib/utils';
import { useDraft } from '../../lib/offline/use-draft';
import { DraftNotice } from '../../components/DraftNotice';

/**
 * Writing down a debt (Milestone I).
 *
 * Direction is asked as a question in words — "they owe us" or "we owe them" —
 * and stored as itself. It is never a sign on the amount: a negative number
 * stops meaning anything the moment somebody reverses a payment, and a shop
 * would have to work out which way round a minus pointed.
 *
 * Proposing is not agreeing. Nothing here creates a debt; it puts a number in
 * front of the other side, and they answer it.
 */
export default function NewLoanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  /** Opened from a partner's screen: that store is already chosen. */
  const { counterpartyId: initialCounterpartyId } = useLocalSearchParams<{ counterpartyId?: string }>();
  const create = useCreateLoan();

  const [party, setParty] = useState<Counterparty | null>(null);
  const [direction, setDirection] = useState<LoanDirection>('they_owe_us');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * The proposal survives an app kill (J.1).
   *
   * Direction, amount and note. The counterparty is kept as an id and
   * re-resolved from the list, so a party that has since been blocked or
   * deactivated cannot be silently proposed to.
   */
  const draft = useDraft('loan.proposal', { direction, amount, note, partyId: party?.id ?? null }, (v) => {
    setDirection(v.direction ?? 'they_owe_us');
    setAmount(v.amount ?? '');
    setNote(v.note ?? '');
  });

  /*
    One key for this attempt. If the phone loses signal mid-request and the
    shopkeeper presses again, the server recognises the retry instead of
    recording the debt twice.
  */
  const clientUuid = useMemo(() => uuidv4(), []);

  const value = Number(amount);
  const ready = Boolean(party) && Number.isFinite(value) && value > 0;

  const submit = () => {
    if (!party) return;
    setError(null);
    create.mutate(
      {
        counterpartyId: party.id,
        direction,
        amount: value,
        note: note.trim() || undefined,
        clientUuid,
      },
      {
        onSuccess: (loan) => {
          draft.clear();
          router.replace(`/loans/${loan.id}` as never);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('loans.new.failed')),
      },
    );
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('loans.new') }} />
      <ScrollView contentContainerStyle={styles.list}>
        <DraftNotice draft={draft} onDiscard={() => { setAmount(''); setNote(''); }} />
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

        <Section title={t('loans.new.who')}>
          <CounterpartyPicker
            initialId={initialCounterpartyId ?? null}
            selectedId={party?.id ?? null}
            onSelect={setParty}
            onError={setError}
          />
        </Section>

        <Section title={t('loans.new.which')}>
          <Card style={styles.card}>
            {/* In words, both ways round, with no default that flatters us. */}
            <SegmentedControl
              options={[
                { value: 'they_owe_us', label: t('loans.direction.they_owe_us') },
                { value: 'we_owe_them', label: t('loans.direction.we_owe_them') },
              ]}
              value={direction}
              onChange={(v) => setDirection(v as LoanDirection)}
            />
            <MoneyField label={t('loans.new.amount')} value={amount} onChangeText={setAmount} />
            <TextField label={t('loans.new.note')} value={note} onChangeText={setNote} />
            <Text variant="caption" tone="secondary">
              {/* Proposing is not agreeing, and the screen says so. */}
              {t('loans.new.hint')}
            </Text>
          </Card>
        </Section>

        <View style={styles.actions}>
          <Button
            title={t('loans.new.send')}
            fullWidth
            disabled={!ready || create.isPending}
            onPress={submit}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  actions: { paddingTop: space.sm },
});
