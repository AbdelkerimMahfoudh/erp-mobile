import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ScanLine, Trash2 } from 'lucide-react-native';
import { Button, EmptyState, MoneyField, Screen, Text } from '../../components/ui';
import { ProductConfirmationCard } from '../../components/product';
import { ScanTarget } from '../../components/scanner';
import { BottomSheet } from '../../components/overlay';
import { CartLineRow } from '../../components/sell/CartLineRow';
import { PaymentSheet } from '../../components/sell/PaymentSheet';
import { SaleSuccess } from '../../components/sell/SaleSuccess';
import { cartCost, cartSubtotal, type CartLine, type PaymentEntry } from '../../components/sell/types';
import { api, ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import type { ReceiptData } from '../../lib/receipt';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import { useAuth } from '../../hooks/useAuth';
import type { ProductSuggestion, ScanResult, Unit } from '../../types/api';

/**
 * Sell — the fastest screen in the app.
 *
 * Target flow, per the master spec: scan → item appears → scan next → repeat →
 * choose payment → done. A recognized, in-stock, priced item joins the sale
 * immediately with a haptic and a toast; the confirmation card appears only
 * when a human actually has to decide something. That is what keeps a standard
 * sale at two taps.
 *
 * Every code still goes through `POST /scan` so recognition keeps learning,
 * with `GET /units/:identifier` fired in parallel for the authoritative stock
 * check — they are independent lookups, and this is the one screen where a
 * round trip is worth avoiding.
 */

interface SaleResponse {
  id: string;
  invoiceNo: string;
  total: number;
  /** Absent without `cost.view`. */
  margin?: number;
  balanceDue: number;
  payStatus: string;
}

/** A scan that needs the employee to decide something before it joins the sale. */
interface PendingScan {
  result: ScanResult;
  unit: Unit | null;
  suggestion: ProductSuggestion | null;
  notice?: { tone: 'warning' | 'danger'; message: string };
  needsPrice: boolean;
}

export default function SellScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [pendingPrice, setPendingPrice] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ sale: SaleResponse; receipt: ReceiptData } | null>(null);

  /**
   * One idempotency key per sale, not per attempt.
   *
   * Generating it inside the request meant a retry after a timeout looked like
   * a brand-new sale to the server — exactly what the key exists to prevent,
   * and a double charge in the worst case.
   */
  const clientUuid = useRef(uuidv4());
  /** Unit lookups started the moment a code is captured, keyed by code. */
  const unitLookups = useRef(new Map<string, Promise<Unit | null>>());

  const subtotal = cartSubtotal(lines);
  const total = Math.max(0, subtotal - discount);
  const totalCost = cartCost(lines);

  // ── Scanning ──────────────────────────────────────────────────────────────

  const onCodeCaptured = useCallback((code: string) => {
    if (unitLookups.current.has(code)) return;
    unitLookups.current.set(
      code,
      api.get<Unit>(`/units/${encodeURIComponent(code)}`).catch(() => null),
    );
  }, []);

  const addLine = useCallback((line: CartLine) => {
    setLines((prev) => [...prev, line]);
    toast.success(line.label);
  }, []);

  const onScanResult = useCallback(
    async (result: ScanResult) => {
      const unit = (await unitLookups.current.get(result.code)) ?? null;
      unitLookups.current.delete(result.code);
      const suggestion = result.suggestion;

      // ── Serialized: one specific physical unit ──
      if (unit) {
        const identifier = unit.imeiPrimary ?? unit.serialNo ?? result.code;

        if (lines.some((line) => line.identifier === identifier)) {
          toast.error(t('sell.alreadyInCart'));
          return;
        }

        if (unit.status !== 'in_stock') {
          setPending({
            result,
            unit,
            suggestion,
            notice: { tone: 'danger', message: t(`status.unit.${unit.status}` as never) },
            needsPrice: false,
          });
          return;
        }

        const price = unit.product?.defaultPrice ?? suggestion?.defaultPrice ?? null;
        const label = unit.product
          ? `${unit.product.brand} ${unit.product.model}`
          : suggestion
            ? `${suggestion.brand} ${suggestion.model}`
            : identifier;

        if (price === null) {
          setPendingPrice('');
          setPending({ result, unit, suggestion, needsPrice: true });
          return;
        }

        addLine({
          key: uuidv4(),
          kind: 'unit',
          identifier,
          label,
          variant: unit.product?.variant ?? suggestion?.variant ?? null,
          trackingType: unit.product?.trackingType ?? (unit.imeiPrimary ? 'imei' : 'serial'),
          quantity: 1,
          price,
          cost: unit.cost,
        });
        return;
      }

      // ── Quantity: accessories, counted rather than serialized ──
      if (suggestion?.trackingType === 'quantity') {
        const existing = lines.find((line) => line.productId === suggestion.productId);
        if (existing) {
          setLines((prev) =>
            prev.map((line) =>
              line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line,
            ),
          );
          toast.success(existing.label);
          return;
        }

        if (suggestion.defaultPrice === null) {
          setPendingPrice('');
          setPending({ result, unit: null, suggestion, needsPrice: true });
          return;
        }

        addLine({
          key: uuidv4(),
          kind: 'quantity',
          productId: suggestion.productId,
          label: `${suggestion.brand} ${suggestion.model}`,
          variant: suggestion.variant,
          trackingType: 'quantity',
          quantity: 1,
          price: suggestion.defaultPrice,
        });
        return;
      }

      // ── Nothing sellable: a known product with no unit here, or an unknown code ──
      setPending({
        result,
        unit: null,
        suggestion,
        notice: { tone: 'danger', message: t('state.error.notFound.title') },
        needsPrice: false,
      });
    },
    [addLine, lines, t],
  );

  const confirmPending = () => {
    if (!pending) return;
    const price = Number(pendingPrice);
    if (!price || price <= 0) return;

    const { unit, suggestion, result } = pending;
    if (unit) {
      const identifier = unit.imeiPrimary ?? unit.serialNo ?? result.code;
      addLine({
        key: uuidv4(),
        kind: 'unit',
        identifier,
        label: unit.product
          ? `${unit.product.brand} ${unit.product.model}`
          : suggestion
            ? `${suggestion.brand} ${suggestion.model}`
            : identifier,
        variant: unit.product?.variant ?? suggestion?.variant ?? null,
        trackingType: unit.product?.trackingType ?? (unit.imeiPrimary ? 'imei' : 'serial'),
        quantity: 1,
        price,
        cost: unit.cost,
      });
    } else if (suggestion) {
      addLine({
        key: uuidv4(),
        kind: 'quantity',
        productId: suggestion.productId,
        label: `${suggestion.brand} ${suggestion.model}`,
        variant: suggestion.variant,
        trackingType: 'quantity',
        quantity: 1,
        price,
      });
    }
    setPending(null);
  };

  // ── Cart editing ──────────────────────────────────────────────────────────

  const setPrice = (key: string, price: number) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, price } : l)));

  const setQuantity = (key: string, quantity: number) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)));

  const removeLine = (key: string) => {
    const removed = lines.find((l) => l.key === key);
    setLines((prev) => prev.filter((l) => l.key !== key));
    // Undo rather than a confirmation dialog — removing a line is trivially
    // reversible and the counter should keep moving.
    if (removed) {
      toast.success(removed.label, {
        action: {
          label: t('action.undo'),
          onPress: () => setLines((prev) => [...prev, removed]),
        },
      });
    }
  };

  const clearSale = async () => {
    const ok = await dialog.confirm({
      title: t('sell.clear.confirm'),
      message: t('sell.clear.body'),
      confirmLabel: t('sell.clear'),
      tone: 'danger',
    });
    if (!ok) return;
    setLines([]);
    setDiscount(0);
  };

  // ── Checkout ──────────────────────────────────────────────────────────────

  const finalize = (sale: SaleResponse, payments: PaymentEntry[]) => {
    const receipt: ReceiptData = {
      invoiceNo: sale.invoiceNo,
      soldAt: new Date(),
      branchName: branchName ?? '',
      cashierName: user?.name ?? '',
      lines: lines.map((line) => ({
        label: line.label,
        identifier: line.identifier,
        quantity: line.quantity,
        unitPrice: line.price,
      })),
      subtotal,
      discount,
      total: sale.total,
      payments: payments.map((p) => ({
        method: t(`payment.${p.method}` as never),
        amount: p.amount,
      })),
    };

    setDone({ sale, receipt });
    setPaymentOpen(false);
    setLines([]);
    setDiscount(0);
    qc.invalidateQueries({ queryKey: qk.home(branchId) });
    qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
  };

  const attempt = async (payments: PaymentEntry[], overrideReason?: string): Promise<void> => {
    try {
      const sale = await api.post<SaleResponse>('/sales', {
        clientUuid: clientUuid.current,
        lines: lines.map((line) =>
          line.kind === 'unit'
            ? { identifier: line.identifier, price: line.price }
            : { productId: line.productId, quantity: line.quantity, price: line.price },
        ),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
        ...(discount > 0 ? { saleDiscount: discount } : {}),
        ...(overrideReason ? { overrideReason } : {}),
      });
      finalize(sale, payments);
    } catch (e) {
      if (e instanceof ApiError) {
        // This role cannot authorise a below-cost sale at all. Say so plainly:
        // there is no in-app approval flow, so a manager has to do it.
        if (e.status === 403 && /discount\.override/i.test(e.message)) {
          await dialog.alert({
            title: t('sell.belowCost.title'),
            message: t('sell.belowCost.needsManager'),
          });
          return;
        }
        // The server saw below-cost that we could not (cost hidden from us).
        if (e.status === 400 && /reason/i.test(e.message) && !overrideReason) {
          const { confirmed, reason } = await dialog.confirmWithReason({
            title: t('sell.belowCost.title'),
            message: e.message,
            confirmLabel: t('sell.belowCost.confirm'),
            reasonLabel: t('sell.belowCost.reason'),
            reasonPlaceholder: t('sell.belowCost.reasonPlaceholder'),
            tone: 'danger',
          });
          if (confirmed) await attempt(payments, reason);
          return;
        }
      }
      toast.error(toErrorMessage(e));
    }
  };

  const onComplete = async (payments: PaymentEntry[]) => {
    setSubmitting(true);
    try {
      let overrideReason: string | undefined;

      // Warn before sending when we can actually see cost. Without `cost.view`
      // the server catches it instead and `attempt` handles the rejection.
      if (totalCost !== undefined && total < totalCost) {
        const { confirmed, reason } = await dialog.confirmWithReason({
          title: t('sell.belowCost.title'),
          message: t('sell.belowCost.body', { amount: formatMoney(totalCost - total) }),
          confirmLabel: t('sell.belowCost.confirm'),
          reasonLabel: t('sell.belowCost.reason'),
          reasonPlaceholder: t('sell.belowCost.reasonPlaceholder'),
          tone: 'danger',
        });
        if (!confirmed) return;
        overrideReason = reason;
      }

      await attempt(payments, overrideReason);
    } finally {
      setSubmitting(false);
    }
  };

  const startNewSale = () => {
    clientUuid.current = uuidv4();
    setDone(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (done) {
    return (
      <Screen scroll={false} padded={false}>
        <SaleSuccess
          invoiceNo={done.sale.invoiceNo}
          total={done.sale.total}
          margin={done.sale.margin}
          receipt={done.receipt}
          onNewSale={startNewSale}
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen
        scroll={false}
        padded={false}
        header={
          <>
            <View style={styles.titleRow}>
              <Text variant="title">{t('sell.title')}</Text>
              {lines.length > 0 ? (
                <Button
                  title={t('sell.clear')}
                  variant="tertiary"
                  size="sm"
                  icon={Trash2}
                  onPress={clearSale}
                />
              ) : null}
            </View>
            <ScanTarget
              onResult={onScanResult}
              onCodeCaptured={onCodeCaptured}
              placeholder={t('sell.scan.placeholder')}
              autoFocus
            />
          </>
        }
        footer={
          lines.length > 0 ? (
            <>
              <View style={styles.totals}>
                <Text variant="body" tone="secondary">
                  {t('sell.cart.count', { count: lines.length })}
                </Text>
                <Text variant="title">{formatMoney(total)}</Text>
              </View>
              <Button
                title={t('sell.charge', { amount: formatMoney(total) })}
                size="lg"
                fullWidth
                onPress={() => setPaymentOpen(true)}
              />
            </>
          ) : undefined
        }
      >
        {lines.length === 0 ? (
          <EmptyState icon={ScanLine} title={t('sell.empty.title')} body={t('sell.empty.body')} />
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {lines.map((line) => (
              <CartLineRow
                key={line.key}
                line={line}
                onPriceChange={setPrice}
                onQuantityChange={setQuantity}
                onRemove={removeLine}
              />
            ))}
          </ScrollView>
        )}
      </Screen>

      {/* Only appears when a scan needs a decision. */}
      <BottomSheet open={Boolean(pending)} onClose={() => setPending(null)} padded={false}>
        {pending ? (
          <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
            <ProductConfirmationCard
              result={pending.result}
              context="sell"
              confirmLabel={t('sell.addToSale')}
              notice={pending.notice}
              confirmDisabled={pending.needsPrice && !(Number(pendingPrice) > 0)}
              onConfirm={confirmPending}
              onScanAgain={() => setPending(null)}
            >
              {pending.needsPrice ? (
                <MoneyField
                  label={t('receipt.price')}
                  hint={t('sell.priceRequired')}
                  value={pendingPrice}
                  onChangeText={setPendingPrice}
                  autoFocus
                  required
                />
              ) : null}
            </ProductConfirmationCard>
          </ScrollView>
        ) : null}
      </BottomSheet>

      <PaymentSheet
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        total={total}
        discount={discount}
        onDiscountChange={setDiscount}
        onComplete={onComplete}
        submitting={submitting}
      />
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  list: {
    padding: space.base,
    gap: space.sm,
    paddingBottom: space['3xl'],
  },
  totals: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  sheet: {
    padding: space.base,
  },
});
