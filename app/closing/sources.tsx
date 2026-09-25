import React, { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeftRight, Banknote, Ban, ExternalLink, Receipt, RotateCcw, ShoppingBag, ShoppingCart, Undo2, Wallet } from 'lucide-react-native';
import { BottomSheet } from '../../components/overlay/BottomSheet';
import { CorrectionSheet, type CorrectionTarget } from '../../components/corrections/CorrectionSheet';
import { DecideSheet } from '../../components/corrections/DecideSheet';
import { DEFAULT_SEPARATOR_INSET, EmptyState, ErrorState, ListRow, MoneyValue, RowGroup, Section, SkeletonList, Text } from '../../components/ui';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { HeaderShownContext } from '../../lib/navigation/router-internals';
import { actionKey, pendingKey, refusalKey, targetIdFor, type CorrectionAction } from '../../lib/closing-report-view';
import { useClosingSources, type PendingCorrection, type SourceRow } from '../../lib/closing-report';

/**
 * "Correct a transaction" (docs/51 §15): every record behind one business date —
 * sales, payments, refunds, expenses, stock purchases, corrections — with what can
 * be done about each, or why not, and the requests waiting for the Owner.
 *
 * A record is never edited. A sale that should not exist is cancelled; a payment
 * never received is reversed or one in the wrong channel moved; a wrong expense is
 * reversed in whole or part; a purchase in the wrong channel is moved or one that
 * should not exist is cancelled — each with a reason, previewed first, approved by
 * the Owner, posted to the current open day. A refund is corrected on its return.
 */
export default function CorrectTransactionScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const headerShown = React.useContext(HeaderShownContext);
  const { date } = useLocalSearchParams<{ date?: string }>();
  const sources = useClosingSources(date);
  const [choosing, setChoosing] = useState<SourceRow | null>(null);
  const [acting, setActing] = useState<{ row: SourceRow; action: CorrectionAction } | null>(null);
  const [deciding, setDeciding] = useState<PendingCorrection | null>(null);

  const openRecord = (row: SourceRow) => {
    const d = row.detail as Record<string, string>;
    if (row.open === 'sale') router.push({ pathname: '/sales/[id]', params: { id: row.kind === 'sale' ? row.id : d.saleId } } as never);
    else if (row.open === 'return' && d.returnId) router.push({ pathname: '/returns/[id]', params: { id: d.returnId } } as never);
    else if (row.open === 'expense') router.push({ pathname: '/expenses/[id]', params: { id: row.id } } as never);
  };
  const tap = (row: SourceRow) => {
    if (row.actions.length > 0) setChoosing(row);
    else if (row.open) openRecord(row);
  };

  const data = sources.data;
  const pending = data?.pending ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={headerShown ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('correctTx.title') }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={sources.isRefetching} onRefresh={() => void sources.refetch()} />}
        showsVerticalScrollIndicator={false}
      >
        {data ? (
          <Text variant="label" tone="secondary">
            {formatDate(`${data.date}T00:00:00Z`)}
          </Text>
        ) : null}
        <Text variant="body" tone="secondary">
          {t('correctTx.subtitle')}
        </Text>

        {pending.length > 0 ? (
          <Section title={t('correctTx.pending.title')}>
            <RowGroup>
              {pending.map((p) => (
                <View key={p.id}>
                  <ListRow
                    flat
                    leading={Undo2}
                    title={t(pendingKey(p) as never)}
                    subtitle={[p.label, p.requestedBy].filter(Boolean).join(' · ')}
                    value={<MoneyValue value={p.amount} size="small" />}
                    valueCaption={p.superseded ? t('correctTx.pending.supersededShort') : t('correctTx.status.correction_requested')}
                    onPress={data?.canApprove ? () => setDeciding(p) : undefined}
                  />
                  <Text variant="caption" tone="secondary" style={styles.note}>
                    {p.reason}
                  </Text>
                </View>
              ))}
            </RowGroup>
            {!data?.canApprove ? (
              <Text variant="caption" tone="tertiary">
                {t('correctTx.pending.ownerDecides')}
              </Text>
            ) : null}
          </Section>
        ) : null}

        {sources.isPending ? (
          <SkeletonList count={5} />
        ) : sources.isError || !data ? (
          <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
        ) : data.rows.length === 0 ? (
          <EmptyState title={t('correctTx.empty')} />
        ) : (
          <RowGroup>
            {data.rows.map((row) => (
              <SourceLine key={`${row.kind}:${row.id}`} row={row} onPress={row.actions.length > 0 || row.open ? () => tap(row) : undefined} />
            ))}
          </RowGroup>
        )}
      </ScrollView>

      {choosing ? (
        <ActionChooser
          row={choosing}
          onClose={() => setChoosing(null)}
          onChoose={(action) => {
            setActing({ row: choosing, action });
            setChoosing(null);
          }}
          onOpen={() => {
            const row = choosing;
            setChoosing(null);
            openRecord(row);
          }}
        />
      ) : null}
      {acting ? <CorrectionSheet action={acting.action} target={targetOf(acting.row, acting.action, t)} date={date} onClose={() => setActing(null)} /> : null}
      {deciding ? <DecideSheet pending={deciding} date={date} onClose={() => setDeciding(null)} /> : null}
    </SafeAreaView>
  );
}

/** The record as the correction sheet needs it: the id the action corrects, its amount, its channel and a name. */
function targetOf(row: SourceRow, action: CorrectionAction, t: (k: never, p?: Record<string, string>) => string): CorrectionTarget {
  const d = row.detail as Record<string, string | null | undefined>;
  const label =
    row.kind === 'sale' || row.kind === 'payment'
      ? d.invoiceNo
        ? t('correctTx.invoice' as never, { invoice: String(d.invoiceNo) })
        : t(`correctTx.kind.${row.kind}` as never)
      : row.kind === 'expense'
        ? String(d.category ?? t('correctTx.kind.expense' as never))
        : t(`correctTx.kind.${row.kind}` as never);
  return { id: targetIdFor(row, action), amount: row.amount, channel: row.channel, accountId: (d.accountId as string | null | undefined) ?? null, label };
}

const ACTION_ICON = {
  cancel_sale: Ban,
  reverse_payment: Undo2,
  reclassify_payment: ArrowLeftRight,
  reverse_expense: Undo2,
  reclassify_purchase_payment: ArrowLeftRight,
  cancel_purchase: Ban,
} as const;

/** What can be done to this record: each correction, and the record's own screen. */
function ActionChooser({ row, onClose, onChoose, onOpen }: { row: SourceRow; onClose: () => void; onChoose: (a: CorrectionAction) => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <BottomSheet open onClose={onClose} title={t('correctTx.choose')} subtitle={t(`correctTx.kind.${row.kind}` as never)}>
      <View style={styles.sheet}>
        <RowGroup>
          {row.actions.map((a) => (
            <ListRow key={a} flat leading={ACTION_ICON[a]} title={t(actionKey(a) as never)} subtitle={t(`correctTx.hint.${a}` as never)} onPress={() => onChoose(a)} />
          ))}
          {row.open ? <ListRow flat leading={ExternalLink} title={t(`correctTx.openRecord.${row.open}` as never)} onPress={onOpen} /> : null}
        </RowGroup>
      </View>
    </BottomSheet>
  );
}

const ICON = { sale: ShoppingCart, payment: Banknote, refund: RotateCcw, expense: Receipt, purchase: ShoppingBag, correction: ArrowLeftRight } as const;

function SourceLine({ row, onPress }: { row: SourceRow; onPress?: () => void }) {
  const { t } = useTranslation();
  const d = row.detail as Record<string, string | boolean | number | null>;
  const channel = row.channel === null ? null : row.channel === 'cash' ? t('closing.channel.cash') : (row.accountLabel ?? t('closing.channel.unattributed'));
  const context =
    row.kind === 'payment'
      ? [d.invoiceNo ? t('correctTx.invoice', { invoice: String(d.invoiceNo) }) : null, d.olderSale ? t('correctTx.olderDebt') : null].filter(Boolean).join(' · ')
      : row.kind === 'sale'
        ? [d.invoiceNo ? t('correctTx.invoice', { invoice: String(d.invoiceNo) }) : null, d.debtor ? String(d.debtor) : null].filter(Boolean).join(' · ')
        : row.kind === 'expense'
          ? String(d.category ?? '')
          : row.kind === 'correction'
            ? t(`correctTx.correction.${String(d.targetKind)}.${String(d.action)}` as never)
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
        subtitleLines={0}
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

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.surface.canvas },
  content: { padding: space.base, gap: space.md, paddingBottom: space['3xl'] },
  sheet: { gap: space.md, paddingVertical: space.sm },
  refusal: { marginStart: DEFAULT_SEPARATOR_INSET, paddingEnd: space.base, paddingBottom: space.sm },
  note: { marginStart: DEFAULT_SEPARATOR_INSET, paddingEnd: space.base, paddingBottom: space.sm },
}));
