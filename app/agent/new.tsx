import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { Store } from 'lucide-react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  InlineNotice,
  ListRow,
  MoneyField,
  PermissionNotice,
  RowGroup,
  Screen,
  Section,
  SkeletonList,
  Text,
  TextField,
} from '../../components/ui';
import { DraftNotice } from '../../components/DraftNotice';
import { DayGate } from '../../components/day/DayGate';
import { DirectionCard } from '../../components/agent/DirectionCard';
import { ExchangeReview } from '../../components/agent/ExchangeReview';
import { QueuedExchange } from '../../components/agent/QueuedExchange';
import { activityAllows } from '../../lib/activity';
import { useAgentProviders } from '../../lib/agent';
import {
  againForm,
  canReview,
  COUNTER_DRAFT_FORM,
  COUNTER_DRAFT_VERSION,
  counterPayload,
  counterStep,
  emptyCounterForm,
  formProblems,
  REFERENCE_MAX,
  type CounterForm,
} from '../../lib/agent-counter';
import { carryNumber, keepNumber, readNumber, recordExchange, useExchangeScope, type RecordOutcome } from '../../lib/agent-queue';
import {
  CUSTOMER_NUMBER_MAX_DIGITS,
  CUSTOMER_NUMBER_MIN_DIGITS,
  DIRECTIONS,
  counterProviders,
  parseCustomerNumber,
  previewExchange,
  providerChoice,
  referenceField,
} from '../../lib/agent-rules';
import { useBranchActivity, useBusinessAccess } from '../../lib/entitlement';
import { toAgentError } from '../../lib/errors';
import { formatDate, formatMoney, formatTime } from '../../lib/format';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { TABS } from '../../lib/navigation/back';
import { exchangeSummary } from '../../lib/offline/agent-exchange';
import { useQueue } from '../../lib/offline/queue';
import { useDraft } from '../../lib/offline/use-draft';
import { PAYER_NUMBER_MAX_INPUT } from '../../lib/payer-number';
import { parseAmount } from '../../lib/price-input';
import { usePermission } from '../../lib/permissions';
import { uuidv4 } from '../../lib/utils';

/**
 * New exchange — the counter flow (docs/73 §5.2, D157).
 *
 * Direction first, as two large cards in words with the money arrows; then the
 * provider (one whose rate or settlement is still blank is listed as *Not set
 * up yet* and cannot be chosen); the amount; the customer's number on the
 * phone pad; the reference when the provider issues one. Then ONE review —
 * both movements, the commission and where it goes — and Confirm.
 *
 * Confirm hands the exchange to the offline queue under the key the form was
 * opened with (D155): online it is recorded at once and shown with the
 * server's own time; offline it stays *Pending synchronization*. The person is
 * never asked who they are — the server records the session's person — and the
 * customer's number is typed here, never taken from a customer record, kept in
 * SecureStore rather than in the draft or the queue file.
 */
function NewExchangeScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const scope = useExchangeScope();
  const activity = useBranchActivity();
  const access = useBusinessAccess();
  const canRecord = usePermission('agent.transaction.record');
  const providersQuery = useAgentProviders({ enabled: canRecord });
  const providers = counterProviders(providersQuery.data?.providers ?? []);

  const [form, setForm] = useState<CounterForm>(() => emptyCounterForm(uuidv4()));
  const [customerNumber, setCustomerNumber] = useState('');
  /** The queue item this screen confirmed, or what a browser recorded directly. */
  const [sentId, setSentId] = useState<string | null>(null);
  const [direct, setDirect] = useState<Extract<RecordOutcome, { kind: 'recorded' }> | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = sentId !== null || direct !== null;
  const item = useQueue((s) => (sentId ? s.items.find((i) => i.id === sentId) : undefined));

  // The unsent form survives a restart; once confirmed it is the queue's, and the form is free again.
  const draft = useDraft(COUNTER_DRAFT_FORM, form, (v) => setForm(v), { payloadVersion: COUNTER_DRAFT_VERSION, enabled: !sent });

  /*
    The number lives in SecureStore under the form's key (D155). It is read back once per key — a restored draft
    brings its number with it — and only then written as it changes, so a restore is never overwritten by the
    empty field it starts from.
  */
  const numberReadFor = useRef<string | null>(null);
  const scopeKey = scope ? `${scope.companyId}|${scope.branchId}|${scope.userId}` : null;
  useEffect(() => {
    if (!scope) return;
    let live = true;
    const key = form.clientUuid;
    void readNumber(scope, key).then((kept) => {
      if (!live) return;
      if (kept !== null) setCustomerNumber(kept);
      numberReadFor.current = key;
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.clientUuid, scopeKey]);
  useEffect(() => {
    if (!scope || sent || numberReadFor.current !== form.clientUuid) return;
    void keepNumber(scope, form.clientUuid, customerNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerNumber, form.clientUuid, scopeKey, sent]);

  const provider = providers.find((p) => p.id === form.providerId) ?? null;
  const choice = provider ? providerChoice(provider) : null;
  const ready = choice?.selectable ? choice.config : null;
  const step = counterStep(form, provider);
  const problems = ready ? formProblems(form, customerNumber, ready) : {};
  const amount = parseAmount(form.amount);
  const preview = ready && form.direction && amount.ok && amount.value > 0 && provider ? previewExchange(form.direction, amount.value, provider.id, ready) : null;
  const update = (patch: Partial<CounterForm>) => setForm((f) => ({ ...f, ...patch }));

  const startOver = () => {
    setSentId(null);
    setDirect(null);
    setRefusal(null);
    setCustomerNumber('');
    numberReadFor.current = null;
    setForm(emptyCounterForm(uuidv4()));
  };

  const confirm = async () => {
    if (!scope || !provider || !ready || !preview || busy) return;
    const number = parseCustomerNumber(customerNumber);
    const payload = counterPayload(form, { ...provider, config: ready }, new Date());
    if (!number.ok || !payload) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await recordExchange({
      scope,
      clientUuid: form.clientUuid,
      payload,
      customerNumber: number.value,
      summary: exchangeSummary({ direction: t(`agent.summary.${payload.direction}`), amount: formatMoney(payload.amount), provider: provider.label }),
    });
    setBusy(false);
    if (outcome.kind === 'queued') {
      draft.clear();
      setSentId(outcome.itemId);
    } else if (outcome.kind === 'recorded') {
      draft.clear();
      setDirect(outcome);
    } else if (outcome.kind === 'offline_unavailable') {
      setRefusal(t('agent.web.offline'));
    } else {
      // Nothing was recorded: the review stays, with the reason in the counter's words, under the same key.
      setRefusal(toAgentError(outcome.error).body);
    }
  };

  /** A refused exchange back on the form, under a new key, its number carried with it. */
  const prepareAgain = async () => {
    if (!item || !scope) return;
    const next = againForm(item.payload, uuidv4());
    if (!next) return;
    const number = await carryNumber(scope, item.clientUuid, next.clientUuid);
    useQueue.getState().cancel(item.id);
    setSentId(null);
    setDirect(null);
    setRefusal(null);
    numberReadFor.current = next.clientUuid;
    setCustomerNumber(number ?? '');
    setForm(next);
  };

  const title = t('nav.agent.new');

  // What the branch is, and who is asking, before any form.
  if (!activityAllows(activity, 'money_agent')) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState icon={Store} title={t('agent.notSubscribed.title')} body={t('agent.notSubscribed.body')} />
      </Screen>
    );
  }
  if (!canRecord) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <PermissionNotice message={t('agent.permission.record')} />
      </Screen>
    );
  }

  if (sent) {
    return (
      <Screen
        scroll
        gap="lg"
        footer={
          <>
            <Button title={t('agent.outcome.new')} size="lg" fullWidth onPress={startOver} />
            <Button title={t('agent.outcome.list')} variant="secondary" fullWidth onPress={() => router.replace(TABS.agent as Href)} />
          </>
        }
      >
        <Stack.Screen options={{ title }} />
        {direct ? (
          <View style={styles.block} testID="exchange-recorded">
            <Text variant="heading">{t('agent.outcome.recorded.title')}</Text>
            <Text variant="body">
              {t('agent.outcome.recorded.body', {
                time: isolateLtr(formatTime(direct.confirmation.recordedAt)),
                date: formatDate(direct.confirmation.businessDate),
                name: direct.confirmation.recordedByName,
              })}
            </Text>
          </View>
        ) : item ? (
          <QueuedExchange item={item} onPrepareAgain={() => void prepareAgain()} />
        ) : null}
      </Screen>
    );
  }

  // The review shows only what can be confirmed: a restored review whose number was not kept goes back to the form.
  const reviewing = step === 'review' && canReview(problems);
  const editing = step === 'details' || (step === 'review' && !reviewing);
  const refField = ready ? referenceField(ready.referenceRule) : 'hidden';
  const numberError =
    customerNumber.trim() === '' || problems.number === undefined
      ? undefined
      : t(`agent.number.${problems.number}`, { min: CUSTOMER_NUMBER_MIN_DIGITS, max: CUSTOMER_NUMBER_MAX_DIGITS });
  const amountError = form.amount.trim() === '' || problems.amount === undefined ? undefined : t(`agent.amount.${problems.amount}`);

  return (
    <Screen
      scroll
      gap="lg"
      footer={
        reviewing ? (
          <>
            <Button
              title={t('agent.review.confirm')}
              size="lg"
              fullWidth
              disabled={busy || !preview || !access.canWrite}
              loading={busy}
              onPress={() => void confirm()}
            />
            <Button title={t('agent.review.edit')} variant="secondary" fullWidth onPress={() => update({ reviewing: false })} />
          </>
        ) : editing ? (
          <Button title={t('agent.review.action')} size="lg" fullWidth disabled={!canReview(problems)} onPress={() => update({ reviewing: true })} />
        ) : null
      }
    >
      <Stack.Screen options={{ title: reviewing ? t('agent.review.title') : title }} />

      {reviewing && preview && provider && form.direction ? (
        <>
          <ExchangeReview
            direction={form.direction}
            provider={provider.label}
            preview={preview}
            customerNumber={parseCustomerNumber(customerNumber).ok ? (parseCustomerNumber(customerNumber) as { value: string }).value : customerNumber}
            reference={refField !== 'hidden' && form.reference.trim() ? form.reference.trim() : null}
          />
          <Text variant="caption" tone="tertiary">
            {t('agent.review.serverNote')}
          </Text>
          {refusal ? (
            <InlineNotice tone="warning" title={t('agent.refusal.title')}>
              {refusal}
            </InlineNotice>
          ) : null}
        </>
      ) : (
        <>
          <DraftNotice draft={draft} onDiscard={startOver} />

          {/* 1 — what the customer is doing, in words, with the money arrows. */}
          <Section title={t('agent.direction.question')} gap="sm">
            {DIRECTIONS.map((d) => (
              <DirectionCard key={d} direction={d} provider={provider?.label ?? null} selected={form.direction === d} onPress={() => update({ direction: d })} />
            ))}
          </Section>

          {/* 2 — the provider: only one that is set up can be chosen. */}
          {form.direction ? (
            <Section title={t('agent.provider.question')} gap="sm">
              {providersQuery.isPending ? (
                <SkeletonList count={3} />
              ) : providersQuery.isError ? (
                <ErrorState size="inline" error={providersQuery.error} onRetry={() => void providersQuery.refetch()} />
              ) : providers.length === 0 ? (
                <InlineNotice tone="neutral">{t('agent.provider.none')}</InlineNotice>
              ) : (
                <RowGroup>
                  {providers.map((p) => {
                    const c = providerChoice(p);
                    return (
                      <ListRow
                        key={p.id}
                        flat
                        title={p.label}
                        subtitle={c.selectable ? undefined : t('agent.provider.notSetUp.hint')}
                        value={c.selectable ? undefined : t('agent.provider.notSetUp')}
                        valueTone="secondary"
                        selected={form.providerId === p.id}
                        disabled={!c.selectable}
                        chevron={false}
                        onPress={c.selectable ? () => update({ providerId: p.id }) : undefined}
                      />
                    );
                  })}
                </RowGroup>
              )}
            </Section>
          ) : null}

          {/* 3 — the amount, the customer's number, the reference when the provider issues one. */}
          {editing && ready && provider ? (
            <Section gap="md">
              <MoneyField label={t('agent.amount')} accessibilityLabel={t('agent.amount')} value={form.amount} onChangeText={(amount) => update({ amount })} error={amountError} required />
              <TextField
                label={t('agent.number')}
                accessibilityLabel={t('agent.number')}
                hint={t('agent.number.hint')}
                error={numberError}
                value={customerNumber}
                onChangeText={setCustomerNumber}
                variant="identifier"
                keyboardType="phone-pad"
                autoComplete="off"
                textContentType="none"
                maxLength={PAYER_NUMBER_MAX_INPUT}
                required
              />
              {refField !== 'hidden' ? (
                <TextField
                  label={t('agent.reference')}
                  hint={refField === 'required' ? t('agent.reference.required.hint', { provider: provider.label }) : t('agent.reference.optional.hint', { provider: provider.label })}
                  error={problems.reference === 'too_long' ? t('agent.reference.tooLong', { max: REFERENCE_MAX }) : undefined}
                  value={form.reference}
                  onChangeText={(reference) => update({ reference })}
                  variant="identifier"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={REFERENCE_MAX + 10}
                  required={refField === 'required'}
                />
              ) : null}
            </Section>
          ) : null}
        </>
      )}

      {!access.canWrite ? <InlineNotice tone="warning">{t('access.blocked.body')}</InlineNotice> : null}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm },
}));

/**
 * Behind the business-day guard, as Sell and Receive are (D76): while the current day is closed the store is opened
 * first, here — the server refuses an exchange on a closed day (store_closed) as it refuses a sale. A failed read
 * never blocks: offline, the exchange is still prepared and queued.
 */
export default function NewExchangeRoute() {
  return (
    <DayGate>
      <NewExchangeScreen />
    </DayGate>
  );
}
