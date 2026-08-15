import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  InlineNotice,
  MoneyValue,
  PermissionNotice,
  Text,
  TextField,
} from '../ui';
import { BottomSheet } from '../overlay';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import {
  correctionConflictKind,
  useApproveCorrection,
  useRejectCorrection,
  useRequestCorrection,
} from '../../lib/corrections';
import type { FinancialCorrectionKind, PaymentCorrectionRef } from '../../types/api';

/**
 * Correcting a confirmed payment, from wherever that payment is shown.
 *
 * One component for both refunds and supplier settlements, because the workflow
 * is identical and the difference is a word. Splitting it would guarantee the
 * two drift.
 *
 * Three states, and the screen must not blur them:
 *
 *   nothing yet   an owner or manager may ask for a correction
 *   requested     asked for, waiting on an owner — **no money has moved**
 *   approved      the money came back; the payment stands, corrected
 *
 * A requested correction is warning-toned, never green. Nothing has been agreed
 * yet, and colouring it as settled would be the same mistake the refund payout
 * workflow was careful to avoid.
 */

export interface CorrectionSectionProps {
  targetKind: FinancialCorrectionKind;
  targetId: string;
  /** What was paid, for the confirmation dialog. */
  amount: number;
  /** Any correction already raised against this payment. */
  correction: PaymentCorrectionRef | null;
  onChanged: () => void;
}

export function CorrectionSection({
  targetKind,
  targetId,
  amount,
  correction,
  onChanged,
}: CorrectionSectionProps) {
  const { t } = useTranslation();
  const canRequest = usePermission('financial.correction.request');
  const canApprove = usePermission('financial.correction.approve');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  /**
   * One request id per logical attempt, held in a ref so a re-render cannot
   * mint a new one. A fresh id per attempt would defeat idempotency: a timeout
   * followed by a retry would record a second correction.
   */
  const requestId = useRef<string>(uuidv4());

  const request = useRequestCorrection();
  const approve = useApproveCorrection(correction?.id ?? '');
  const reject = useRejectCorrection(correction?.id ?? '');

  const explain = async (e: unknown): Promise<boolean> => {
    const kind = correctionConflictKind(e);
    if (!kind) return false;
    onChanged();
    await dialog.alert({
      title: t(`correction.conflict.${kind}.title` as never),
      message: t(`correction.conflict.${kind}.body` as never),
    });
    return true;
  };

  /**
   * An employee sees nothing at all here — not a disabled button, not an
   * explanation. Correcting settled money is not part of their job, and a
   * control they can never use is noise on a screen they read every day.
   */
  if (!canRequest) return null;

  // ── Already decided ──────────────────────────────────────────────────────

  if (correction && correction.status === 'approved') {
    return (
      <Card style={styles.card}>
        <Chip tone="neutral" label={t('correction.status.approved')} dot />
        <Text variant="body" tone="secondary" style={styles.gap}>
          {t('correction.approved.body', {
            date: correction.correctionDate ?? '',
          })}
        </Text>
        <Detail label={t('correction.reason')} value={correction.reason} />
        {correction.supportingReference ? (
          <Detail label={t('correction.reference')} value={correction.supportingReference} />
        ) : null}
        <Detail label={t('correction.requestedBy')} value={correction.requestedBy ?? '—'} />
        <Detail label={t('correction.approvedBy')} value={correction.decidedBy ?? '—'} />
        {/* The replacement path, said plainly so nobody thinks the money is gone. */}
        <InlineNotice tone="info" style={styles.gap}>
          {t('correction.approved.next')}
        </InlineNotice>
      </Card>
    );
  }

  // ── Waiting on an owner ──────────────────────────────────────────────────

  if (correction && correction.status === 'requested') {
    return (
      <Card style={styles.card}>
        {/* Warning, not success: nothing has moved yet. */}
        <Chip tone="warning" label={t('correction.status.requested')} dot />
        <Text variant="body" tone="secondary" style={styles.gap}>
          {t('correction.requested.body')}
        </Text>
        <Detail label={t('correction.reason')} value={correction.reason} />
        <Detail label={t('correction.requestedBy')} value={correction.requestedBy ?? '—'} />
        <Detail
          label={t('correction.requestedAt')}
          value={formatDateTime(new Date(correction.requestedAt))}
        />

        {canApprove ? (
          <View style={styles.actions}>
            <Button
              title={t('correction.approve.action')}
              loading={approve.isPending}
              onPress={async () => {
                /**
                 * High friction, deliberately. This is the moment settled money
                 * is un-settled, so everything being vouched for is on screen
                 * before the owner agrees to it.
                 */
                const ok = await dialog.confirm({
                  title: t('correction.approve.confirm.title'),
                  message: [
                    t('correction.approve.confirm.irreversible'),
                    '',
                    // From the prop: the payment's own amount, which is also
                    // what the server will copy. The correction record carries
                    // no amount of its own that could disagree.
                    `${t('correction.amount')}: ${formatMoney(amount)}`,
                    `${t('correction.reason')}: ${correction.reason}`,
                    `${t('correction.requestedBy')}: ${correction.requestedBy ?? '—'}`,
                  ].join('\n'),
                  confirmLabel: t('correction.approve.action'),
                  cancelLabel: t('action.cancel'),
                  tone: 'danger',
                });
                if (!ok) return;
                try {
                  await approve.mutateAsync({ expectedVersion: correction.version });
                  toast.success(t('correction.approve.done'));
                  onChanged();
                } catch (e) {
                  if (await explain(e)) return;
                  toast.error(t('correction.approve.failed'));
                }
              }}
            />
            <Button
              title={t('correction.reject.action')}
              variant="tertiary"
              loading={reject.isPending}
              onPress={async () => {
                try {
                  await reject.mutateAsync({ expectedVersion: correction.version });
                  toast.success(t('correction.reject.done'));
                  onChanged();
                } catch (e) {
                  if (await explain(e)) return;
                  toast.error(t('correction.reject.failed'));
                }
              }}
            />
          </View>
        ) : (
          // A manager who raised it cannot decide it, and should be told who can
          // rather than being left wondering whether the app is broken.
          <PermissionNotice message={t('correction.approve.ownerOnly')} />
        )}
      </Card>
    );
  }

  // ── Nothing raised yet ───────────────────────────────────────────────────

  return (
    <>
      <Button
        title={t('correction.request.action')}
        variant="tertiary"
        icon={RotateCcw}
        onPress={() => setSheetOpen(true)}
      />

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <View style={styles.sheet}>
          <Text variant="title">{t('correction.request.title')}</Text>
          <Text variant="body" tone="secondary">
            {t('correction.request.body')}
          </Text>

          <Card>
            <Detail label={t('correction.amount')} value="" />
            <MoneyValue value={amount} />
          </Card>

          <TextField
            label={t('correction.reason')}
            hint={t('correction.reason.hint')}
            value={reason}
            onChangeText={setReason}
            required
            autoFocus
          />
          <TextField
            label={t('correction.reference')}
            hint={t('correction.reference.hint')}
            value={reference}
            onChangeText={setReference}
          />

          {/* Said before anything is sent: asking is not correcting. */}
          <InlineNotice tone="info">{t('correction.request.notice')}</InlineNotice>

          <Button
            title={t('correction.request.submit')}
            size="lg"
            fullWidth
            disabled={reason.trim().length === 0}
            loading={request.isPending}
            onPress={async () => {
              try {
                await request.mutateAsync({
                  targetKind,
                  targetId,
                  reason: reason.trim(),
                  supportingReference: reference.trim() || undefined,
                  clientUuid: requestId.current,
                });
                setSheetOpen(false);
                setReason('');
                setReference('');
                toast.success(t('correction.request.done'));
                onChanged();
                // The id is deliberately NOT regenerated: the next attempt is a
                // retry of this one and must resolve to the same correction.
              } catch (e) {
                if (await explain(e)) return;
                toast.error(t('correction.request.failed'));
              }
            }}
          />
        </View>
      </BottomSheet>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong" style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.sm },
  gap: { marginTop: space.xs },
  actions: { gap: space.sm, marginTop: space.base },
  sheet: { gap: space.md, padding: space.base },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.xs,
  },
  detailValue: { flexShrink: 1, textAlign: 'right' },
});
