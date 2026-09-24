import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeftRight, Banknote, Receipt, RotateCcw, ShoppingBag, Wallet } from 'lucide-react-native';
import { BottomSheet } from '../../components/overlay/BottomSheet';
import { Button, Chip, DEFAULT_SEPARATOR_INSET, EmptyState, ErrorState, InlineNotice, ListRow, MoneyField, MoneyValue, RowGroup, SkeletonList, Text, TextField } from '../../components/ui';
import { api } from '../../lib/api-client';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toFriendlyError } from '../../lib/errors';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { HeaderShownContext } from '../../lib/navigation/router-internals';
import { usePermission } from '../../lib/permissions';
import { qk } from '../../lib/query-keys';
import { selectableAccounts } from '../../lib/receiving-accounts';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import { reasonGiven, refusalKey } from '../../lib/closing-report-view';
import { useClosingSources, usePreviewReclassify, useReclassifyPayment, type ReclassifyPreview, type SourceRow } from '../../lib/closing-report';

/**
 * "Correct a transaction" (docs/51 D9): every record behind one business date
 * — payments, refunds paid, expenses, stock paid, corrections — with its time,
 * amount, channel and status, and where its correction lives. A record is
 * never edited: a payment recorded in the wrong channel is moved by a
 * correction with a reason, previewed first; a refund opens its return, where
 * the existing correction lives; anything that cannot be corrected here says so.
 */
export default function CorrectTransactionScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const headerShown = React.useContext(HeaderShownContext);
  const { date } = useLocalSearchParams<{ date?: string }>();
  const sources = useClosingSources(date);
  const [moving, setMoving] = useState<SourceRow | null>(null);

  const open = (row: SourceRow) => {
    const d = row.detail as Record<string, string>;
    if (row.action === 'reclassify_payment') setMoving(row);
    else if (row.action === 'open_sale' && d.saleId) router.push({ pathname: '/sales/[id]', params: { id: d.saleId } } as never);
    else if (row.action === 'open_return' && d.returnId) router.push({ pathname: '/returns/[id]', params: { id: d.returnId } } as never);
    else if (row.action === 'open_expense') router.push({ pathname: '/expenses/[id]', params: { id: row.id } } as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={headerShown ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('correctTx.title') }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={sources.isRefetching} onRefresh={() => void sources.refetch()} />}
        showsVerticalScrollIndicator={false}
      >
        {sources.data ? (
          <Text variant="label" tone="secondary">
            {formatDate(`${sources.data.date}T00:00:00Z`)}
          </Text>
        ) : null}
        <Text variant="body" tone="secondary">
          {t('correctTx.subtitle')}
        </Text>
        {sources.isPending ? (
          <SkeletonList count={5} />
        ) : sources.isError || !sources.data ? (
          <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
        ) : sources.data.rows.length === 0 ? (
          <EmptyState title={t('correctTx.empty')} />
        ) : (
          <RowGroup>
            {sources.data.rows.map((row) => (
              <SourceLine key={`${row.kind}:${row.id}`} row={row} onPress={row.action ? () => open(row) : undefined} />
            ))}
          </RowGroup>
        )}
      </ScrollView>
      {moving ? <MoveSheet row={moving} date={date} onClose={() => setMoving(null)} /> : null}
    </SafeAreaView>
  );
}

const ICON = { payment: Banknote, refund: RotateCcw, expense: Receipt, supplier_payment: ShoppingBag, correction: ArrowLeftRight } as const;

function SourceLine({ row, onPress }: { row: SourceRow; onPress?: () => void }) {
  const { t } = useTranslation();
  const d = row.detail as Record<string, string | boolean>;
  const channel = row.channel === 'cash' ? t('closing.channel.cash') : (row.accountLabel ?? t('closing.channel.unattributed'));
  const context =
    row.kind === 'payment'
      ? [d.invoiceNo ? t('correctTx.invoice', { invoice: String(d.invoiceNo) }) : null, d.olderSale ? t('correctTx.olderDebt') : null].filter(Boolean).join(' · ')
      : row.kind === 'expense'
        ? String(d.category ?? '')
        : '';
  const styles = useStyles();
  const refusal = refusalKey(row.refusal);
  const subtitle = [row.localTime ? isolateLtr(row.localTime) : null, channel, context || null].filter(Boolean).join(' · ');
  return (
    <View>
      <ListRow
        flat
        leading={ICON[row.kind] ?? Wallet}
        title={t(`correctTx.kind.${row.kind}` as never)}
        subtitle={subtitle}
        value={<MoneyValue value={row.amount} size="small" />}
        valueCaption={t(`correctTx.status.${row.status}` as never)}
        onPress={onPress}
      />
      {/* The refusal on its own line: said in full, never cut short inside a crowded subtitle. */}
      {refusal ? (
        <Text variant="caption" tone="secondary" style={styles.refusal}>
          {t(refusal as never)}
        </Text>
      ) : null}
    </View>
  );
}

interface Account {
  id: string;
  label: string;
  isActive?: boolean;
}

/**
 * Move all or part of a payment to the channel it really reached. The server
 * previews it first — the two legs, the day they post to, what does not change
 * — and nothing is sent until a reason is written. An Owner corrects it in one
 * step (the request and the approval are still recorded apart); anybody else
 * asks the Owner.
 */
function MoveSheet({ row, date, onClose }: { row: SourceRow; date?: string; onClose: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const canApprove = usePermission('financial.correction.approve');
  const settings = useQuery({ queryKey: qk.settings, queryFn: () => api.get<{ receivingAccounts?: Account[] }>('/settings') });
  const accounts = selectableAccounts(settings.data?.receivingAccounts);
  const preview = usePreviewReclassify();
  const move = useReclassifyPayment(date);
  const clientUuid = useMemo(() => uuidv4(), []);
  const fromCash = row.channel === 'cash';
  const destinations = useMemo(
    () => [
      ...(fromCash ? [] : [{ key: 'cash', method: 'cash' as const, accountId: undefined as string | undefined, label: t('closing.channel.cash') }]),
      ...accounts.filter((a) => a.id !== (row.detail as { accountId?: string | null }).accountId).map((a) => ({ key: a.id, method: 'account' as const, accountId: a.id, label: a.label })),
    ],
    [accounts, fromCash, row.detail, t],
  );
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(row.amount));
  const [reason, setReason] = useState('');
  const chosen = destinations.find((d) => d.key === to) ?? null;
  const value = Number(amount);
  const valid = !!chosen && value > 0 && value <= row.amount;

  // Ask the server what this would do whenever the destination or the amount changes.
  const previewKey = valid ? `${chosen!.key}:${value}` : '';
  useEffect(() => {
    if (!previewKey || !chosen) return;
    preview.mutate({ targetId: row.id, toMethod: chosen.method, toAccountId: chosen.accountId, amount: value });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `preview.mutate` is stable; re-ask only when the inputs change.
  }, [previewKey]);
  const shown: ReclassifyPreview | null = valid ? (preview.data ?? null) : null;

  const submit = async () => {
    if (!chosen) return;
    try {
      const done = await move.mutateAsync({
        targetId: row.id,
        toMethod: chosen.method,
        toAccountId: chosen.accountId,
        amount: value,
        reason: reason.trim(),
        clientUuid,
        approve: canApprove,
      });
      toast.success(done.status === 'approved' ? t('correctTx.move.done') : t('correctTx.move.requested'));
      onClose();
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('correctTx.move.failed'));
    }
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('correctTx.move')}
      subtitle={`${t('correctTx.kind.payment')} · ${isolateLtr(formatMoney(row.amount))}`}
      footer={
        <Button
          title={canApprove ? t('correctTx.move.approve') : t('correctTx.move.request')}
          fullWidth
          loading={move.isPending}
          disabled={!valid || !reasonGiven(reason) || move.isPending || !!shown?.refusal || preview.isError}
          onPress={() => void submit()}
        />
      }
    >
      <View style={styles.sheet}>
        <Text variant="bodyStrong">{t('correctTx.move.title')}</Text>
        <View style={styles.choices}>
          {destinations.map((d) => (
            <Button key={d.key} title={d.label} variant={to === d.key ? 'primary' : 'secondary'} size="sm" onPress={() => setTo(d.key)} />
          ))}
        </View>
        <MoneyField label={t('correctTx.move.amount')} value={amount} onChangeText={setAmount} />
        <TextField label={t('correctTx.move.reason')} value={reason} onChangeText={setReason} placeholder={t('correctTx.move.reason.placeholder')} maxLength={255} />
        {preview.isError ? <InlineNotice tone="danger">{toFriendlyError(preview.error).body}</InlineNotice> : null}
        {shown ? (
          <View style={styles.preview}>
            <Text variant="label" tone="secondary">
              {t('correctTx.move.preview')}
            </Text>
            <View style={styles.between}>
              <Text variant="body" style={styles.flex}>
                {t('correctTx.move.from', { channel: shown.move.from.method === 'cash' ? t('closing.channel.cash') : (shown.move.from.accountLabel ?? t('closing.channel.unattributed')) })}
              </Text>
              <MoneyValue value={-shown.move.amount} size="small" signed tone="auto" />
            </View>
            <View style={styles.between}>
              <Text variant="body" style={styles.flex}>
                {t('correctTx.move.to', { channel: shown.move.to.method === 'cash' ? t('closing.channel.cash') : (shown.move.to.accountLabel ?? '') })}
              </Text>
              <MoneyValue value={shown.move.amount} size="small" signed tone="auto" />
            </View>
            <Text variant="caption" tone="secondary">
              {t('correctTx.move.unchanged', { collected: isolateLtr(formatMoney(shown.unchanged.collected)), owed: isolateLtr(formatMoney(shown.unchanged.owed)) })}
            </Text>
            <Text variant="caption" tone="tertiary">
              {shown.dayClosed
                ? t('correctTx.move.dayClosed', { date: formatDate(`${shown.correctionDate}T00:00:00Z`) })
                : t('correctTx.move.posts', { date: formatDate(`${shown.correctionDate}T00:00:00Z`) })}
            </Text>
            {shown.refusal ? <Chip tone="warning" label={t(refusalKey(shown.refusal) as never)} size="sm" dot /> : null}
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.surface.canvas },
  content: { padding: space.base, gap: space.md, paddingBottom: space['3xl'] },
  sheet: { gap: space.md, paddingVertical: space.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preview: { gap: space.xs },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  flex: { flex: 1, minWidth: 0 },
  refusal: { marginStart: DEFAULT_SEPARATOR_INSET, paddingEnd: space.base, paddingBottom: space.sm },
}));
