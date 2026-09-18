import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Identifier,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  StatusChip,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { describeWindow, policyStatus } from '../../lib/return-policy';
import { useSale } from '../../lib/sales';
import type { SaleDetail, SaleLine, SalePaymentRecord } from '../../types/api';

/**
 * One sale, in full.
 *
 * Opened for three reasons, in this order of frequency: what was sold, what is
 * still owed, and whether it can still come back. The return policy is at the
 * top for the third — it is the question a customer is standing there asking,
 * and the answer is the server's, computed from the policy this sale was sold
 * under rather than whatever the shop offers today.
 *
 * Cost and profit appear only when the server sends them. Nothing is hidden
 * here: `cost.view` is enforced by the gating interceptor, so an employee's
 * response simply has no such fields.
 */
export default function SaleDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSale(id);

  const title = query.data ? t('sales.invoice', { no: query.data.invoiceNo }) : t('sales.detail.title');

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ headerShown: true, title }} />

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

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.headRow}>
          <Text variant="display">{formatMoney(sale.total)}</Text>
          {/* Every state is said, "Paid in full" included: the status comes from
              the money received, and a paid sale is an answer worth showing. */}
          <StatusChip domain="sale" value={sale.payStatus} />
        </View>
        <Text variant="caption" tone="secondary">
          {formatDateTime(new Date(sale.soldAt))}
          {sale.soldBy ? ` · ${t('sales.detail.soldBy', { name: sale.soldBy })}` : ''}
        </Text>
        {sale.isReversed ? (
          <Text variant="caption" tone="secondary" style={styles.notice}>
            {t('sales.detail.reversedNotice')}
          </Text>
        ) : null}
      </Card>

      {/* The return answer, near the top: it is why most people open this. */}
      <Card>
        <View style={styles.policyHead}>
          <Text variant="label" tone="secondary">
            {t('returns.policy.title')}
          </Text>
          <Chip label={status.label} tone={status.tone} size="sm" />
        </View>
        <Text variant="body">
          {sale.returnPolicy.windowHours > 0
            ? describeWindow(sale.returnPolicy.windowHours, t)
            : t('returns.window.none')}
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

      {/* Who owes the balance — a customer or a partner store, one section
          either way, because "who do I chase?" is one question. */}
      {sale.debtor ? (
        <Section title={t(sale.debtor.kind === 'store' ? 'saleDetail.debtor.store' : 'saleDetail.debtor.customer')}>
          <RowGroup separatorInset={space.md}>
            <View style={styles.groupedRow}>
              <Text variant="bodyStrong">{sale.debtor.name ?? ''}</Text>
              {sale.debtor.phone ? (
                <Text variant="caption" tone="secondary">
                  {sale.debtor.phone}
                </Text>
              ) : null}
            </View>
          </RowGroup>
        </Section>
      ) : null}

      {/*
        The sold items — repeated records of the same kind, so one grouped
        surface with hairlines between them. They previously shared a single
        card and were separated by a margin, which read as one long block of
        text with no boundary between one phone and the next.
      */}
      <Section title={t('sales.detail.lines')}>
        <RowGroup separatorInset={space.md}>
          {sale.lines.map((line) => (
            <View key={line.id} style={styles.groupedRow}>
              <Line line={line} />
            </View>
          ))}
        </RowGroup>
      </Section>

      <Section title={t('sales.detail.totals')}>
        <Card>
          <Amount label={t('sales.detail.subtotal')} value={sale.subtotal} />
          {sale.discount > 0 ? (
            <Amount label={t('sales.detail.discount')} value={-sale.discount} />
          ) : null}
          <Amount label={t('saleDetail.total')} value={sale.total} strong />
          <Amount label={t('saleDetail.received')} value={sale.amountPaid} />
          {sale.balanceDue > 0 ? (
            <Amount label={t('saleDetail.owed')} value={sale.balanceDue} strong />
          ) : null}
          {/* Absent for a caller without `cost.view` — the server never sent
              them, so there is nothing to hide here. */}
          {sale.totalCost !== undefined ? (
            <Amount label={t('sales.detail.cost')} value={sale.totalCost} />
          ) : null}
          {sale.margin !== undefined ? (
            <Amount label={t('sales.detail.margin')} value={sale.margin} strong />
          ) : null}
        </Card>
      </Section>

      {/*
        Payments are records too — one per tender — so they group the same way.
        Kept apart from the totals above on purpose: what was RECEIVED and what
        is OWED are different questions, and a counter that conflates them
        eventually hands back the wrong change.
      */}
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
    </ScrollView>
  );
}

function Line({ line }: { line: SaleLine }) {
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
    <View>
      <View style={styles.lineHead}>
        <Text variant="body" style={styles.lineName}>
          {line.product ?? ''}
        </Text>
        <Text variant="bodyStrong">{formatMoney(line.price * line.quantity)}</Text>
      </View>
      <View style={styles.lineMeta}>
        {/* The number printed on the thing, in LTR even in Arabic — it is a
            code, not a sentence. */}
        {identifier ? <Identifier>{identifier}</Identifier> : null}
        {line.quantity > 1 ? (
          <Text variant="caption" tone="secondary">
            {t('sales.detail.quantity', { count: line.quantity })}
          </Text>
        ) : null}
        {line.voided ? (
          <Chip label={t('sales.detail.voidedLine')} tone="neutral" size="sm" />
        ) : null}
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
      <View style={styles.hiddenAnchor}>
      </View>
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
          {via}
        </Text>
        <Text variant="bodyStrong">{formatMoney(p.amount)}</Text>
      </View>
      <Text variant="caption" tone="secondary">
        {formatDateTime(new Date(p.paidAt))} · {t(p.kind === 'collection' ? 'saleDetail.history.collected' : 'saleDetail.history.atSale')}
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
      {p.recordedBy ? (
        <Text variant="caption" tone="tertiary">
          {t('saleDetail.history.by', { name: p.recordedBy })}
        </Text>
      ) : null}
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
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  notice: { marginTop: space.xs },
  policyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
    gap: space.sm,
  },
  lineHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  lineName: { flexShrink: 1 },
  hiddenAnchor: { height: 0 },
  lineMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.xs, gap: space.sm },
  payment: { gap: 2 },
});
