import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanLine, Trash2, UserRound } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  InlineNotice,
  ListRow,
  MoneyField,
  MoneyValue,
  Screen,
  Text,
} from '../../components/ui';
import { ProductConfirmationCard } from '../../components/product';
import { ScanTarget } from '../../components/scanner';
import { BottomSheet, SelectSheet } from '../../components/overlay';
import { CartLineRow } from '../../components/sell/CartLineRow';
import { PaymentSheet, type ReceivingAccount } from '../../components/sell/PaymentSheet';
import { useCreateCustomer, useCustomers, type Customer } from '../../lib/customers';
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
import { saleDebtorFields, type DebtorDraft } from '../../lib/sale-payment-rules';
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
import { selectableAccounts } from '../../lib/receiving-accounts';
import { invalidateMoney } from '../../lib/money-invalidation';
import { classifySubmitFailure } from '../../lib/sale-submission';
import { recoverUncertainSale, refreshAfterUncertainty } from '../../lib/sale-recovery';

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
   * Who the sale is for. Optional, and deliberately so: an ordinary cash sale
   * needs nobody, and stopping to identify a walk-in customer would slow the
   * commonest transaction in the shop. The server requires one only when the
   * sale is not paid in full, which is a different workflow.
   */
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const customers = useCustomers(customerSearch, customerOpen);
  const createCustomer = useCreateCustomer();

  /**
   * Where non-cash money can land. Only ACTIVE accounts are returned to a
   * cashier, and the server refuses any other — so this list is what may be
   * offered, never a hint.
   */
  const accountsQuery = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ receivingAccounts?: ReceivingAccount[] }>('/settings'),
  });
  const receivingAccounts = accountsQuery.data?.receivingAccounts ?? [];

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
  /**
   * An approval the server asked for, waiting for the payment sheet to leave
   * the screen. Two sheets stacked is the one arrangement iOS does not reliably
   * show, so the second opens only once the first has reported itself closed.
   */
  const pendingApproval = useRef<ApprovalRequest | null>(null);
  /** The payments the sale was about to be charged with, held across the ask. */
  const heldPayments = useRef<PaymentEntry[] | null>(null);
  /** Who owes what the payments leave unpaid (0074). Travels with every retry. */
  const heldDebtor = useRef<DebtorDraft>({ kind: 'none' });
  /**
   * A submission in flight, as a ref rather than state: a second tap arrives
   * before React has re-rendered the button disabled, and must find this.
   */
  const inFlight = useRef(false);

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
        // The account is named on the receipt, so the customer's copy says
        // where the money went, not merely how it was paid.
        method: p.receivingAccountId
          ? `${t(`payment.${p.method}` as never)} · ${
              receivingAccounts.find((a) => a.id === p.receivingAccountId)?.label ?? ''
            }`.trim()
          : t(`payment.${p.method}` as never),
        amount: p.amount,
      })),
      returnPolicy: sale.returnPolicy,
    };

    setDone({ sale, receipt });
    setPaymentOpen(false);
    setLines([]);
    setDiscount(0);
    // The next customer is a different person; carrying this one over is how a
    // sale gets attributed to somebody who was never in the shop.
    setCustomer(null);
    // The sale reached the server, so the draft has done its job.
    cartDraft.clear();
    // A policy chosen for one customer must never carry into the next.
    setReturnWindowHours(null);
    setReturnPolicyReason('');
    qc.invalidateQueries({ queryKey: qk.home(branchId) });
    invalidateMoney(qc);
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
        payments: payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          // Sent only when there is one: the server refuses an account on cash.
          ...(p.receivingAccountId ? { receivingAccountId: p.receivingAccountId } : {}),
        })),
        ...saleDebtorFields(heldDebtor.current, customer?.id ?? null),
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
            // The approval sheet opens from `onPaymentClosed`, once this one is gone.
            pendingApproval.current = {
              unitId: body.unitId,
              label: line?.label ?? body.identifier ?? t('approvals.item'),
              identifier: body.identifier ?? line?.identifier ?? null,
              configuredPrice: body.configuredPrice ?? null,
              proposedPrice: line?.price ?? 0,
              belowCost: Boolean(body.belowCost),
            };
            setPaymentOpen(false);
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
      await reportFailure(e, payments);
    }
  };

  /**
   * A submission that ended in neither a sale nor a refusal the server named.
   *
   * The case that matters is a lost answer: the sale MAY have been recorded, so
   * the server is asked what this key recorded before anyone is told anything,
   * and everything a sale moves is re-read either way. Only a key the server
   * says it already spent on a different sale is ever replaced — the cart is
   * kept, and the next attempt is a new sale.
   */
  const reportFailure = async (error: unknown, payments: PaymentEntry[]) => {
    const failure = classifySubmitFailure(error);
    switch (failure.kind) {
      case 'uncertain': {
        toast.info(t('sell.submit.checking'));
        const recovered = await recoverUncertainSale<SaleResponse>(clientUuid.current);
        refreshAfterUncertainty(qc, branchId);
        if (recovered.kind === 'found') {
          toast.success(t('sell.submit.recovered'));
          finalize(recovered.sale, payments);
          return;
        }
        if (recovered.kind === 'not_found') toast.warning(t('sell.submit.notRecorded'));
        else toast.error(t('sell.submit.unknown'));
        return;
      }
      case 'idempotency_conflict':
        refreshAfterUncertainty(qc, branchId);
        clientUuid.current = uuidv4();
        setPaymentOpen(false);
        toast.error(t('sell.submit.conflict'));
        return;
      case 'offline':
        toast.error(t('sell.submit.offline'));
        return;
      default:
        toast.error(toErrorMessage(error));
    }
  };

  /** The payment sheet has left the screen; an approval it made way for may open now. */
  const onPaymentClosed = () => {
    setPaymentOpen(false);
    const next = pendingApproval.current;
    if (next) {
      pendingApproval.current = null;
      setApprovalRequest(next);
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

  const onComplete = async (payments: PaymentEntry[], debtor: DebtorDraft = { kind: 'none' }) => {
    // A second tap while the first is on its way must not start another sale.
    if (inFlight.current) return;
    inFlight.current = true;
    heldDebtor.current = debtor;
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
      inFlight.current = false;
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
    if (!payments || inFlight.current) return;
    inFlight.current = true;
    toast.success(t('sell.approval.ready'));
    setSubmitting(true);
    try {
      await attempt(payments);
    } finally {
      inFlight.current = false;
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
            {/*
              Who the sale is for — above the cart, because it is context for
              everything below it, and quiet, because most sales have none.
              Choosing or creating a customer never touches the cart.
            */}
            <ListRow
              leading={UserRound}
              title={customer?.name ?? t('sell.customer.none')}
              subtitle={
                customer
                  ? customer.balance > 0
                    ? t('sell.customer.balance', { amount: isolateLtr(formatMoney(customer.balance)) })
                    : (customer.phone ?? undefined)
                  : t('sell.customer.optional')
              }
              onPress={() => setCustomerOpen(true)}
            />
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
        onClose={onPaymentClosed}
        total={total}
        discount={discount}
        onDiscountChange={setDiscount}
        onComplete={onComplete}
        presetCustomer={customer ? { id: customer.id, name: customer.name } : null}
        submitting={submitting}
        accounts={selectableAccounts(receivingAccounts)}
        returnPolicy={{
          companyDefaultHours,
          windowHours: effectiveWindowHours,
          onWindowChange: setReturnWindowHours,
          reason: returnPolicyReason,
          onReasonChange: setReturnPolicyReason,
          canOverride: canOverrideReturnPolicy,
        }}
      />
      {/*
        Searching happens on the server, so a name two pages down is still
        findable — the same rule the transfer and supplier pickers follow.
        Creating one here returns to the sale with it selected; the cart,
        the discount and the scanned lines are untouched throughout.
      */}
      <SelectSheet
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        title={t('sell.customer.choose')}
        items={customers.data?.rows ?? []}
        keyExtractor={(c: Customer) => c.id}
        labelExtractor={(c: Customer) => c.name ?? ''}
        descriptionExtractor={(c: Customer) => c.phone ?? undefined}
        valueExtractor={(c: Customer) => (c.balance > 0 ? formatMoney(c.balance) : undefined)}
        leadingIcon={UserRound}
        selectedKeys={customer ? [customer.id] : []}
        searchPlaceholder={t('sell.customer.search')}
        onSearchChange={setCustomerSearch}
        loading={customers.isLoading}
        error={customers.error}
        onRetry={() => customers.refetch()}
        onSelect={(c: Customer) => {
          setCustomer(c);
          setCustomerOpen(false);
        }}
        onCreate={(name) =>
          createCustomer.mutate(
            { name },
            {
              onSuccess: (created) => {
                setCustomer(created);
                setCustomerOpen(false);
                toast.success(created.name ?? name);
              },
              onError: (e) => toast.error(toErrorMessage(e)),
            },
          )
        }
        creating={createCustomer.isPending}
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
