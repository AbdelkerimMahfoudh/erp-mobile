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
  Text,
} from '../components/ui';
import { ScanTarget } from '../components/scanner';
import { SelectSheet } from '../components/overlay';
import { PaymentSheet, type ReceivingAccount } from '../components/sell/PaymentSheet';
import { SaleSuccess } from '../components/sell/SaleSuccess';
import { ApprovalRequestSheet, type ApprovalRequest } from '../components/sell/ApprovalRequestSheet';
import type { PaymentEntry } from '../components/sell/types';
import { useCreateCustomer, useCustomers, type Customer } from '../lib/customers';
import { api, ApiError } from '../lib/api-client';
import { useAuth } from '../hooks/useAuth';
import { useBranch } from '../lib/branch';
import { useConnectivity } from '../lib/connectivity';
import { isolateLtr, isRTL } from '../lib/design/direction';
import { space } from '../lib/design/tokens';
import { dialog } from '../lib/dialog';
import { toErrorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { daysInStock, expectedGrossProfit } from '../lib/home-metrics';
import { useTranslation } from '../lib/i18n';
import { qk } from '../lib/query-keys';
import type { ReceiptData } from '../lib/receipt';
import type { ReturnPolicySnapshot } from '../lib/return-policy';
import { usePermission } from '../lib/permissions';
import { useCompanyReturnWindow } from '../lib/sales';
import { toast } from '../lib/toast';
import { uuidv4 } from '../lib/utils';
import { refusalOf } from '../lib/discount-approval-state';
import { isWarningsPending, orderWarnings, referenceKey, type WarningsPending } from '../lib/warnings';
import type { ScanResult, Unit } from '../types/api';
import { makeStyles } from '../lib/design/theme';

/**
 * Quick Sell — one phone, from Home, camera first.
 *
 * Home → Sell → scanner → the exact phone → price and a private summary →
 * payment → confirmed. It is the single-item path, and it exists because that
 * is what almost every sale in a phone shop actually is.
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
 * ## The private summary
 *
 * Cost, days in stock and expected profit are for the person holding the phone.
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
}

export default function QuickSellScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const offline = !useConnectivity((s) => s.online);

  const canViewCost = usePermission('cost.view');
  const canOverrideReturnPolicy = usePermission('return.policy.override');

  const [unit, setUnit] = useState<Unit | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ sale: SaleResponse; receipt: ReceiptData } | null>(null);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const customers = useCustomers(customerSearch, customerOpen);
  const createCustomer = useCreateCustomer();

  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const heldPayments = useRef<PaymentEntry[] | null>(null);

  /**
   * One idempotency key per SALE, not per attempt.
   *
   * A retry after a timeout must look like the same sale to the server, or a
   * lost response becomes a second charge to a customer who already paid.
   */
  const clientUuid = useRef(uuidv4());
  /** Started the moment a code is captured, so the lookup overlaps recognition. */
  const unitLookups = useRef(new Map<string, Promise<Unit | null>>());

  const companyDefaultHours = useCompanyReturnWindow();
  const [returnWindowHours, setReturnWindowHours] = useState<number | null>(null);
  const [returnPolicyReason, setReturnPolicyReason] = useState('');
  const effectiveWindowHours = returnWindowHours ?? companyDefaultHours;

  const accountsQuery = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ receivingAccounts?: ReceivingAccount[] }>('/settings'),
  });
  const receivingAccounts = accountsQuery.data?.receivingAccounts ?? [];

  const proposedPrice = Number(price) > 0 ? Number(price) : null;
  const expected = expectedGrossProfit(proposedPrice, canViewCost ? unit?.cost : undefined);
  const age = daysInStock(unit?.dateIn);

  // ── Scanning ──────────────────────────────────────────────────────────────

  const onCodeCaptured = useCallback((code: string) => {
    if (unitLookups.current.has(code)) return;
    unitLookups.current.set(
      code,
      api.get<Unit>(`/units/${encodeURIComponent(code)}`).catch(() => null),
    );
  }, []);

  const onScanResult = useCallback(
    async (result: ScanResult) => {
      const found = (await unitLookups.current.get(result.code)) ?? null;
      unitLookups.current.delete(result.code);

      /*
       * Either IMEI finds the same phone — the server looks up primary,
       * secondary and serial alike, so a dual-SIM handset scanned by its second
       * number is the same unit and not a miss.
       */
      if (!found) {
        setUnit(null);
        setBlocked(t('quick.sell.notFound'));
        return;
      }

      /*
       * Availability, custody and branch are the SERVER's facts; this only
       * reports them. A reserved unit is on somebody's transfer and a sold one
       * is gone — selling either would be selling a phone the shop does not
       * have to give.
       */
      if (found.status !== 'in_stock') {
        setUnit(found);
        setBlocked(t(`status.unit.${found.status}` as never));
        return;
      }
      if (found.branchId && branchId && found.branchId !== branchId) {
        setUnit(found);
        setBlocked(t('quick.sell.unavailable'));
        return;
      }

      setBlocked(null);
      setUnit(found);
      // The configured selling price, prefilled. Changing it is allowed exactly
      // as it is on the Sell tab: the server refuses anything below the floor
      // without an owner's approval, and that refusal is handled below.
      setPrice(found.product?.defaultPrice != null ? String(found.product.defaultPrice) : '');
    },
    [branchId, t],
  );

  // ── Checkout ──────────────────────────────────────────────────────────────

  const finalize = (sale: SaleResponse, payments: PaymentEntry[]) => {
    const identifier = unit?.imeiPrimary ?? unit?.serialNo ?? '';
    const label = unit?.product ? `${unit.product.brand} ${unit.product.model}` : identifier;
    /*
     * The customer's copy. It carries what was sold, for how much and how it
     * was paid — and structurally cannot carry cost or profit, because
     * `ReceiptData` has no field for either.
     */
    const receipt: ReceiptData = {
      invoiceNo: sale.invoiceNo,
      soldAt: new Date(sale.soldAt),
      branchName: branchName ?? '',
      cashierName: user?.name ?? '',
      lines: [{ label, identifier, quantity: 1, unitPrice: proposedPrice ?? sale.total }],
      subtotal: proposedPrice ?? sale.total,
      discount: 0,
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
    };

    setDone({ sale, receipt });
    setPaymentOpen(false);
    setUnit(null);
    setPrice('');
    setCustomer(null);
    setReturnWindowHours(null);
    setReturnPolicyReason('');
    // Home's month figures and the shelf both moved.
    qc.invalidateQueries({ queryKey: qk.home(branchId) });
    qc.invalidateQueries({ queryKey: qk.inventory(branchId) });
    qc.invalidateQueries({ queryKey: qk.inventorySummary(branchId) });
    qc.invalidateQueries({ queryKey: ['analytics-summary'] });
  };

  const attempt = async (
    payments: PaymentEntry[],
    options: { overrideReason?: string; acknowledgementToken?: string } = {},
  ): Promise<void> => {
    if (!unit || proposedPrice === null) return;
    const identifier = unit.imeiPrimary ?? unit.serialNo;
    if (!identifier) return;

    try {
      const response = await api.post<SaleResponse | WarningsPending>('/sales', {
        clientUuid: clientUuid.current,
        lines: [{ identifier, price: proposedPrice }],
        payments: payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          ...(p.receivingAccountId ? { receivingAccountId: p.receivingAccountId } : {}),
        })),
        ...(customer ? { customerId: customer.id } : {}),
        ...(options.overrideReason ? { overrideReason: options.overrideReason } : {}),
        ...(effectiveWindowHours !== companyDefaultHours
          ? { returnWindowHours: effectiveWindowHours, returnPolicyReason: returnPolicyReason.trim() }
          : {}),
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
            setApprovalRequest({
              unitId: body.unitId,
              label: unit.product ? `${unit.product.brand} ${unit.product.model}` : identifier,
              identifier: body.identifier ?? identifier,
              configuredPrice: body.configuredPrice ?? null,
              proposedPrice,
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
            toast.error(t('warning.rejectedConfirmation'));
            return;
          default:
            break;
        }

        // The server saw below-cost that we could not, because cost is hidden.
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

  const onComplete = async (payments: PaymentEntry[]) => {
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

  return (
    <>
      <Screen
        scroll={false}
        padded={false}
        header={
          <ScanTarget
            onResult={onScanResult}
            onCodeCaptured={onCodeCaptured}
            /* The whole point of the shortcut: the camera is already open. */
            autoOpenCamera={Boolean(branchId)}
            placeholder={t('sell.scan.placeholder')}
          />
        }
        footer={
          unit && !blocked ? (
            <>
              {offline ? (
                <InlineNotice tone="danger" style={styles.notice}>
                  {t('sell.offline.body')}
                </InlineNotice>
              ) : null}
              <Button
                title={t('quick.sell.confirm')}
                size="lg"
                fullWidth
                disabled={offline || submitting || proposedPrice === null}
                loading={submitting}
                onPress={() => setPaymentOpen(true)}
              />
            </>
          ) : undefined
        }
      >
        <Stack.Screen
          options={{
            headerShown: true,
            title: t('quick.sell.title'),
            headerBackVisible: false,
            headerLeft: () => (
              <IconButton
                icon={isRTL() ? ArrowRight : ArrowLeft}
                accessibilityLabel={t('action.back')}
                onPress={() => router.back()}
              />
            ),
          }}
        />

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {!unit && !blocked ? (
            <EmptyState icon={ScanLine} title={t('sell.empty.title')} body={t('sell.empty.body')} />
          ) : null}

          {blocked ? (
            <InlineNotice tone="danger" title={t('quick.sell.unavailable')}>
              {blocked}
            </InlineNotice>
          ) : null}

          {unit && !blocked ? (
            <>
              <Card style={styles.card}>
                <Text variant="heading">
                  {unit.product ? `${unit.product.brand} ${unit.product.model}` : ''}
                </Text>
                {unit.product?.variant ? (
                  <Text variant="body" tone="secondary">
                    {unit.product.variant}
                  </Text>
                ) : null}

                <MoneyField
                  label={t('quick.sell.price')}
                  value={price}
                  onChangeText={setPrice}
                  required
                />
              </Card>

              {/*
                The private summary. Everything a seller needs to judge the
                price in front of them, and nothing the customer ever sees.
              */}
              <Card style={styles.card}>
                <Text variant="labelStrong">{t('quick.sell.summary')}</Text>

                <SummaryRow
                  label={t('quick.sell.received')
                    .replace('{date}', unit.dateIn ? formatDate(unit.dateIn) : '')
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
                {canViewCost && unit.cost !== undefined ? (
                  <SummaryRow label={t('quick.sell.cost')} value={formatMoney(unit.cost)} />
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

              <ListRow
                leading={UserRound}
                title={customer?.name ?? t('sell.customer.none')}
                subtitle={customer ? (customer.phone ?? undefined) : t('sell.customer.optional')}
                onPress={() => setCustomerOpen(true)}
              />
            </>
          ) : null}
        </ScrollView>
      </Screen>

      <PaymentSheet
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        total={proposedPrice ?? 0}
        discount={0}
        onDiscountChange={() => {}}
        onComplete={onComplete}
        submitting={submitting}
        accounts={receivingAccounts}
        returnPolicy={{
          companyDefaultHours,
          windowHours: effectiveWindowHours,
          onWindowChange: setReturnWindowHours,
          reason: returnPolicyReason,
          onReasonChange: setReturnPolicyReason,
          canOverride: canOverrideReturnPolicy,
        }}
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
        onApproved={() => {
          const payments = heldPayments.current;
          setApprovalRequest(null);
          if (!payments) return;
          setSubmitting(true);
          void attempt(payments).finally(() => setSubmitting(false));
        }}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
}));
