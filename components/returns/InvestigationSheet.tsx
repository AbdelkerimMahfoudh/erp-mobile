import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { space } from '../../lib/design/tokens';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import {
  handleConflict,
  useAddAdjustment,
  useInvestigate,
  useRemoveAdjustment,
} from '../../lib/returns';
import { toast } from '../../lib/toast';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button } from '../ui/Button';
import { MoneyField, TextField } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Text } from '../ui/Text';
import type { ReturnAdjustmentKind, ReturnDetail, ReturnResponsibility } from '../../types/api';

/**
 * The manager's surface: decide who is responsible, and draft what will be
 * withheld from the refund.
 *
 * Every total here comes back from the SERVER after each change — the client
 * never multiplies or sums. That is deliberate: the figure a manager reads
 * before approving has to be the same figure the reversal will record, and the
 * only way to guarantee that is for one side to compute it.
 */

const RESPONSIBILITIES: ReturnResponsibility[] = [
  'pending_investigation',
  'store_or_product_fault',
  'customer_damage',
  'other',
];

const KINDS: ReturnAdjustmentKind[] = [
  'screen_protector',
  'accessory_retained',
  'restocking_fee',
  'other',
];

export function InvestigationSheet({
  open,
  onClose,
  detail,
  refetch,
}: {
  open: boolean;
  onClose: () => void;
  detail: ReturnDetail;
  refetch: () => void;
}) {
  const { t } = useTranslation();
  const investigate = useInvestigate(detail.id);
  const addAdjustment = useAddAdjustment(detail.id);
  const removeAdjustment = useRemoveAdjustment(detail.id);

  const [responsibility, setResponsibility] = useState<ReturnResponsibility>(detail.responsibility);
  const [notes, setNotes] = useState(detail.responsibilityNotes ?? '');
  const [conditionNotes, setConditionNotes] = useState(detail.conditionNotes ?? '');
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ReturnAdjustmentKind>('screen_protector');
  const [label, setLabel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitAmount, setUnitAmount] = useState('');

  // Re-seed from the server each time it opens, so the sheet never shows a
  // decision somebody else has since changed.
  useEffect(() => {
    if (!open) return;
    setResponsibility(detail.responsibility);
    setNotes(detail.responsibilityNotes ?? '');
    setConditionNotes(detail.conditionNotes ?? '');
    setAdding(false);
    setLabel('');
    setQuantity('1');
    setUnitAmount('');
  }, [open, detail.responsibility, detail.responsibilityNotes, detail.conditionNotes]);

  const otherNeedsWhy = responsibility === 'other' && notes.trim().length === 0;

  const save = async () => {
    try {
      await investigate.mutateAsync({
        expectedVersion: detail.version,
        responsibility,
        responsibilityNotes: notes.trim() || undefined,
        conditionNotes: conditionNotes.trim() || undefined,
      });
      onClose();
    } catch (e) {
      if (!handleConflict(e, refetch)) throw e;
      onClose();
    }
  };

  const submitAdjustment = async () => {
    try {
      await addAdjustment.mutateAsync({
        kind,
        label: label.trim(),
        quantity: Number(quantity) || 1,
        unitAmount: Number(unitAmount) || 0,
        expectedVersion: detail.version,
      });
      setAdding(false);
      setLabel('');
      setUnitAmount('');
    } catch (e) {
      // The ceiling is the server's rule; say what it said rather than guessing.
      if (!handleConflict(e, refetch)) toast.error(t('returns.review.adjustment.tooBig'));
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('returns.review.action')} maxHeightRatio={0.9}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <View style={styles.group}>
          <Text variant="label" tone="secondary">
            {t('returns.review.responsibilityLabel')}
          </Text>
          <SegmentedControl
            size="sm"
            options={RESPONSIBILITIES.map((r) => ({
              value: r,
              label: t(`status.responsibility.${r}` as never),
            }))}
            value={responsibility}
            onChange={(v) => setResponsibility(v as ReturnResponsibility)}
          />
          {/* Said before the manager tries to approve, not after it is refused. */}
          {responsibility === 'customer_damage' ? (
            <Text variant="caption" tone="warning">
              {t('returns.review.damageWarning')}
            </Text>
          ) : null}
        </View>

        <TextField
          label={t('returns.detail.responsibility')}
          value={notes}
          onChangeText={setNotes}
          multiline
          hint={otherNeedsWhy ? t('returns.review.otherRequired') : undefined}
          required={responsibility === 'other'}
        />

        <TextField
          label={t('returns.detail.notes')}
          value={conditionNotes}
          onChangeText={setConditionNotes}
          multiline
        />

        <View style={styles.group}>
          <Text variant="label" tone="secondary">
            {t('returns.detail.adjustments')}
          </Text>
          {detail.adjustments.map((a) => (
            <View key={a.id} style={styles.adjustmentRow}>
              <View style={styles.adjustmentText}>
                <Text variant="body" numberOfLines={1}>
                  {t(`returns.adjustment.${a.kind}` as never)} — {a.label}
                </Text>
                <Text variant="caption" tone="tertiary">
                  {a.quantity} × {formatMoney(a.unitAmount)} = {formatMoney(a.totalAmount)}
                </Text>
              </View>
              <IconButton
                icon={X}
                accessibilityLabel={t('returns.review.adjustment.remove')}
                size={36}
                onPress={() =>
                  void removeAdjustment
                    .mutateAsync({ adjustmentId: a.id, expectedVersion: detail.version })
                    .catch((e) => {
                      if (!handleConflict(e, refetch)) throw e;
                    })
                }
              />
            </View>
          ))}

          {adding ? (
            <View style={styles.group}>
              <SegmentedControl
                size="sm"
                options={KINDS.map((k) => ({ value: k, label: t(`returns.adjustment.${k}` as never) }))}
                value={kind}
                onChange={(v) => setKind(v as ReturnAdjustmentKind)}
              />
              <TextField
                label={t('returns.review.adjustment.label')}
                value={label}
                onChangeText={setLabel}
              />
              <TextField
                label={t('returns.review.adjustment.quantity')}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
              />
              <MoneyField
                label={t('returns.review.adjustment.unitAmount')}
                value={unitAmount}
                onChangeText={setUnitAmount}
              />
              <Button
                title={t('action.add')}
                disabled={label.trim().length === 0}
                loading={addAdjustment.isPending}
                onPress={() => void submitAdjustment()}
              />
            </View>
          ) : (
            <Button
              title={t('returns.review.adjustment.add')}
              variant="tertiary"
              icon={Plus}
              onPress={() => setAdding(true)}
            />
          )}
        </View>

        {/* The server's arithmetic, echoed — never recomputed here. */}
        <View style={styles.totals}>
          <Text variant="caption" tone="warning">
            {t('returns.detail.provisional')}
          </Text>
          <Row label={t('returns.detail.gross')} value={detail.money.grossRefund} />
          <Row label={t('returns.detail.adjustments')} value={-detail.money.adjustmentTotal} />
          <Row label={t('returns.detail.net')} value={detail.money.netRefundDue} strong />
        </View>

        <Button
          title={t('returns.review.save')}
          loading={investigate.isPending}
          disabled={otherNeedsWhy}
          onPress={() => void save()}
        />
      </ScrollView>
    </BottomSheet>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'primary' : 'secondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'body'}>{formatMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.base, paddingBottom: space['2xl'] },
  group: { gap: space.sm },
  adjustmentRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  adjustmentText: { flex: 1 },
  totals: { gap: space.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
