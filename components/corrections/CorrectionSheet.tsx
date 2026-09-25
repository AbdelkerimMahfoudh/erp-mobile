import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, Chip, InlineNotice, MoneyField, MoneyValue, Text, TextField } from '../ui';
import { api } from '../../lib/api-client';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toFriendlyError } from '../../lib/errors';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { selectableAccounts } from '../../lib/receiving-accounts';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import { actionKey, actionNeeds, canSendCorrection, refusalKey, type CorrectionAction } from '../../lib/closing-report-view';
import { correctionBodyOf, useCorrect, usePreviewCorrection, type CorrectionPreview, type PreviewLeg } from '../../lib/closing-report';

/** The record being corrected, as the list or its own screen knows it. */
export interface CorrectionTarget {
  id: string;
  /** The recorded amount: the most a part-correction may take. */
  amount: number;
  /** Where the money was recorded (a move offers every other channel). */
  channel: 'cash' | 'account' | null;
  accountId?: string | null;
  /** How the sheet names the record, e.g. "Invoice 00046" or "Transport". */
  label: string;
}

interface Account {
  id: string;
  label: string;
  isActive?: boolean;
}

/**
 * One correction, asked for and — by the Owner — approved in one step (docs/51 §15).
 *
 * The record is never edited. The server previews exactly what the correction
 * would do, as the person chooses: the money leaving or reaching each channel,
 * the phones going back or leaving stock, the debt before and after, and the day
 * it all posts to. Nothing is sent until a reason is written, and a refusal is
 * said in words, never as a code. Anybody who may ask but not approve sends it to
 * the Owner; the request and the approval are recorded apart even when the Owner
 * does both.
 */
export function CorrectionSheet({
  action,
  target,
  date,
  onClose,
}: {
  action: CorrectionAction;
  target: CorrectionTarget;
  /** The business date the list shows, so its figures refresh. */
  date?: string;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const canApprove = usePermission('financial.correction.approve');
  const needs = actionNeeds(action);
  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ receivingAccounts?: Account[] }>('/settings'),
    enabled: needs.destination,
  });
  const accounts = selectableAccounts(settings.data?.receivingAccounts);
  const destinations = useMemo(
    () =>
      needs.destination
        ? [
            ...(target.channel === 'cash' ? [] : [{ key: 'cash', method: 'cash' as const, accountId: undefined as string | undefined, label: t('closing.channel.cash') }]),
            ...accounts.filter((a) => a.id !== target.accountId).map((a) => ({ key: a.id, method: 'account' as const, accountId: a.id, label: a.label })),
          ]
        : [],
    [accounts, needs.destination, t, target.accountId, target.channel],
  );
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(target.amount));
  const [reason, setReason] = useState('');
  const clientUuid = useMemo(() => uuidv4(), []);
  const preview = usePreviewCorrection();
  const correct = useCorrect(date);

  const chosen = destinations.find((d) => d.key === to) ?? null;
  const value = needs.amount ? Number(amount.replace(',', '.')) : null;
  const inputsValid =
    (!needs.destination || !!chosen) && (!needs.amount || (value !== null && value > 0 && Math.round(value * 100) <= Math.round(target.amount * 100)));
  const body = useMemo(
    () => ({
      ...correctionBodyOf(action, target.id),
      ...(chosen ? { toMethod: chosen.method, ...(chosen.accountId ? { toAccountId: chosen.accountId } : {}) } : {}),
      ...(needs.amount && value !== null ? { amount: value } : {}),
    }),
    [action, chosen, needs.amount, target.id, value],
  );

  // Ask the server what this would do whenever the choice changes; nothing is written.
  const previewKey = inputsValid ? JSON.stringify(body) : '';
  useEffect(() => {
    if (!previewKey) return;
    preview.mutate(body);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `preview.mutate` is stable; re-ask only when the inputs change.
  }, [previewKey]);
  const shown: CorrectionPreview | null = inputsValid ? (preview.data ?? null) : null;
  const refusal = shown?.refusal ? refusalKey(shown.refusal) : null;

  const send = async () => {
    try {
      const done = await correct.mutateAsync({ ...body, reason: reason.trim(), clientUuid, approve: canApprove });
      toast.success(done.status === 'approved' ? t('correctTx.done') : t('correctTx.requested'));
      onClose();
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('correctTx.failed'));
    }
  };

  const channelName = (l: { method: 'cash' | 'account'; accountLabel: string | null }) =>
    l.method === 'cash' ? t('closing.channel.cash') : (l.accountLabel ?? t('closing.channel.unattributed'));

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t(actionKey(action) as never)}
      subtitle={`${target.label} · ${isolateLtr(formatMoney(target.amount))}`}
      footer={
        <Button
          title={canApprove ? t('correctTx.send.approve') : t('correctTx.send.request')}
          fullWidth
          variant={action === 'cancel_sale' || action === 'cancel_purchase' ? 'danger' : 'primary'}
          loading={correct.isPending}
          disabled={
            !canSendCorrection({
              action,
              amount: value,
              maxAmount: target.amount,
              destinationChosen: !!chosen,
              reason,
              previewOk: !!shown && !preview.isError,
              refused: !!shown?.refusal,
              busy: correct.isPending,
            })
          }
          onPress={() => void send()}
        />
      }
    >
      <View style={styles.sheet}>
        <Text variant="body" tone="secondary">
          {t(`correctTx.explain.${action}` as never)}
        </Text>
        {needs.destination ? (
          <>
            <Text variant="bodyStrong">{t(action === 'reclassify_purchase_payment' ? 'correctTx.destination.purchase' : 'correctTx.destination.sale')}</Text>
            <View style={styles.choices}>
              {destinations.map((d) => (
                <Button key={d.key} title={d.label} variant={to === d.key ? 'primary' : 'secondary'} size="sm" onPress={() => setTo(d.key)} />
              ))}
            </View>
          </>
        ) : null}
        {needs.amount ? <MoneyField label={t(`correctTx.amount.${action}` as never)} value={amount} onChangeText={setAmount} /> : null}
        <TextField label={t('correctTx.reason')} value={reason} onChangeText={setReason} placeholder={t(`correctTx.reason.placeholder.${action}` as never)} maxLength={255} />

        {preview.isError ? <InlineNotice tone="danger">{toFriendlyError(preview.error).body}</InlineNotice> : null}
        {shown ? (
          <View style={styles.preview}>
            <Text variant="label" tone="secondary">
              {t('correctTx.preview')}
            </Text>
            {shown.legs.map((l: PreviewLeg, i: number) => (
              <View key={`${l.direction}:${l.method}:${l.accountId ?? 'NONE'}:${i}`} style={styles.between}>
                <Text variant="body" style={styles.flex}>
                  {t(l.direction === 'in' ? 'correctTx.leg.in' : 'correctTx.leg.out', { channel: channelName(l) })}
                </Text>
                <MoneyValue value={l.direction === 'in' ? l.amount : -l.amount} size="small" signed tone="auto" />
              </View>
            ))}
            {shown.legs.length === 0 ? (
              <Text variant="caption" tone="secondary">
                {t('correctTx.preview.noMoney')}
              </Text>
            ) : null}
            <PreviewFacts action={action} preview={shown} />
            <Text variant="caption" tone="tertiary">
              {shown.dayClosed
                ? t('correctTx.preview.dayClosed', { date: formatDate(shown.correctionDate) })
                : t('correctTx.preview.posts', { date: formatDate(shown.correctionDate) })}
            </Text>
            {refusal ? <Chip tone="warning" label={t(refusal as never)} size="sm" dot /> : null}
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

/** What else the correction does, in the words of the record it corrects. */
function PreviewFacts({ action, preview }: { action: CorrectionAction; preview: CorrectionPreview }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const money = (n: number | undefined) => isolateLtr(formatMoney(n ?? 0));
  const sale = preview.sale as { owed?: number; before?: { owed: number }; after?: { owed: number } } | undefined;

  if (action === 'reverse_payment' && sale?.before && sale.after) {
    return (
      <>
        <Text variant="caption" tone="secondary">
          {t('correctTx.preview.owedAgain', { before: money(sale.before.owed), after: money(sale.after.owed) })}
        </Text>
        {preview.debtor ? (
          <Text variant="caption" tone="secondary">
            {t('correctTx.preview.debtor', { name: preview.debtor.name })}
          </Text>
        ) : null}
      </>
    );
  }
  if (action === 'reclassify_payment' && preview.unchanged) {
    return (
      <Text variant="caption" tone="secondary">
        {t('correctTx.preview.unchanged', { collected: money(preview.unchanged.collected), owed: money(preview.unchanged.owed) })}
      </Text>
    );
  }
  if (action === 'reverse_expense') {
    return (
      <Text variant="caption" tone="secondary">
        {t('correctTx.preview.expenseFalls', { amount: money(preview.amount) })}
      </Text>
    );
  }
  if (action === 'cancel_sale') {
    return (
      <>
        {(preview.items ?? []).length > 0 ? (
          <Text variant="caption" tone="secondary">
            {t('correctTx.preview.backInStock')}
          </Text>
        ) : null}
        {(preview.items ?? []).map((it, i) => (
          <Text key={`${it.name}:${i}`} variant="caption" style={styles.item}>
            {it.identifier ? `${it.name} · ${isolateLtr(it.identifier)}` : t('correctTx.preview.quantity', { name: it.name, count: String(it.quantity) })}
          </Text>
        ))}
        {sale?.owed ? (
          <Text variant="caption" tone="secondary">
            {t('correctTx.preview.debtCleared', { amount: money(sale.owed) })}
          </Text>
        ) : null}
      </>
    );
  }
  if (action === 'cancel_purchase') {
    return (
      <>
        {(preview.units ?? []).length > 0 ? (
          <Text variant="caption" tone="secondary">
            {t('correctTx.preview.leaveStock')}
          </Text>
        ) : null}
        {(preview.units ?? []).map((u, i) => (
          <Text key={`${u.name}:${i}`} variant="caption" style={styles.item}>
            {u.identifier ? `${u.name} · ${isolateLtr(u.identifier)}` : u.name}
          </Text>
        ))}
        {(preview.stock ?? []).map((s) => (
          <Text key={s.name} variant="caption" style={styles.item}>
            {t('correctTx.preview.stockAfter', { name: s.name, bought: String(s.bought), after: String(s.onHandAfter ?? s.onHand) })}
          </Text>
        ))}
      </>
    );
  }
  return null;
}

const useStyles = makeStyles(() => ({
  sheet: { gap: space.md, paddingVertical: space.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preview: { gap: space.xs },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  flex: { flex: 1, minWidth: 0 },
  item: { paddingStart: space.sm },
}));
