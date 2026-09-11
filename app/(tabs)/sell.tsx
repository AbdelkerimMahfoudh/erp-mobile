import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ScanLine, Trash2 } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  InlineNotice,
  MoneyField,
  MoneyValue,
  Screen,
  Text,
} from '../../components/ui';
import { ProductConfirmationCard } from '../../components/product';
import { ScanTarget } from '../../components/scanner';
import { BottomSheet } from '../../components/overlay';
import { CartLineRow } from '../../components/sell/CartLineRow';
import { PaymentSheet } from '../../components/sell/PaymentSheet';
import { SaleSuccess } from '../../components/sell/SaleSuccess';
import {
  ApprovalRequestSheet,
  type ApprovalRequest,
} from '../../components/sell/ApprovalRequestSheet';
import { cartCost, cartSubtotal, type CartLine, type PaymentEntry } from '../../components/sell/types';
import { api, ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { useConnectivity } from '../../lib/connectivity';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { qk } from '../../lib/query-keys';
import type { ReceiptData } from '../../lib/receipt';
import type { ReturnPolicySnapshot } from '../../lib/return-policy';
import { usePermission } from '../../lib/permissions';
import { useDraft } from '../../lib/offline/use-draft';
import { useCompanyReturnWindow } from '../../lib/sales';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import { refusalOf } from '../../lib/discount-approval-state';
import {
  isWarningsPending,
  orderWarnings,
  referenceKey,
  type WarningsPending,
} from '../../lib/warnings';
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
  /**
   * The server's own timestamp for the sale, and the policy it snapshotted
   * from it. Both come from the server deliberately: the receipt used to date
   * itself from the phone's clock, and the deadline a customer is promised must
   * not be measured from a different machine than the sale it belongs to.
   */
  soldAt: string;
  returnPolicy: ReturnPolicySnapshot;
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

  /**
   * The cart survives an app kill (Milestone J).
   *
   * Android evicts backgrounded apps on the cheap handsets this product is
   * for, and losing two minutes of scanning to that is exactly the kind of
   * thing that sends somebody back to the notebook. What is preserved is the
   * CART only — it is not a sale, nothing is reserved by it, and Charge stays
   * shut until the server can answer.
   */
  const cartDraft = useDraft<CartLine[]>('sell.cart', lines, setLines);
  const [discount, setDiscount] = useState(0);
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [pendingPrice, setPendingPrice] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);

  /**
   * The return policy for THIS sale. It starts as the shop's, and only a
   * manager or owner can move it — the server refuses anything else, so the
   * screen just does not offer it.
   */
  const companyDefaultHours = useCompanyReturnWindow();
  const canOverrideReturnPolicy = usePermission('return.policy.override');
  const [returnWindowHours, setReturnWindowHours] = useState<number | null>(null);
  const [returnPolicyReason, setReturnPolicyReason] = useState('');
  const effectiveWindowHours = returnWindowHours ?? companyDefaultHours;
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

  /**
   * The Owner approval this sale is waiting on, if the server asked for one.
   *
   * Set only from the server's own `approval_required` refusal — the phone never
   * decides that a price is below the floor, because the floor is the pricing
   * ladder's answer and only the server resolves it.
   */
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  /** The payments the sale was about to be charged with, held across the ask. */
  const heldPayments = useRef<PaymentEntry[] | null>(null);

  const subtotal = cartSubtotal(lines);
  const total = Math.max(0, subtotal - discount);
  const totalCost = cartCost(lines);
  /**
   * Only knowable when every line's cost came back — the server strips cost
   * without `cost.view`, and `cartCost` returns undefined rather than guessing.
   * A cashier who cannot see cost simply gets no warning here; the server still
   * refuses the sale without an override.
   */
  const belowCost = totalCost !== undefined && total < totalCost;
  const offline = !useConnectivity((s) => s.online);

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
    cartDraft.clear();
  };

  // ── Checkout ──────────────────────────────────────────────────────────────

  const finalize = (sale: SaleResponse, payments: PaymentEntry[]) => {
    const receipt: ReceiptData = {
      invoiceNo: sale.invoiceNo,
      soldAt: new Date(sale.soldAt),
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
      returnPolicy: sale.returnPolicy,
    };

    setDone({ sale, receipt });
    setPaymentOpen(false);
    setLines([]);
    setDiscount(0);
    // The sale reached the server, so the draft has done its job.
    cartDraft.clear();
    // A policy chosen for one customer must never carry into the next.
    setReturnWindowHours(null);
    setReturnPolicyReason('');
    qc.invalidateQueries({ queryKey: qk.home(branchId) });
    qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
    // The Stock screen's per-variant counts move with every sale and delivery.
    qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
  };

  /**
   * Ask the server to make the sale, and answer whatever it says back.
   *
   * Three outcomes, and only one of them is an error:
   *
   * - **A sale.** Done.
   * - **`warnings_pending`.** The server changed nothing and wants the person
   *   to confirm what they typed. The same request goes back carrying the token
   *   it issued — bound to this exact payload and these exact warnings, so a
   *   changed price cannot reuse an old confirmation.
   * - **A refusal with a code.** Every branch below reads `e.code`, never the
   *   message. The app runs in three languages and a regular expression over an
   *   English sentence works in exactly one of them.
   */
  const attempt = async (
    payments: PaymentEntry[],
    options: { overrideReason?: string; acknowledgementToken?: string } = {},
  ): Promise<void> => {
    try {
      const response = await api.post<SaleResponse | WarningsPending>('/sales', {
        clientUuid: clientUuid.current,
        lines: lines.map((line) =>
          line.kind === 'unit'
            ? { identifier: line.identifier, price: line.price }
            : { productId: line.productId, quantity: line.quantity, price: line.price },
        ),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
        ...(discount > 0 ? { saleDiscount: discount } : {}),
        ...(options.overrideReason ? { overrideReason: options.overrideReason } : {}),
        // Omitted for an ordinary sale: re-stating the default is not an
        // override, and sending a value the shop may have changed since this
        // screen loaded would look like one.
        ...(effectiveWindowHours !== companyDefaultHours
          ? { returnWindowHours: effectiveWindowHours, returnPolicyReason: returnPolicyReason.trim() }
          : {}),
        ...(options.acknowledgementToken
          ? { acknowledgementToken: options.acknowledgementToken }
          : {}),
      });

      if (isWarningsPending(response)) {
        /*
         * Nothing was saved. The server found something worth a second look and
         * is asking once — it is advisory, so answering yes lets it straight
         * through, and answering no leaves the sale exactly as it was.
         */
        const confirmed = await confirmWarnings(response);
        if (!confirmed) return;
        await attempt(payments, {
          ...options,
          acknowledgementToken: response.acknowledgementToken,
        });
        return;
      }

      finalize(response, payments);
    } catch (e) {
      if (e instanceof ApiError) {
        switch (refusalOf(e.code)) {
          case 'approval_required': {
            /*
             * Below the set price. The refusal names the line, the unit and the
             * price the shop actually set, so the sheet can ask about the right
             * phone instead of making the seller work out which one.
             */
            const body = (e.body ?? {}) as {
              belowCost?: boolean;
              configuredPrice?: number | null;
              lineIndex?: number | null;
              unitId?: string | null;
              identifier?: string | null;
            };
            const line =
              typeof body.lineIndex === 'number' ? lines[body.lineIndex] : undefined;
            if (!body.unitId) {
              // A quantity line has no single thing to hold an approval, so
              // there is nothing to ask for. Say what the server said.
              toast.error(toErrorMessage(e));
              return;
            }
            heldPayments.current = payments;
            setApprovalRequest({
              unitId: body.unitId,
              label: line?.label ?? body.identifier ?? t('approvals.item'),
              identifier: body.identifier ?? line?.identifier ?? null,
              configuredPrice: body.configuredPrice ?? null,
              proposedPrice: line?.price ?? 0,
              belowCost: Boolean(body.belowCost),
            });
            return;
          }
          case 'approval_price_changed':
            toast.warning(t('sell.approval.priceChanged'));
            return;
          case 'approval_expired':
            toast.warning(t('sell.approval.expired'));
            return;
          case 'approval_already_used':
            toast.warning(t('sell.approval.alreadyUsed'));
            return;
          case 'approval_unit_sold':
            toast.error(t('approval.void.unitSold'));
            return;
          case 'approval_unit_transferred':
            toast.error(t('approval.void.unitTransferred'));
            return;
          case 'approval_cost_changed':
            toast.warning(t('approval.void.costChanged'));
            return;
          case 'acknowledgement_rejected':
            /*
             * Not slowness. A confirmation that belongs to another person,
             * another shop or another operation — re-issuing one would launder
             * it, so the server refused and so does this.
             */
            toast.error(t('warning.rejectedConfirmation'));
            return;
          default:
            break;
        }

        // The server saw below-cost that we could not (cost hidden from us).
        if (e.status === 400 && /reason/i.test(e.message) && !options.overrideReason) {
          const { confirmed, reason } = await dialog.confirmWithReason({
            title: t('sell.belowCost.title'),
            message: e.message,
            confirmLabel: t('sell.belowCost.confirm'),
            reasonLabel: t('sell.belowCost.reason'),
            reasonPlaceholder: t('sell.belowCost.reasonPlaceholder'),
            tone: 'danger',
          });
          if (confirmed) await attempt(payments, { ...options, overrideReason: reason });
          return;
        }
      }
      toast.error(toErrorMessage(e));
    }
  };

  /**
   * Show what the server found, once, and take an answer.
   *
   * The server sends a key and parameters, never a sentence — it does not know
   * which language this phone is in. Each warning becomes its own line, with
   * what was typed and what it was compared against, so the question a person
   * is answering is a question about numbers they can see.
   */
  const confirmWarnings = async (response: WarningsPending): Promise<boolean> => {
    const lines_ = orderWarnings(response.warnings).map((w) => {
      const reference = referenceKey(w.reference);
      return [
        t(w.messageKey as never, w.params),
        w.submitted === null ? null : t('warning.youTyped', { amount: isolateLtr(formatMoney(w.submitted)) }),
        reference === null
          ? null
          : t(
              reference as never,
              w.reference?.amount === null
                ? undefined
                : { amount: isolateLtr(formatMoney(w.reference?.amount ?? 0)) },
            ),
      ]
        .filter(Boolean)
        .join(' ');
    });

    /*
     * Why the person is being asked a second time, when they are. "Something
     * changed" is the honest answer for a queued sale whose world moved; the
     * alternative is a dialog that looks identical to the one they just
     * answered and teaches them to tap through it.
     */
    const preface =
      response.reissuedBecause === 'warnings_changed'
        ? t('warning.changed')
        : response.reissuedBecause === 'expired'
          ? t('warning.expiredConfirmation')
          : null;

    /*
     * A confirmation, not an override. Nothing is typed here: a magnitude
     * warning is advisory, and the person is answering "yes, I meant that".
     * Demanding a written explanation for a genuinely expensive phone is how a
     * warning becomes something people learn to avoid triggering.
     */
    return dialog.confirm({
      title: t('warning.title'),
      message: [preface, ...lines_].filter(Boolean).join('\n\n'),
      confirmLabel: t('warning.confirm'),
      cancelLabel: t('warning.edit'),
      tone: 'danger',
    });
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
          message: t('sell.belowCost.body', { amount: isolateLtr(formatMoney(totalCost - total)) }),
          confirmLabel: t('sell.belowCost.confirm'),
          reasonLabel: t('sell.belowCost.reason'),
          reasonPlaceholder: t('sell.belowCost.reasonPlaceholder'),
          tone: 'danger',
        });
        if (!confirmed) return;
        overrideReason = reason;
      }

      await attempt(payments, { overrideReason });
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

  /**
   * The Owner said yes. Complete the SAME sale — the approval is not the sale.
   *
   * The server consumes the approval inside the sale's own transaction, so the
   * two either both happen or neither does. Sending the sale again is what
   * spends it; nothing here marks anything as approved.
   */
  const onApproved = async () => {
    const payments = heldPayments.current;
    setApprovalRequest(null);
    if (!payments) return;
    toast.success(t('sell.approval.ready'));
    setSubmitting(true);
    try {
      await attempt(payments);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Screen
        scroll={false}
        padded={false}
        header={
          <>
            {/* Title and branch, as on Stock: which shop this sale is being taken in. */}
            <View style={styles.titleRow}>
              <View style={styles.titleText}>
                <Text variant="title" accessibilityRole="header">
                  {t('sell.title')}
                </Text>
                {branchName ? (
                  <Text variant="caption" tone="tertiary" numberOfLines={1}>
                    {branchName}
                  </Text>
                ) : null}
              </View>
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
            />
          </>
        }
        footer={
          lines.length > 0 ? (
            <>
              {/*
                Said here, where the money is, rather than only in the dialog
                after Charge is pressed. Preventing the mistake beats recording
                it — and a cashier who learns at checkout that the sale needs a
                manager has already promised the customer a price.
              */}
              {belowCost ? (
                <InlineNotice tone="warning" style={styles.notice}>
                  {t('sell.belowCost.inline', { amount: isolateLtr(formatMoney(totalCost - total)) })}
                </InlineNotice>
              ) : null}
              {offline ? (
                <InlineNotice tone="danger" style={styles.notice}>
                  {t('sell.offline.body')}
                </InlineNotice>
              ) : null}
              <View style={styles.totals}>
                <Text variant="body" tone="secondary">
                  {t('sell.cart.count', { count: lines.length })}
                </Text>
                <MoneyValue value={total} size="display" />
              </View>
              <Button
                // Isolated so "1 030 MRU" keeps its order inside an Arabic label.
                title={t('sell.charge', { amount: isolateLtr(formatMoney(total)) })}
                size="lg"
                fullWidth
                /**
                 * Shut while there is no connection. A sale taken now would
                 * fail at the server and the customer would already have paid;
                 * refusing up front is the honest answer, and the banner above
                 * says why rather than leaving a dead button unexplained.
                 */
                disabled={offline || submitting}
                loading={submitting}
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
              {/*
                No `autoFocus` on the price. This card appears in response to a
                SCAN, and a scan result must not raise the keyboard on its own —
                the confirmation is the thing to read first, and it is exactly
                what a keyboard would cover. The field is one tap away, and the
                price is required, so nothing can be confirmed by accident for
                want of it.
              */}
              {pending.needsPrice ? (
                <MoneyField
                  label={t('receipt.price')}
                  hint={t('sell.priceRequired')}
                  value={pendingPrice}
                  onChangeText={setPendingPrice}
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
        returnPolicy={{
          companyDefaultHours,
          windowHours: effectiveWindowHours,
          onWindowChange: setReturnWindowHours,
          reason: returnPolicyReason,
          onReasonChange: setReturnPolicyReason,
          canOverride: canOverrideReturnPolicy,
        }}
      />
      <ApprovalRequestSheet
        request={approvalRequest}
        onClose={() => {
          setApprovalRequest(null);
          heldPayments.current = null;
        }}
        onApproved={() => void onApproved()}
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
  titleText: {
    flexShrink: 1,
    gap: 2,
  },
  list: {
    padding: space.base,
    gap: space.sm,
    paddingBottom: space['3xl'],
  },
  notice: { marginBottom: space.sm },
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
