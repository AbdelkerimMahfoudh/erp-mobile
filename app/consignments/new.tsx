import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScanLine, X } from 'lucide-react-native';
import {
  Button,
  Card,
  Identifier,
  IconButton,
  InlineNotice,
  MoneyField,
  Screen,
  Section,
  Text,
  TextField,
} from '../../components/ui';
import { ScannerSheet } from '../../components/scanner';
import { CounterpartyPicker } from '../../components/CounterpartyPicker';
import { api, ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { uuidv4 } from '../../lib/utils';
import { useDraft } from '../../lib/offline/use-draft';
import { DraftNotice } from '../../components/DraftNotice';
import { useCreateConsignment, type Counterparty } from '../../lib/consignment';
import type { Unit } from '../../types/api';

interface Picked {
  id: string;
  identifier: string;
  label: string;
}

/**
 * Sending stock to another shop (Milestone H).
 *
 * Camera first: phones are added by scanning, because typing an IMEI is fifteen
 * digits of opportunity to send the wrong handset. Typing stays available for
 * the case where a label will not read.
 *
 * The amount asked here is a **proposal**. Nothing leaves the shelf on the
 * strength of it — the other side has to agree, and the server reserves each
 * unit at that point rather than this one.
 */
export default function NewConsignmentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  /** Opened from a partner's screen: that store is already chosen. */
  const { counterpartyId: initialCounterpartyId } = useLocalSearchParams<{ counterpartyId?: string }>();
  const create = useCreateConsignment();

  const [party, setParty] = useState<Counterparty | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [typed, setTyped] = useState('');
  const [scanning, setScanning] = useState(false);
  const [amount, setAmount] = useState('');
  const [defectNote, setDefectNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The proposal survives an app kill (J.1).
   *
   * Only what was typed and chosen. Each picked phone was verified as
   * in-stock when it was scanned, and that verification is NOT restored —
   * `revalidate` below re-asks the server before anything is proposed,
   * because a phone can be sold by another branch while this app is closed.
   */
  const draft = useDraft('consignment.proposal', { picked, amount, defectNote, partyId: party?.id ?? null }, (v) => {
    setPicked(v.picked ?? []);
    setAmount(v.amount ?? '');
    setDefectNote(v.defectNote ?? '');
  });

  const clientUuid = useMemo(() => uuidv4(), []);

  /**
   * Turn a scanned code into a unit this shop actually holds.
   *
   * Resolved against the server rather than trusted from the label: a code that
   * is not in stock, is already sold, or belongs to another branch must be
   * refused here, where somebody is still holding the phone.
   */
  const add = async (code: string) => {
    const identifier = code.trim();
    if (!identifier) return;
    if (picked.some((p) => p.identifier === identifier)) {
      setError(t('consignment.new.duplicate'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const unit = await api.get<Unit>(`/units/${encodeURIComponent(identifier)}`);
      if (unit.status !== 'in_stock') {
        setError(t('consignment.new.notInStock', { identifier }));
        return;
      }
      const label = [unit.product?.brand, unit.product?.model, unit.product?.variant]
        .filter(Boolean)
        .join(' ');
      setPicked((p) => [...p, { id: unit.id, identifier, label }]);
      setTyped('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('consignment.new.notFound', { identifier }));
    } finally {
      setBusy(false);
    }
  };

  const value = Number(amount);
  const ready = Boolean(party) && picked.length > 0 && Number.isFinite(value) && value > 0;

  /**
   * Re-ask the server about every phone before proposing (J.1).
   *
   * Each one was checked as in-stock when it was scanned, but a restored draft
   * may be hours old and another branch may have sold the phone in between.
   * Proposing on the strength of a stale check would reserve stock that is
   * already gone, and the other shop would be told about a phone nobody has.
   *
   * A phone that has moved is REMOVED from the list and named, rather than the
   * draft being thrown away: the rest of the work is still good.
   */
  const revalidate = async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const stale: string[] = [];
      for (const p of picked) {
        try {
          const unit = await api.get<Unit>(`/units/${encodeURIComponent(p.identifier)}`);
          if (unit.status !== 'in_stock') stale.push(p.identifier);
        } catch {
          stale.push(p.identifier);
        }
      }
      if (stale.length > 0) {
        setPicked((all) => all.filter((p) => !stale.includes(p.identifier)));
        setError(t('consignment.new.stale', { identifiers: stale.join(', ') }));
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!party) return;
    if (!(await revalidate())) return;
    setError(null);
    create.mutate(
      {
        counterpartyId: party.id,
        unitIds: picked.map((p) => p.id),
        proposedAmount: value,
        defectNote: defectNote.trim() || undefined,
        clientUuid,
      },
      {
        onSuccess: (c) => {
          // The server accepted it, so the draft has done its job.
          draft.clear();
          router.replace(`/consignments/${c.id}` as never);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('consignment.failed')),
      },
    );
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('consignment.new') }} />
      <ScrollView contentContainerStyle={styles.list}>
        <DraftNotice draft={draft} onDiscard={() => { setPicked([]); setAmount(''); setDefectNote(''); }} />
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

        <Section title={t('consignment.new.who')}>
          <CounterpartyPicker
            initialId={initialCounterpartyId ?? null}
            selectedId={party?.id ?? null}
            onSelect={setParty}
            onError={setError}
          />
        </Section>

        <Section title={t('consignment.new.what', { count: String(picked.length) })}>
          <Card style={styles.card}>
            <Button
              title={t('consignment.new.scan')}
              icon={ScanLine}
              fullWidth
              onPress={() => setScanning(true)}
            />
            {/* Typing is the fallback, not the path. */}
            <TextField
              label={t('consignment.new.typed')}
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={() => void add(typed)}
              autoCapitalize="characters"
            />
            <Button
              title={t('consignment.new.add')}
              variant="ghost"
              disabled={!typed.trim() || busy}
              onPress={() => void add(typed)}
            />

            {picked.map((p) => (
              <View key={p.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Text variant="body">{p.label}</Text>
                  <Identifier>{p.identifier}</Identifier>
                </View>
                <IconButton
                  icon={X}
                  accessibilityLabel={t('consignment.new.remove')}
                  onPress={() => setPicked((all) => all.filter((x) => x.id !== p.id))}
                />
              </View>
            ))}
          </Card>
        </Section>

        <Section title={t('consignment.new.terms')}>
          <Card style={styles.card}>
            <MoneyField label={t('consignment.new.amount')} value={amount} onChangeText={setAmount} />
            {/*
              Faults said up front. Recorded so "I was not told" is answerable
              from the record rather than from two people's memories.
            */}
            <TextField
              label={t('consignment.new.defects')}
              value={defectNote}
              onChangeText={setDefectNote}
            />
            <Text variant="caption" tone="secondary">
              {t('consignment.new.hint')}
            </Text>
          </Card>
        </Section>

        <View style={styles.actions}>
          <Button
            title={t('consignment.new.send')}
            fullWidth
            disabled={!ready || create.isPending}
            onPress={() => void submit()}
          />
        </View>
      </ScrollView>

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        hint={t('consignment.new.scanHint')}
        onResult={(result) => {
          setScanning(false);
          void add(result.code ?? '');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.base, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: space.xs,
  },
  rowText: { flex: 1, gap: 2 },
  actions: { paddingTop: space.sm },
});
