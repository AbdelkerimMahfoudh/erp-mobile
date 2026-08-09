import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { ScanLine, Trash2 } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  EmptyState,
  Identifier,
  Screen,
  Section,
  SegmentedControl,
  Text,
  TextField,
} from '../../components/ui';
import { ScannerSheet } from '../../components/scanner';
import { api } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import {
  addToDraft,
  canSubmitDraft,
  hasUnsavedDraft,
  removeFromDraft,
  submitIntent,
  type DraftItem,
} from '../../lib/transfer-draft';
import { transferProblems, useCreateTransfer } from '../../lib/transfers';
import type { UserBranch } from '../../types/api';

/**
 * Request a transfer — scan first, type as a fallback.
 *
 * Serialized units only in H1.3. A scanned accessory is REFUSED with an
 * explanation rather than silently ignored: the user is standing in front of
 * the stock, and a scan that appears to do nothing is the worst possible answer.
 *
 * The request id is minted once when the draft begins and reused for every
 * retry. That is the whole reason a timeout here is safe: the server recognises
 * the replay and returns the original transfer instead of moving stock twice.
 */
export default function NewTransferScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { branchId, branchName } = useBranch();
  const branches = useQuery({
    queryKey: qk.branches,
    queryFn: () => api.get<UserBranch[]>('/auth/branches'),
  });
  const create = useCreateTransfer();
  const canApproveHere = usePermission('transfer.approve');

  const [items, setItems] = useState<DraftItem[]>([]);
  const [toBranchId, setToBranchId] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [scanning, setScanning] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  /**
   * One id per ATTEMPT, held in a ref so a re-render cannot mint a new one.
   * A fresh id per submit would defeat idempotency completely.
   */
  const requestId = useRef<string>(uuidv4());

  /** Every other branch in the company — a transfer to yourself is a 400. */
  const destinations = useMemo(
    () => (branches.data ?? []).filter((b) => b.id !== branchId),
    [branches.data, branchId],
  );

  const intent = submitIntent(canApproveHere);
  const canSubmit = canSubmitDraft({ items, toBranchId, fromBranchId: branchId });
  const dirty = hasUnsavedDraft(items, submitted);

  /**
   * Back must not silently discard several minutes of walking around a shop
   * with a phone. Confirm, then leave.
   */
  useFocusEffect(
    useCallback(() => {
      if (!dirty) return;
      // expo-router pops on hardware/gesture back; the guard lives on the
      // explicit control so the prompt is reliable on both platforms.
      return () => undefined;
    }, [dirty]),
  );

  const leave = async () => {
    if (!dirty) {
      router.back();
      return;
    }
    const ok = await dialog.confirm({
      title: t('transfers.new.discard.title'),
      message: t('transfers.new.discard.body', {
        count:
          items.length === 1 ? t('transfers.items.one') : t('transfers.items', { count: items.length }),
      }),
      confirmLabel: t('transfers.new.discard.confirm'),
      cancelLabel: t('transfers.new.keep'),
      tone: 'danger',
    });
    if (ok) router.back();
  };

  const add = (identifier: string, opts: { product?: string | null; trackingType?: string | null } = {}) => {
    const result = addToDraft(items, identifier, opts);
    if (result.ok) {
      void haptics.success();
      setItems(result.items);
      setTyped('');
      return;
    }
    void haptics.error();
    if (result.reason === 'duplicate') toast.error(t('transfers.new.duplicate'));
    else if (result.reason === 'blank') toast.error(t('transfers.new.blank'));
    else if (result.reason === 'quantity_product') {
      // Say what is coming, rather than dropping the scan on the floor.
      void dialog.alert({
        title: t('transfers.new.quantityNotYet'),
        message: t('transfers.new.quantityNotYetBody'),
      });
    }
  };

  const submit = async () => {
    if (!canSubmit || create.isPending) return;
    try {
      const result = await create.mutateAsync({
        clientUuid: requestId.current,
        toBranchId: toBranchId!,
        identifiers: items.map((i) => i.identifier),
      });
      setSubmitted(true);
      toast.success(t('transfers.new.created', { ref: result.transferNo ?? '' }));
      // Replace, not push: Back from the detail must not return to a draft that
      // has already been sent.
      router.replace(`/transfers/${result.id}` as never);
    } catch (error) {
      /**
       * Per-identifier refusals are shown as themselves. "Some units cannot be
       * transferred" is not actionable; "356938035643809 is sold" is.
       */
      const problems = transferProblems(error);
      if (problems.length > 0) {
        await dialog.alert({
          title: t('transfers.new.problems'),
          message: problems.map((p) => `${p.identifier} — ${p.reason}`).join('\n'),
        });
        return;
      }
      toast.error(toFriendlyError(error).body);
      // The request id is deliberately NOT regenerated: the next attempt is a
      // retry of this one, and must resolve to the same transfer if the first
      // actually reached the server.
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t('transfers.new') }} />

      <Section title={t('transfers.new.from')}>
        <Card>
          {/* The source is the active branch, always, and is stated rather than chosen. */}
          <Text variant="bodyStrong">{branchName ?? '—'}</Text>
        </Card>
      </Section>

      <Section title={t('transfers.new.to')}>
        <Card>
          {destinations.length === 0 ? (
            <Text tone="secondary">{t('transfers.new.sameBranch')}</Text>
          ) : (
            <SegmentedControl
              options={destinations.map((b) => ({ value: b.id, label: b.name }))}
              value={toBranchId ?? ''}
              onChange={setToBranchId}
            />
          )}
          {!toBranchId ? (
            <Text variant="caption" tone="tertiary" style={styles.gapTop}>
              {t('transfers.new.chooseDestination')}
            </Text>
          ) : null}
        </Card>
      </Section>

      <Section>
        <Card>
          <Text tone="secondary">{t('transfers.new.howTo')}</Text>
          <Button
            title={t('transfers.new.scan')}
            icon={ScanLine}
            onPress={() => setScanning(true)}
            style={styles.gapTop}
          />
        </Card>
      </Section>

      {/* Manual entry is not a fallback for failure; it is always available —
          for a phone that will not power on, and a camera that will not focus. */}
      <Section title={t('transfers.new.manual')}>
        <Card>
          <TextField
            value={typed}
            onChangeText={setTyped}
            keyboardType="number-pad"
            autoCorrect={false}
            placeholder="356938035643809"
            returnKeyType="done"
            onSubmitEditing={() => add(typed)}
          />
          <Button
            title={t('action.add')}
            variant="secondary"
            disabled={typed.trim().length === 0}
            onPress={() => add(typed)}
            style={styles.gapTop}
          />
        </Card>
      </Section>

      <Section title={t('transfers.new.items')}>
        {items.length === 0 ? (
          <EmptyState
            size="inline"
            title={t('transfers.new.noItems')}
            body={t('transfers.new.noItemsBody')}
          />
        ) : (
          <View style={styles.items}>
            {items.map((item) => (
              <Card key={item.identifier}>
                <View style={styles.item}>
                  <View style={styles.itemBody}>
                    {/* The exact thing, shown before it is sent anywhere. */}
                    <Text variant="bodyStrong">{item.product ?? '—'}</Text>
                    <Identifier>{item.identifier}</Identifier>
                  </View>
                  <Button
                    title={t('action.remove')}
                    icon={Trash2}
                    variant="tertiary"
                    size="sm"
                    onPress={() => setItems(removeFromDraft(items, item.identifier))}
                  />
                </View>
              </Card>
            ))}
          </View>
        )}
      </Section>

      <Section>
        <Card>
          {/* Say what the button will do BEFORE it is pressed. A manager's
              request is born approved; an employee's waits for someone. */}
          <Text tone="secondary">
            {t(intent === 'creates_approved' ? 'transfers.new.note.approved' : 'transfers.new.note.awaits')}
          </Text>
          <Button
            title={t(
              intent === 'creates_approved'
                ? 'transfers.new.submit.approved'
                : 'transfers.new.submit.awaits',
            )}
            disabled={!canSubmit}
            loading={create.isPending}
            onPress={submit}
            style={styles.gapTop}
          />
          <Button
            title={t('action.cancel')}
            variant="tertiary"
            onPress={leave}
            style={styles.gapTop}
          />
        </Card>
      </Section>

      <ScannerSheet
        open={scanning}
        onClose={() => setScanning(false)}
        hint={t('transfers.new.howTo')}
        onResult={(result) => {
          const code = result.code ?? '';
          if (code) {
            add(code, {
              // What the scanner thinks it is, so the user confirms the exact
              // product before sending. The server has the final say.
              product: result.suggestion
                ? [result.suggestion.brand, result.suggestion.model, result.suggestion.variant]
                    .filter(Boolean)
                    .join(' ')
                : null,
              trackingType: result.suggestion?.trackingType ?? null,
            });
          }
          setScanning(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gapTop: { marginTop: space.sm },
  items: { gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  itemBody: { flex: 1, gap: space.xs },
});
