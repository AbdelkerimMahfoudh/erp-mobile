import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ScanLine, UserRound } from 'lucide-react-native';
import {
  Button,
  Card,
  EmptyState,
  InlineNotice,
  IconButton,
  ListRow,
  MoneyField,
  MoneyValue,
  Screen,
  Stepper,
  Text,
} from '../components/ui';
import { ScanTarget } from '../components/scanner';
import { useLeave } from '../components/navigation/HeaderBack';
import { SelectSheet } from '../components/overlay';
import { PaymentSheet, type ReceivingAccount } from '../components/sell/PaymentSheet';
import { DiscountCard, discountFrom } from '../components/sell/DiscountCard';
import { SaleSuccess } from '../components/sell/SaleSuccess';
import { ApprovalRequestSheet, type ApprovalRequest } from '../components/sell/ApprovalRequestSheet';
import type { PaymentEntry } from '../components/sell/types';
import { useCreateCustomer, useCustomers, type Customer } from '../lib/customers';
import { api, ApiError } from '../lib/api-client';
import { useAuth } from '../hooks/useAuth';
import { useActiveBranchName, useBranch } from '../lib/branch';
import { useConnectivity } from '../lib/connectivity';
import { isolateLtr, isRTL } from '../lib/design/direction';
import { space } from '../lib/design/tokens';
import { dialog } from '../lib/dialog';
import { toErrorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { daysInStock } from '../lib/home-metrics';
import { saleDebtorFields, type DebtorDraft } from '../lib/sale-payment-rules';
import { useTranslation } from '../lib/i18n';
import { illustrationFor } from '../lib/category-illustration';
import { displayName } from '../lib/display-name';
import { qk } from '../lib/query-keys';
import type { ReceiptData } from '../lib/receipt';
import type { ReturnPolicySnapshot } from '../lib/return-policy';
import { usePermission } from '../lib/permissions';
import { toast } from '../lib/toast';
import { uuidv4 } from '../lib/utils';
import { refusalOf } from '../lib/discount-approval-state';
import { isWarningsPending, orderWarnings, referenceKey, type WarningsPending } from '../lib/warnings';
import type { SaleSelection, ScanResult } from '../types/api';
import {
  ManualImeiPanel,
  PhoneChooser,
  SelectedPhoneCard,
  StockPicker,
  type PickMode,
} from '../components/sell/PhonePicker';
import { lookupSelection, type LookupFailure, type PickSource } from '../lib/phone-selection';
import { classifySubmitFailure, maySubmit, quantityProblem, saleLineFor, saleTotal } from '../lib/sale-submission';
import { recoverUncertainSale, refreshAfterUncertainty } from '../lib/sale-recovery';
import { makeStyles } from '../lib/design/theme';
import { selectableAccounts } from '../lib/receiving-accounts';
import { invalidateMoney } from '../lib/money-invalidation';
import { DayGate } from '../components/day/DayGate';

/**
 * Quick Sell — "Sell an item": one item, from Home.
 *
 * Home → Sell → find the item → the exact item → price and a private summary
 * → payment → confirmed. It is the single-item path, and it exists because that
 * is what almost every sale in the shop actually is.
 *
 * ## Three ways to find the item, one selection
 *
 * The sale starts with a choice: **Scan a code**, **Enter an identifier** or
 * **Choose from stock**. All three end in the same server lookup,
 * `GET /sales/selection/:identifier`, and the same selected-item card, and all
 * three continue into the same payment sheet — full or partial, with the same
 * debt, receipt and accounting. Finding an item never creates stock: the lookup
 * only reads.
 *
 * A phone is found by either IMEI, a camera or console by its serial number,
 * and an accessory by its product barcode. The first two are one exact unit; the
 * last is a counted product, so the review asks how many.
 *
 * ## What it deliberately does NOT do
 *
 * It does not touch the Sell tab's cart. That screen keeps its own draft, and a
 * shortcut that quietly emptied somebody's half-built sale would be worse than
 * no shortcut — so this screen holds its own single line, keeps no draft of its
 * own, and says so when a cart is already waiting next door.
 *
 * It also does not re-implement pricing, costing or approval. Every refusal
 * below is the SERVER's: the floor price, the below-cost rule and the owner
 * approval all live there, and this screen only asks and reports. The one piece
 * of arithmetic it does is `expectedGrossProfit`, which quotes a sale that has
 * not happened from two numbers the server supplied.
 *
 * ## One sale, one key, however many taps
 *
 * `clientUuid` names the sale, not the attempt. A lost answer is treated as
 * unknown: the server is asked what the key recorded before anyone is told
 * "not sent", and the key is never rotated while that is unknown — see
 * `sale-submission.ts` for the rules and `sale-recovery.ts` for the question.
 *
 * ## The private summary
 *
 * Cost, days in stock and expected profit are for the person holding the item.
 * None of it is on the receipt: `ReceiptData` has no cost and no margin field,
 * so what is shared cannot carry them — see `quick-sell-privacy.test.ts`.
 */

interface SaleResponse {
  id: string;
  invoiceNo: string;
  total: number;
  /** Absent without `cost.view`. */
  margin?: number;
  balanceDue: number;
  payStatus: string;
  soldAt: string;
  returnPolicy: ReturnPolicySnapshot;
  /** The customer as the receipt names them, snapshotted at confirmation (0108); null for a cash customer. */
  customer?: { name: string; phone: string | null } | null;
}

function QuickSellScreen() {
  // With no history (a notification, a cold start) leaving goes to the logical parent, never nowhere.
  const leave = useLeave('/quick-sell');
  const styles = useStyles();
  const { t, language } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const branchName = useActiveBranchName();
  const offline = !useConnectivity((s) => s.online);

  const canViewCost = usePermission('cost.view');

  /** Which way of finding the item is open. */
  const [mode, setMode] = useState<PickMode>('choose');
  /**
   * The item chosen, however it was found: the server's selection, the
   * identifier to put on the sale line, and how it was found.
   */
  const [picked, setPicked] = useState<{ selection: SaleSelection; identifier: string; source: PickSource } | null>(null);
  const [lookupError, setLookupError] = useState<LookupFailure | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  /** The shelf row picked — its identifier and its name — before the server is asked about it. */
  const [stockPick, setStockPick] = useState<{ identifier: string; label: string } | null>(null);
  const sellable = picked?.selection.availability === 'available';
  const [price, setPrice] = useState('');
  /** How many of a counted product. A serialized unit is always exactly one. */
  const [quantity, setQuantity] = useState(1);
  /** The whole-sale discount, as typed on the Discount card. */
  const [discountText, setDiscountText] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ sale: SaleResponse; receipt: ReceiptData } | null>(null);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const customers = useCustomers(customerSearch, customerOpen);
  const createCustomer = useCreateCustomer();

  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  /**
   * An approval the server asked for, waiting for the payment sheet to leave
   * the screen. Two sheets stacked is the one arrangement iOS does not reliably
   * show, so the second opens only once the first has reported itself closed.
   */
  const pendingApproval = useRef<ApprovalRequest | null>(null);
  const heldPayments = useRef<PaymentEntry[] | null>(null);
  /** Who owes what the payments leave unpaid (0074). Travels with every retry. */
  const heldDebtor = useRef<DebtorDraft>({ kind: 'none' });
  /** In how many days that balance is due (2026-10-17). Travels with every retry, so a retry is the same sale. */
  const heldDueDays = useRef<number | null>(null);
  /**
   * A submission in flight, as a ref rather than state: a second tap arrives
   * before React has re-rendered the button disabled, and must find this.
   */
  const inFlight = useRef(false);

  /**
   * One idempotency key per SALE, not per attempt.
   *
   * A retry after a timeout must look like the same sale to the server, or a
   * lost response becomes a second charge to a customer who already paid.
   */
  const clientUuid = useRef(uuidv4());

  /*
   * No return policy is chosen here (the owner's device test, 2026-10-28): the
   * server sells under the branch's configured policy and snapshots it on the
   * sale, and the receipt states what it recorded.
   */

  const accountsQuery = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ receivingAccounts?: ReceivingAccount[] }>('/settings'),
  });
  const receivingAccounts = accountsQuery.data?.receivingAccounts ?? [];

  const proposedPrice = Number(price) > 0 ? Number(price) : null;
  const age = daysInStock(picked?.selection.dateIn);
  /** How many the branch has of a counted product; a unit has no such figure. */
  const available = picked?.selection.kind === 'product' ? picked.selection.quantityAvailable : undefined;
  const quantityIssue = quantityProblem(quantity, available);
  /** The price times the quantity, before any discount. */
  const gross = proposedPrice === null ? null : saleTotal(proposedPrice, quantity);
  const discount = discountFrom(discountText, gross ?? 0);
  /** What the customer pays: the server recomputes it, and refuses a discount its rules do not allow. */
  const total = gross === null ? null : Math.round((gross - discount.amount) * 100) / 100;
  /**
   * What the sale would earn, from two numbers the server supplied: the total
   * after the discount, less what the items cost. Shown only where the role may
   * see cost; a loss is shown as a loss.
   */
  const cost = canViewCost ? picked?.selection.cost : undefined;
  const expected = total === null || typeof cost !== 'number' ? null : Math.round((total - cost * quantity) * 100) / 100;

  // ── Finding the item ──────────────────────────────────────────────────────

  /**
   * Every way of finding the item ends here: one selection, one set of
   * checks, one price. The server decided availability and price; this only
   * keeps what it said.
   */
  const choose = useCallback((selection: SaleSelection, identifier: string, source: PickSource) => {
    setLookupError(null);
    setPicked({ selection, identifier, source });
    setQuantity(1);
    // The price the sale will charge, from the server's own ladder. Changing
    // it is allowed exactly as before: the server refuses anything below the
    // floor without an owner's approval, and that refusal is handled below.
    setPrice(selection.price != null ? String(selection.price) : '');
  }, []);

  const findAndChoose = useCallback(
    async (code: string, source: PickSource) => {
      setLookingUp(true);
      try {
        const found = await lookupSelection(code);
        if (!found.ok) {
          setPicked(null);
          setLookupError(found.failure);
          return;
        }
        choose(found.selection, found.identifier, source);
      } finally {
        setLookingUp(false);
      }
    },
    [choose],
  );

  /*
   * The scanner is unchanged: raw IMEI, labelled IMEI or a dual-IMEI QR, its
   * own scan lock and paused result. Its result only feeds the shared lookup;
   * either IMEI finds the same phone because the server looks up both.
   */
  const onScanResult = useCallback((result: ScanResult) => findAndChoose(result.code, 'scan'), [findAndChoose]);

  /** Back to the three choices, with nothing carried over. */
  const chooseAnother = () => {
    setPicked(null);
    setLookupError(null);
    setStockPick(null);
    setPrice('');
    setQuantity(1);
    setDiscountText('');
    setMode('choose');
  };

  /** Each way in is its own screen, with its own name over it. */
  const title = picked
    ? t('pick.review.title')
    : mode === 'manual'
      ? t('pick.manual.title')
      : mode === 'stock'
        ? t('pick.stock.title')
        : mode === 'scan'
          ? t('pick.scan')
          : t('quick.sell.title');

  // ── Checkout ──────────────────────────────────────────────────────────────

  const finalize = (sale: SaleResponse, payments: PaymentEntry[]) => {
    const identifier = picked?.identifier ?? '';
    const label = picked ? `${picked.selection.product.brand} ${picked.selection.product.model}` : identifier;
    /*
     * The customer's copy. It carries what was sold, for how much and how it
     * was paid — and structurally cannot carry cost or profit, because
     * `ReceiptData` has no field for either.
     */
    const receipt: ReceiptData = {
      invoiceNo: sale.invoiceNo,
      soldAt: new Date(sale.soldAt),
      branchName: branchName ?? '',
      cashierName: user ? displayName(user, language) : '',
      lines: [{ label, identifier, quantity, unitPrice: proposedPrice ?? sale.total }],
      subtotal: gross ?? sale.total,
      discount: discount.amount,
      total: sale.total,
      payments: payments.map((p) => ({
        method: p.receivingAccountId
          ? `${t(`payment.${p.method}` as never)} · ${
              receivingAccounts.find((a) => a.id === p.receivingAccountId)?.label ?? ''
            }`.trim()
          : t(`payment.${p.method}` as never),
        amount: p.amount,
      })),
      returnPolicy: sale.returnPolicy,
      // The name chosen or typed for this sale, as the server recorded it — never "cash customer" when one was given.
      customer: sale.customer ?? null,
    };

    setDone({ sale, receipt });
    setPaymentOpen(false);
    setPicked(null);
    setMode('choose');
    setPrice('');
    setQuantity(1);
    setDiscountText('');
    setCustomer(null);
    // Home's month figures and the shelf both moved.
    qc.invalidateQueries({ queryKey: qk.home(branchId) });
    qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
    qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
    invalidateMoney(qc);
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
   * A submission that ended in neither a sale nor a refusal the server named.
   *
   * The case that matters is a lost answer: the sale MAY have been recorded, so
   * the server is asked what this key recorded before anyone is told anything,
   * and everything a sale moves is re-read either way. Only a key the server
   * says it already spent on a different sale is ever replaced.
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
        chooseAnother();
        toast.error(t('sell.submit.conflict'));
        return;
      case 'offline':
        toast.error(t('sell.submit.offline'));
        return;
      default:
        toast.error(toErrorMessage(error));
    }
  };

  const attempt = async (
    payments: PaymentEntry[],
    options: { overrideReason?: string; acknowledgementToken?: string } = {},
  ): Promise<void> => {
    if (!picked || !sellable || proposedPrice === null) return;
    const identifier = picked.identifier;
    const line = saleLineFor(picked.selection, identifier, quantity, proposedPrice);

    try {
      const response = await api.post<SaleResponse | WarningsPending>('/sales', {
        clientUuid: clientUuid.current,
        lines: [line],
        payments: payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          ...(p.receivingAccountId ? { receivingAccountId: p.receivingAccountId } : {}),
          // The number the money came from (D151): sent only when there is one, never on cash.
          ...(p.payerNumber ? { payerNumber: p.payerNumber } : {}),
        })),
        ...saleDebtorFields(heldDebtor.current, customer?.id ?? null),
        ...(discount.amount > 0 ? { saleDiscount: discount.amount } : {}),
        ...(heldDueDays.current !== null ? { dueInDays: heldDueDays.current } : {}),
        ...(options.overrideReason ? { overrideReason: options.overrideReason } : {}),
        ...(options.acknowledgementToken ? { acknowledgementToken: options.acknowledgementToken } : {}),
      });

      if (isWarningsPending(response)) {
        // Nothing was saved. The server wants the number looked at once more.
        const confirmed = await confirmWarnings(response);
        if (!confirmed) return;
        await attempt(payments, { ...options, acknowledgementToken: response.acknowledgementToken });
        return;
      }

      finalize(response, payments);
    } catch (e) {
      if (e instanceof ApiError) {
        switch (refusalOf(e.code)) {
          case 'approval_required': {
            const body = (e.body ?? {}) as {
              belowCost?: boolean;
              configuredPrice?: number | null;
              unitId?: string | null;
              identifier?: string | null;
            };
            if (!body.unitId) {
              toast.error(toErrorMessage(e));
              return;
            }
            heldPayments.current = payments;
            // The approval sheet opens from `onPaymentClosed`, once this one is gone.
            pendingApproval.current = {
              unitId: body.unitId,
              label: `${picked.selection.product.brand} ${picked.selection.product.model}`,
              identifier: body.identifier ?? identifier,
              configuredPrice: body.configuredPrice ?? null,
              proposedPrice,
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
          case 'discount_below_cost':
            toast.warning(t('sell.discountBelowCost'));
            return;
          case 'acknowledgement_rejected':
            toast.error(t('warning.rejectedConfirmation'));
            return;
          // The form stops each of these first; these answer an older screen or a race, in the reader's language.
          case 'too_many_payment_methods':
            toast.error(t('sell.payment.split.max'));
            return;
          case 'duplicate_payment_destination':
            toast.error(t('sell.payment.split.duplicate'));
            return;
          case 'overpayment': {
            const received = payments.reduce((sum, p) => sum + p.amount, 0);
            toast.error(
              payments.length > 1
                ? t('sell.payment.split.over', { sum: isolateLtr(formatMoney(received)), total: isolateLtr(formatMoney(total ?? 0)) })
                : t('sell.payment.exactOnly'),
            );
            return;
          }
          // The debt card stops each of these first; these answer an older screen, in the reader's language.
          case 'customer_name_required':
          case 'customer_phone_required':
          case 'customer_phone_invalid':
          case 'due_days_required':
          case 'due_days_invalid':
            toast.error(t(`sellDebt.problem.${e.code}` as never));
            return;
          case 'debtor_required': {
            const received = payments.reduce((sum, p) => sum + p.amount, 0);
            toast.error(t('sellDebt.problem.debtor_required', { amount: isolateLtr(formatMoney(Math.max(0, (total ?? 0) - received))) }));
            return;
          }
          // The day closed under this screen: nothing was sold. Reading the day again brings up the lock and Open store now.
          case 'store_closed':
            toast.error(t('gate.refused.sale'));
            qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
            qc.invalidateQueries({ queryKey: qk.home(branchId) });
            return;
          default:
            break;
        }

        // The server saw below-cost that we could not, because cost is hidden.
        if (e.status === 400 && (e.code === 'reason_required' || /reason/i.test(e.message)) && !options.overrideReason) {
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

  const confirmWarnings = async (response: WarningsPending): Promise<boolean> => {
    const lines = orderWarnings(response.warnings).map((w) => {
      const reference = referenceKey(w.reference);
      return [
        t(w.messageKey as never, w.params),
        w.submitted === null ? null : t('warning.youTyped', { amount: isolateLtr(formatMoney(w.submitted)) }),
        reference === null
          ? null
          : t(
              reference as never,
              w.reference?.amount === null ? undefined : { amount: isolateLtr(formatMoney(w.reference?.amount ?? 0)) },
            ),
      ]
        .filter(Boolean)
        .join(' ');
    });

    const preface =
      response.reissuedBecause === 'warnings_changed'
        ? t('warning.changed')
        : response.reissuedBecause === 'expired'
          ? t('warning.expiredConfirmation')
          : null;

    return dialog.confirm({
      title: t('warning.title'),
      message: [preface, ...lines].filter(Boolean).join('\n\n'),
      confirmLabel: t('warning.confirm'),
      cancelLabel: t('warning.edit'),
      tone: 'danger',
    });
  };

  const onComplete = async (payments: PaymentEntry[], debtor: DebtorDraft = { kind: 'none' }, dueInDays: number | null = null) => {
    if (!maySubmit({ inFlight: inFlight.current, sellable: Boolean(sellable), price: proposedPrice, quantity, available })) return;
    inFlight.current = true;
    heldDebtor.current = debtor;
    heldDueDays.current = dueInDays;
    setSubmitting(true);
    try {
      let overrideReason: string | undefined;
      if (expected !== null && expected < 0) {
        const { confirmed, reason } = await dialog.confirmWithReason({
          title: t('sell.belowCost.title'),
          message: t('sell.belowCost.body', { amount: isolateLtr(formatMoney(Math.abs(expected))) }),
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

  /** The Owner said yes: the SAME sale goes again, under the same key. */
  const onApproved = async () => {
    const payments = heldPayments.current;
    setApprovalRequest(null);
    if (!payments || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await attempt(payments);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (done) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: t('quick.sell.title') }} />
        <SaleSuccess
          invoiceNo={done.sale.invoiceNo}
          total={done.sale.total}
          /* Shown only when the server sent it — a role without `cost.view`
             gets no margin at all, and the line is omitted rather than blank. */
          margin={done.sale.margin}
          receipt={done.receipt}
          onNewSale={() => {
            // A new sale is a new logical action, so a new idempotency key.
            clientUuid.current = uuidv4();
            setDone(null);
          }}
        />
      </Screen>
    );
  }

  const lookupNotice = lookupError ? (
    <InlineNotice tone={lookupError === 'network' ? 'warning' : 'danger'} style={styles.notice}>
      {t(`pick.failure.${lookupError}` as never)}
    </InlineNotice>
  ) : null;

  return (
    <>
      <Screen
        scroll={false}
        padded={false}
        header={
          mode === 'scan' && !picked ? (
            <ScanTarget
              onResult={onScanResult}
              // Selling: a phone already in stock is the one wanted, never a duplicate (2026-10-28).
              purpose="sell"
              /* Scan was chosen, so the camera opens straight away. */
              autoOpenCamera={Boolean(branchId)}
              placeholder={t('sell.scan.placeholder')}
            />
          ) : undefined
        }
        footer={
          picked ? (
            <>
              {offline && sellable ? (
                <InlineNotice tone="danger" style={styles.notice}>
                  {t('sell.offline.body')}
                </InlineNotice>
              ) : null}
              {/*
                One primary action (the owner's brief of 2026-10-17). Another item
                is the header's back arrow; an item that cannot be sold keeps a way
                back here, because it has nothing else to press.
              */}
              {sellable ? (
                <Button
                  title={t('pick.continue')}
                  size="lg"
                  fullWidth
                  disabled={offline || submitting || proposedPrice === null || quantityIssue !== null || discount.problem !== null}
                  loading={submitting}
                  onPress={() => setPaymentOpen(true)}
                />
              ) : (
                <Button title={t('pick.another')} variant="secondary" fullWidth onPress={chooseAnother} />
              )}
            </>
          ) : mode === 'stock' ? (
            /*
             * The shelf's answer lives with its button. A notice at the foot of
             * a thirty-row list, under this footer, is how "Continue" came to
             * look like it did nothing.
             */
            <>
              {lookupNotice}
              {stockPick ? (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {t('pick.stock.selected', { name: stockPick.label })}
                </Text>
              ) : null}
              <Button
                title={t('pick.stock.continue')}
                size="lg"
                fullWidth
                loading={lookingUp}
                disabled={!stockPick || lookingUp}
                onPress={() => stockPick && void findAndChoose(stockPick.identifier, 'stock')}
              />
            </>
          ) : undefined
        }
      >
        <Stack.Screen
          options={{
            headerShown: true,
            title,
            headerBackVisible: false,
            // Back from a way in, or from the review, is back to the three choices.
            headerLeft: () => (
              <IconButton
                icon={isRTL() ? ArrowRight : ArrowLeft}
                accessibilityLabel={t('action.back')}
                onPress={() => (picked || mode !== 'choose' ? chooseAnother() : leave())}
              />
            ),
          }}
        />

        {/* The shelf is its own virtualized list, so it is the screen's scroller — never a list inside this scroll view. */}
        {!picked && mode === 'stock' ? (
          <StockPicker
            selected={stockPick?.identifier ?? null}
            onSelect={(identifier, label) => {
              setLookupError(null);
              setStockPick({ identifier, label });
            }}
          />
        ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {!picked ? (
            <>
              {mode === 'choose' ? (
                <>
                  <PhoneChooser onChoose={setMode} />
                  {/* Several items, or a cart already started: the full sale is one tap away. */}
                  <Button
                    title={t('home.shortcut.fullSale')}
                    variant="secondary"
                    fullWidth
                    onPress={() => router.push('/(tabs)/sell')}
                  />
                </>
              ) : mode === 'scan' ? (
                <EmptyState icon={ScanLine} title={t('sell.empty.title')} body={t('sell.empty.body')} />
              ) : (
                <ManualImeiPanel
                  onUse={(selection, identifier) => choose(selection, identifier, 'manual')}
                  onStockInstead={() => {
                    setLookupError(null);
                    setMode('stock');
                  }}
                />
              )}

              {lookupNotice}
            </>
          ) : null}

          {picked ? (
            <>
              <SelectedPhoneCard selection={picked.selection} source={picked.source}>
                {sellable ? (
                  <>
                    {picked.selection.kind === 'product' ? (
                      <View style={styles.row}>
                        <View style={styles.grow}>
                          <Text variant="labelStrong">{t('pick.quantity')}</Text>
                          {available !== undefined ? (
                            <Text variant="caption" tone="secondary">
                              {quantityIssue === 'too_many'
                                ? t('pick.quantity.tooMany', { count: String(available) })
                                : t('pick.quantity.available', { count: String(available) })}
                            </Text>
                          ) : null}
                        </View>
                        <Stepper
                          value={quantity}
                          onChange={setQuantity}
                          min={1}
                          max={available ?? 9999}
                          accessibilityLabel={t('pick.quantity')}
                        />
                      </View>
                    ) : null}
                    <MoneyField label={t('quick.sell.price')} value={price} onChangeText={setPrice} required />
                  </>
                ) : null}
              </SelectedPhoneCard>
            </>
          ) : null}

          {picked && sellable ? (
            <>

              {/*
                The private summary. Everything a seller needs to judge the
                price in front of them, and nothing the customer ever sees.
              */}
              <Card style={styles.card}>
                <Text variant="labelStrong">{t('quick.sell.summary')}</Text>

                <SummaryRow
                  label={t('quick.sell.received')
                    .replace('{date}', picked.selection.dateIn ? formatDate(picked.selection.dateIn) : '')
                    .trim()}
                  value={
                    age === null
                      ? t('quick.sell.inStock.unknown')
                      : age === 0
                        ? t('quick.sell.inStock.today')
                        : t('quick.sell.inStock', { days: String(age) })
                  }
                />

                {/*
                  Cost only where the role may see it. Without `cost.view` the
                  server strips the field entirely, and the row is omitted
                  rather than shown as a dash somebody reads as "free".
                */}
                {canViewCost && picked.selection.cost === null ? (
                  // Received without its buying cost (0107): the profit of this sale will be incomplete.
                  <SummaryRow label={t('quick.sell.cost')} value={t('cost.missing.status')} />
                ) : canViewCost && picked.selection.cost !== undefined ? (
                  <SummaryRow label={t('quick.sell.cost')} value={formatMoney(picked.selection.cost)} />
                ) : null}

                {discount.amount > 0 && total !== null ? (
                  <>
                    <SummaryRow label={t('sell.discount')} value={`− ${formatMoney(discount.amount)}`} />
                    <SummaryRow label={t('quick.sell.saleTotal')} value={formatMoney(total)} />
                  </>
                ) : null}

                {expected !== null ? (
                  <View style={styles.row}>
                    <Text variant="body" tone="secondary">
                      {expected < 0 ? t('quick.sell.expected.loss') : t('quick.sell.expected')}
                    </Text>
                    {/* A loss is shown as a loss. Flooring it at zero would hide
                        exactly the sale somebody needs to think again about. */}
                    <MoneyValue value={expected} size="small" />
                  </View>
                ) : null}

                <Text variant="caption" tone="tertiary">
                  {t('quick.sell.private')}
                </Text>
              </Card>

              {/* Its own card, right under the summary it changes; open only when somebody wants one. */}
              <DiscountCard text={discountText} onChangeText={setDiscountText} subtotal={gross ?? 0} />

              <ListRow
                leading={UserRound}
                title={customer?.name ?? t('sell.customer.none')}
                subtitle={customer ? (customer.phone ?? undefined) : t('sell.customer.optional')}
                onPress={() => setCustomerOpen(true)}
              />
            </>
          ) : null}
        </ScrollView>
        )}
      </Screen>

      <PaymentSheet
        open={paymentOpen}
        onClose={onPaymentClosed}
        total={total ?? 0}
        onComplete={onComplete}
        summary={
          picked
            ? [
                `${picked.selection.product.brand} ${picked.selection.product.model}`,
                picked.selection.product.variant,
                quantity > 1 ? `× ${quantity}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : null
        }
        illustration={
          picked ? illustrationFor(picked.selection.product.categoryVisual, picked.selection.product.trackingType) : undefined
        }
        presetCustomer={customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null}
        submitting={submitting}
        accounts={selectableAccounts(receivingAccounts)}
      />

      <SelectSheet
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        title={t('sell.customer.choose')}
        items={customers.data?.rows ?? []}
        keyExtractor={(c: Customer) => c.id}
        labelExtractor={(c: Customer) => c.name ?? ''}
        descriptionExtractor={(c: Customer) => c.phone ?? undefined}
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: { padding: space.base, gap: space.sm, paddingBottom: space['3xl'] },
  card: { gap: space.sm },
  notice: { marginBottom: space.sm },
  grow: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
}));

/** Behind the business-day guard: while the current day is closed, the store is opened first (2026-09-27). */
export default function QuickSellScreenRoute() {
  return (
    <DayGate>
      <QuickSellScreen />
    </DayGate>
  );
}
