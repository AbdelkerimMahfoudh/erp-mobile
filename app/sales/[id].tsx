import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { FileText, Store, UserRound } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Identifier,
  InlineNotice,
  ListRow,
  MoneyValue,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  StatusChip,
  Text,
  Thumbnail,
} from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { canShareReceipt, shareReceipt, type ReceiptData } from '../../lib/receipt';
import { isFresh, useRecentSuccess } from '../../lib/recent-success';
import { describeWindow, policyStatus } from '../../lib/return-policy';
import { useSale } from '../../lib/sales';
import { toast } from '../../lib/toast';
import type { SaleDetail, SaleLine, SalePaymentRecord } from '../../types/api';

/**
 * One sale, in full.
 *
 * Opened for three reasons, in this order of frequency: what was sold, what
 * was paid and what is still owed, and whether it can still come back. So the
 * phone comes first — which exact one, by its full IMEI or serial, because
 * staff need it for warranty, returns and matching the handset — then the
 * price and the money, then the return answer, which is the server's,
 * computed from the policy this sale was sold under rather than whatever the
 * shop offers today.
 *
 * Cost and profit appear only when the server sends them. Nothing is hidden
 * here: `cost.view` is enforced by the gating interceptor, so an employee's
 * response simply has no such fields. The receipt is built from this same
 * sale and carries none of them either — `ReceiptData` has no field for them.
 */
export default function SaleDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSale(id);

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title: t('sales.detail.title') }} />

      {query.isLoading ? (
        <View style={styles.padded}>
          <SkeletonList count={4} />
        </View>
      ) : query.isError ? (
        /**
         * The server answers the same 404 for another company's sale, another
         * branch's sale and an id that never existed — deliberately, so nothing
         * can be probed. The screen therefore suggests the one cause a user can
         * actually act on rather than asserting which happened.
         */
        query.error instanceof ApiError && query.error.status === 404 ? (
          <EmptyState title={t('sales.detail.notFound')} body={t('sales.detail.notFoundBody')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : query.data ? (
        <Body sale={query.data} />
      ) : null}
    </Screen>
  );
}

function Body({ sale }: { sale: SaleDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const status = policyStatus(sale.returnPolicy, t, formatDateTime);
  /**
   * Whoever may take money at the counter may record money that arrives
   * later — `sale.create`, the same permission the server checks. Offered only
   * while something is owed on a sale that still stands.
   */
  const canCollect = usePermission('sale.create') && sale.balanceDue > 0 && !sale.isReversed;

  // "Payment recorded", once, when we have just come back from recording one.
  const recordedAt = useRecentSuccess((s) => s.at[`payment:${sale.id}`]);
  const clear = useRecentSuccess((s) => s.clear);
  useEffect(() => () => clear(`payment:${sale.id}`), [sale.id, clear]);

  const { user } = useAuth();
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    setSharing(true);
    try {
      const shared = await shareReceipt(receiptOf(sale, t, user?.companyName ?? null));
      if (!shared) toast.info(t('sell.done.shareFailed'));
    } catch {
      toast.error(t('sell.done.shareFailed'));
    } finally {
      setSharing(false);
    }
  };

  const first = sale.lines.find((l) => !l.voided) ?? sale.lines[0];
  const where = Array.from(
    new Set(sale.payments.map((p) => (p.method === 'cash' ? t('payment.cash') : (p.accountLabel ?? t(`payment.${p.method}` as never))))),
  ).join(' · ');
  const who = sale.debtor
    ? { kind: sale.debtor.kind, name: sale.debtor.name ?? '', phone: sale.debtor.phone ?? null }
    : sale.customer
      ? { kind: 'customer' as const, name: sale.customer.name ?? '', phone: sale.customer.phone }
      : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {isFresh(recordedAt) ? <InlineNotice tone="success">{t('recordPayment.done')}</InlineNotice> : null}

      {/* The phone: what was sold, which exact one, and where the sale stands. */}
      <Card style={styles.phone}>
        <View style={styles.phoneHead}>
          <Thumbnail size="lg" />
          <View style={styles.grow}>
            <Text variant="heading">{first?.product ?? t('saleRow.noProduct', { invoice: sale.invoiceNo })}</Text>
            <Text variant="caption" tone="secondary">
              {t('sales.invoice', { no: sale.invoiceNo })}
            </Text>
          </View>
          {/* Every state is said, "Paid in full" included: the status comes from
              the money received, and a paid sale is an answer worth showing. */}
          <StatusChip domain="sale" value={sale.payStatus} />
        </View>
        {sale.lines.map((line) => (
          <Line key={line.id} line={line} alone={sale.lines.length === 1} />
        ))}
        {sale.isReversed ? (
          <Text variant="caption" tone="secondary">
            {t('sales.detail.reversedNotice')}
          </Text>
        ) : null}
      </Card>

      <Card variant="accent">
        <Text variant="body" tone="secondary">
          {t('saleDetail.sellingPrice')}
        </Text>
        <MoneyValue value={sale.total} size="display" />
      </Card>

      {/* How it was paid, when, by whom. What was RECEIVED and what is OWED are
          different questions, and a counter that conflates them eventually
          hands back the wrong change. */}
      <Card>
        <Fact label={t('saleDetail.paymentMethod')} value={where || '—'} />
        <Fact label={sale.balanceDue > 0 ? t('saleDetail.received') : t('saleDetail.amountReceived')} money={sale.amountPaid} />
        {sale.balanceDue > 0 ? <Fact label={t('saleDetail.owed')} money={sale.balanceDue} strong /> : null}
        <Fact label={t('saleDetail.soldOn')} value={formatDateTime(new Date(sale.soldAt))} />
        {sale.soldBy ? <Fact label={t('saleDetail.soldBy')} value={sale.soldBy} /> : null}
      </Card>

      {/* Who bought it, or who owes the balance — a customer or a partner store,
          one row either way, because "who do I chase?" is one question. */}
      {who ? (
        <ListRow
          leading={who.kind === 'store' ? Store : UserRound}
          title={who.name}
          subtitle={who.phone ?? t(who.kind === 'store' ? 'saleDetail.debtor.store' : 'saleDetail.debtor.customer')}
          chevron={false}
        />
      ) : null}

      {/* Payments are records too — one per tender — so they group. */}
      <Section title={t('saleDetail.history')}>
        {sale.payments.length > 0 ? (
          <RowGroup separatorInset={space.md}>
            {sale.payments.map((p) => (
              <View key={p.id} style={styles.groupedRow}>
                <PaymentLine payment={p} />
              </View>
            ))}
          </RowGroup>
        ) : null}
        {canCollect ? (
          <Button
            title={t(sale.payments.some((p) => p.kind === 'collection') ? 'saleDetail.recordAnother' : 'saleDetail.recordPayment')}
            fullWidth
            onPress={() => router.push(`/sales/pay/${sale.id}` as Href)}
          />
        ) : null}
        <Text variant="caption" tone="tertiary">
          {t('saleDetail.linked')}
        </Text>
      </Section>

      {/* The return answer: the customer standing there is asking it. */}
      <Card>
        <View style={styles.policyHead}>
          <Text variant="label" tone="secondary">
            {t('returns.policy.title')}
          </Text>
          <Chip label={status.label} tone={status.tone} size="sm" />
        </View>
        <Text variant="body">
          {sale.returnPolicy.windowHours > 0 ? describeWindow(sale.returnPolicy.windowHours, t) : t('returns.window.none')}
        </Text>
        {status.detail ? (
          <Text variant="caption" tone="secondary">
            {status.detail}
          </Text>
        ) : null}
        {/* Who decided this sale was different, and why. Shown only when
            somebody actually changed it. */}
        {sale.returnPolicy.overriddenBy ? (
          <Text variant="caption" tone="tertiary" style={styles.notice}>
            {t('returns.policy.changedBy', { name: sale.returnPolicy.overriddenBy })}
            {sale.returnPolicy.overrideReason ? ` — ${sale.returnPolicy.overrideReason}` : ''}
          </Text>
        ) : null}
      </Card>

      <Section title={t('sales.detail.totals')}>
        <Card>
          {sale.discount > 0 ? (
            <>
              <Amount label={t('sales.detail.subtotal')} value={sale.subtotal} />
              <Amount label={t('sales.detail.discount')} value={-sale.discount} />
            </>
          ) : null}
          <Amount label={t('saleDetail.total')} value={sale.total} strong />
          <Amount label={t('saleDetail.received')} value={sale.amountPaid} />
          {sale.balanceDue > 0 ? <Amount label={t('saleDetail.owed')} value={sale.balanceDue} strong /> : null}
          {/* Absent for a caller without `cost.view` — the server never sent
              them, so there is nothing to hide here. */}
          {sale.totalCost !== undefined ? <Amount label={t('sales.detail.cost')} value={sale.totalCost} /> : null}
          {sale.margin !== undefined ? <Amount label={t('sales.detail.margin')} value={sale.margin} strong /> : null}
        </Card>
      </Section>

      {/* The customer's copy, for warranty and ownership: the exact phone and
          what was paid, and never cost or margin. No share sheet on web. */}
      {canShareReceipt() ? (
        <Button title={t('saleDetail.viewReceipt')} variant="secondary" icon={FileText} fullWidth loading={sharing} onPress={() => void share()} />
      ) : null}
    </ScrollView>
  );
}

/**
 * The customer's invoice for a past sale, from the sale the server holds —
 * everything on it is a confirmed figure: what was sold and to whom, what was
 * paid by which method and when, and who owes the rest. Never cost or margin;
 * `ReceiptData` has no field for either.
 */
function receiptOf(sale: SaleDetail, t: ReturnType<typeof useTranslation>['t'], storeName: string | null): ReceiptData {
  return {
    invoiceNo: sale.invoiceNo,
    soldAt: new Date(sale.soldAt),
    storeName,
    branchName: sale.branch.name,
    cashierName: sale.soldBy ?? '',
    customer: sale.customer?.name ? { name: sale.customer.name, phone: sale.customer.phone } : null,
    lines: sale.lines
      .filter((l) => !l.voided)
      .map((l) => ({ label: l.product ?? '', identifier: l.imei ?? l.serialNo ?? null, quantity: l.quantity, unitPrice: l.price })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    amountPaid: sale.amountPaid,
    balanceDue: sale.balanceDue,
    // The server's `credit` is a sale nothing has been paid on yet.
    payStatus: sale.payStatus === 'credit' ? 'unpaid' : sale.payStatus,
    payments: sale.payments.map((p) => ({
      method: t(`payment.${p.method}` as never),
      account: p.accountLabel,
      amount: p.amount,
      kind: p.kind,
      paidAt: new Date(p.paidAt),
    })),
    debtor:
      sale.balanceDue > 0 && sale.debtor?.name
        ? { kind: sale.debtor.kind === 'store' ? 'store' : 'customer', name: sale.debtor.name, phone: sale.debtor.phone }
        : null,
    returnPolicy: { windowHours: sale.returnPolicy.windowHours, deadlineAt: sale.returnPolicy.deadlineAt },
  };
}

/** One sold item. For a one-phone sale only the identifier and its actions — the name is the heading above. */
function Line({ line, alone }: { line: SaleLine; alone: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const canRequestReturn = usePermission('return.request');
  const identifier = line.imei ?? line.serialNo ?? line.barcode;
  /**
   * Only a serialized line can be returned in I2. An accessory line has no unit
   * to present, and inventing an independent quantity return here would be
   * exactly the behaviour `docs/27` §16.4 says cannot be inferred.
   */
  const returnable = Boolean(line.unitId) && !line.voided;

  return (
    <View style={styles.line}>
      {!alone ? (
        <View style={styles.lineHead}>
          <Text variant="body" style={styles.lineName}>
            {line.product ?? ''}
          </Text>
          <Text variant="bodyStrong">{formatMoney(line.price * line.quantity)}</Text>
        </View>
      ) : null}
      <View style={styles.lineMeta}>
        {identifier ? (
          <>
            <Text variant="caption" tone="secondary">
              {line.imei ? t('saleDetail.imei') : line.serialNo ? t('saleDetail.serial') : t('saleDetail.barcode')}
            </Text>
            {/* The number printed on the thing, in LTR even in Arabic — it is a
                code, not a sentence. Shown in full: this is the record staff
                match the handset against. */}
            <Identifier tone="primary">{identifier}</Identifier>
          </>
        ) : null}
        {line.quantity > 1 ? (
          <Text variant="caption" tone="secondary">
            {t('sales.detail.quantity', { count: line.quantity })}
          </Text>
        ) : null}
        {line.voided ? <Chip label={t('sales.detail.voidedLine')} tone="neutral" size="sm" /> : null}
      </View>
      {canRequestReturn && returnable ? (
        <Button
          title={t('sales.detail.requestReturn')}
          variant="tertiary"
          size="sm"
          onPress={() =>
            router.push({
              pathname: '/returns/new',
              params: {
                saleItemId: line.id,
                identifier: identifier ?? '',
                product: line.product ?? '',
              },
            } as never)
          }
        />
      ) : null}
    </View>
  );
}

/**
 * One payment, as it happened: how much, when, into what — by the label the
 * account had THEN — whether it came with the sale or later, the reference if
 * one was given, and who recorded it. Renaming or closing an account later
 * changes none of this.
 */
function PaymentLine({ payment: p }: { payment: SalePaymentRecord }) {
  const { t } = useTranslation();
  const via = p.method === 'cash' ? t('payment.cash') : (p.accountLabel ?? t(`payment.${p.method}` as never));
  return (
    <View style={styles.payment}>
      <View style={styles.amountRow}>
        <Text variant="bodyStrong" style={styles.lineName}>
          {`${formatDateTime(new Date(p.paidAt))} · ${via}`}
        </Text>
        <Text variant="bodyStrong">{formatMoney(p.amount)}</Text>
      </View>
      <Text variant="caption" tone="secondary">
        {t(p.kind === 'collection' ? 'saleDetail.history.collected' : 'saleDetail.history.atSale')}
        {p.recordedBy ? ` · ${t('saleDetail.history.by', { name: p.recordedBy })}` : ''}
      </Text>
      {p.reference ? (
        <Text variant="caption" tone="secondary">
          {t('saleDetail.history.ref', { reference: p.reference })}
        </Text>
      ) : null}
      {p.note ? (
        <Text variant="caption" tone="secondary">
          {p.note}
        </Text>
      ) : null}
    </View>
  );
}

/** A fact about the sale: its label, and its value in words or money. */
function Fact({ label, value, money, strong }: { label: string; value?: string; money?: number; strong?: boolean }) {
  return (
    <View style={styles.amountRow}>
      <Text variant="body" tone="secondary" style={styles.factLabel}>
        {label}
      </Text>
      {money !== undefined ? (
        <MoneyValue value={money} size={strong ? 'default' : 'small'} />
      ) : (
        <Text variant="bodyStrong" align="end" style={styles.factValue}>
          {value}
        </Text>
      )}
    </View>
  );
}

function Amount({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.amountRow}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'primary' : 'secondary'}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'body'}>{formatMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  padded: { padding: space.base },
  /** Padding for a bespoke row placed inside a RowGroup, which has none. */
  groupedRow: { padding: space.md, gap: 2 },
  content: { padding: space.base, paddingBottom: space['3xl'], gap: space.base },
  phone: { gap: space.md },
  phoneHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
  notice: { marginTop: space.xs },
  policyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
    gap: space.sm,
  },
  line: { gap: space.xs },
  lineHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  lineName: { flexShrink: 1 },
  lineMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs, gap: space.sm },
  factLabel: { flexShrink: 0 },
  factValue: { flex: 1 },
  payment: { gap: 2 },
});
