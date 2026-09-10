import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import {
  Button,
  Card,
  ErrorState,
  InlineNotice,
  MoneyValue,
  Screen,
  SkeletonList,
  StatusChip,
  Text,
  TextField,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useConnectivity } from '../../lib/connectivity';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { useAuth } from '../../hooks/useAuth';
import {
  useCancelApproval,
  useDecideApproval,
  useDiscountApproval,
} from '../../lib/discount-approvals';
import {
  canCancel,
  canDecide,
  discountPercent,
  lossIfBelowCost,
  minutesLeft,
  viewOf,
  type DiscountApproval,
} from '../../lib/discount-approval-state';

/**
 * One request, and the Owner's answer (A2/CP4).
 *
 * This is where a notification lands. Everything the decision needs is on one
 * screen — which item, whose request, which shop, the set price, the price
 * being asked for, the reason, and how long is left — because an Owner is
 * usually answering this while somebody stands at a counter.
 *
 * ## Three things this screen refuses to do
 *
 * **It never decides locally.** Approve and reject are server calls, and what
 * comes back replaces what is shown. If the row moved underneath — somebody
 * else answered, it lapsed, the price changed — the server's answer wins and
 * the screen re-reads rather than arguing.
 *
 * **It never invents the cost.** `unitCost` arrives only when the cost gate let
 * it through. Without it the loss is not estimated from anything; the screen
 * says a stronger approval is needed and shows no figure, which is true and
 * discloses nothing.
 *
 * **It never makes approving easy.** The confirmation states, in the reader's
 * own language, that this allows ONE sale of THIS item at THAT price for THAT
 * many minutes. An Owner approving their own request sees the same friction and
 * is told the request is theirs — that is the point of routing it through here
 * rather than letting an exception happen invisibly.
 */
export default function ApprovalDetailScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const online = useConnectivity((s) => s.online);
  const mayApprove = usePermission('discount.override');
  const maySeeCost = usePermission('cost.view');

  const query = useDiscountApproval(id ?? '');
  const decide = useDecideApproval();
  const cancel = useCancelApproval();
  const [note, setNote] = useState('');

  const row = query.data;
  const now = new Date();

  const onDecide = async (approve: boolean) => {
    if (!row) return;
    const minutes = minutesLeft(row.expiresAt, now);

    const confirmed = approve
      ? await dialog.confirm({
          title: t('approvals.confirmTitle', { price: formatMoney(row.requestedPrice) }),
          message: [
            t('approvals.confirmBody', { price: formatMoney(row.requestedPrice), minutes }),
            // The loss, only for a reader the gate allowed to see cost.
            loss(row, maySeeCost) === null
              ? null
              : t('approval.needed.loss', { amount: formatMoney(loss(row, maySeeCost) as number) }),
          ]
            .filter(Boolean)
            .join('\n\n'),
          confirmLabel: t('approvals.confirmYes'),
          tone: row.belowCost ? 'danger' : 'default',
        })
      : await dialog.confirm({
          title: t('approvals.rejectTitle'),
          message: t('approvals.rejectBody'),
          confirmLabel: t('approvals.rejectYes'),
          tone: 'danger',
        });
    if (!confirmed) return;

    try {
      await decide.mutateAsync({
        id: row.id,
        approve,
        note: note.trim() || undefined,
        // The version the Owner was looking at. Two Owners answering at once
        // then produce one winner and one honest conflict.
        expectedVersion: row.version,
      });
      toast.success(approve ? t('approvals.approved') : t('approvals.rejected'));
      setNote('');
    } catch (e) {
      /*
       * `stale_version` and `approval_already_decided` are not errors to
       * apologise for — somebody else got there first. Re-read and show what is
       * actually true rather than leaving a dead button on screen.
       */
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'stale_version' || code === 'approval_already_decided') {
        toast.warning(t('approvals.conflict'));
        void query.refetch();
        return;
      }
      toast.error(toErrorMessage(e));
    }
  };

  const onCancel = async () => {
    if (!row) return;
    const confirmed = await dialog.confirm({
      title: t('approval.cancelTitle'),
      message: t('approval.cancelBody'),
      confirmLabel: t('approval.cancel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await cancel.mutateAsync(row.id);
      toast.success(t('approval.cancelled'));
      router.back();
    } catch (e) {
      toast.error(toErrorMessage(e));
    }
  };

  if (query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('approvals.title') }} />
        <SkeletonList count={3} />
      </Screen>
    );
  }

  if (query.isError || !row) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: t('approvals.title') }} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const view = viewOf(row, now);
  const percent = discountPercent(row);
  const lossAmount = loss(row, maySeeCost);
  const isMine = user?.id === row.requesterId;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t('approvals.title') }} />

      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text variant="title" style={styles.headerTitle}>
            {row.product
              ? [row.product.name, row.product.variant].filter(Boolean).join(' · ')
              : t('approvals.item')}
          </Text>
          <StatusChip domain="approval" value={view === 'lapsed' ? 'expired' : view} />
        </View>

        {row.identifier ? <Text variant="mono">{row.identifier}</Text> : null}

        <View style={styles.meta}>
          {row.requesterName ? (
            <Text tone="secondary">{t('approvals.askedBy', { name: row.requesterName })}</Text>
          ) : null}
          {row.branchName ? (
            <Text tone="secondary">{t('approvals.atBranch', { branch: row.branchName })}</Text>
          ) : null}
          {row.approverName && view !== 'pending' ? (
            <Text tone="secondary">{t('approvals.answeredBy', { name: row.approverName })}</Text>
          ) : null}
        </View>
      </Card>

      {/* The three numbers the decision is about, in the order it is read. */}
      <Card style={styles.card}>
        <Line label={t('approval.setPrice')} value={row.configuredPrice} />
        <Line label={t('approval.yourPrice')} value={row.approvedPrice ?? row.requestedPrice} emphasis />
        <Line
          label={t('approval.discount')}
          value={row.discountAmount}
          caption={percent === null ? undefined : t('approval.percentOff', { percent })}
        />
        {/*
          Cost and loss appear only when the gate let the figure through. For
          everybody else there is no placeholder and no dash — a blank where a
          number would be is itself a disclosure that one exists.
        */}
        {maySeeCost && row.unitCost !== undefined ? (
          <Line label={t('approvals.whatWePaid')} value={row.unitCost} />
        ) : null}
      </Card>

      {row.belowCost ? (
        <View style={styles.notice}>
          <InlineNotice tone="danger" title={t('approval.needed.title')}>
            {lossAmount === null
              ? t('approval.needed.enhanced')
              : t('approval.needed.loss', { amount: formatMoney(lossAmount) })}
          </InlineNotice>
        </View>
      ) : null}

      {row.reason ? (
        <Card style={styles.card}>
          <Text tone="secondary">{t('approval.reason')}</Text>
          <Text>{row.reason}</Text>
        </Card>
      ) : null}

      {row.decisionNote ? (
        <Card style={styles.card}>
          <Text tone="secondary">{t('approvals.note')}</Text>
          <Text>{row.decisionNote}</Text>
        </Card>
      ) : null}

      {/* What is still true about this request, said in words and not by colour. */}
      <View style={styles.notice}>
        <InlineNotice tone={noticeTone(view)}>{stateMessage(view, row, now, t)}</InlineNotice>
      </View>

      {isMine && mayApprove && view === 'pending' ? (
        <View style={styles.notice}>
          <InlineNotice tone="info">{t('approvals.ownRequest')}</InlineNotice>
        </View>
      ) : null}

      {!online ? (
        <View style={styles.notice}>
          <InlineNotice tone="warning">{t('approval.offline')}</InlineNotice>
        </View>
      ) : null}

      {canDecide(row, mayApprove, now) && online ? (
        <View style={styles.actions}>
          <TextField
            label={t('approvals.note')}
            placeholder={t('approvals.notePlaceholder')}
            value={note}
            onChangeText={setNote}
            maxLength={255}
          />
          <Button
            title={t('approvals.approve')}
            icon={Check}
            fullWidth
            loading={decide.isPending}
            onPress={() => void onDecide(true)}
          />
          <Button
            title={t('approvals.reject')}
            icon={X}
            variant="danger"
            fullWidth
            loading={decide.isPending}
            onPress={() => void onDecide(false)}
          />
        </View>
      ) : null}

      {canCancel(row, user?.id ?? null, now) && online ? (
        <View style={styles.actions}>
          <Button
            title={t('approval.cancel')}
            variant="secondary"
            fullWidth
            loading={cancel.isPending}
            onPress={() => void onCancel()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

/** The loss, or null when there is none or the reader may not see it. */
function loss(row: DiscountApproval, maySeeCost: boolean): number | null {
  return maySeeCost ? lossIfBelowCost(row) : null;
}

function noticeTone(view: ReturnType<typeof viewOf>): 'info' | 'success' | 'warning' | 'danger' | 'neutral' {
  switch (view) {
    case 'pending':
      return 'warning';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'consumed':
      return 'success';
    default:
      return 'neutral';
  }
}

/**
 * One sentence saying what is true now — and, where it matters, what to do.
 *
 * The six states stay separate here for the reason they stay separate on the
 * server: "expired" sends somebody back to ask again, "rejected" does not.
 */
function stateMessage(
  view: ReturnType<typeof viewOf>,
  row: DiscountApproval,
  now: Date,
  t: (key: never, values?: Record<string, string | number>) => string,
): string {
  switch (view) {
    case 'pending':
      return t('approval.state.pendingBody' as never);
    case 'approved':
      return t('approval.state.approvedBody' as never, {
        price: formatMoney(row.approvedPrice ?? row.requestedPrice),
        minutes: minutesLeft(row.expiresAt, now),
      });
    case 'rejected':
      return t('approval.state.rejectedBody' as never);
    case 'lapsed':
    case 'expired':
      return t('approval.state.expiredBody' as never);
    case 'consumed':
      return t('approval.state.consumedBody' as never);
    case 'voided':
    default:
      return row.voidReason
        ? t(`approval.void.${camel(String(row.voidReason))}` as never)
        : t('approval.state.voidedBody' as never);
  }
}

/** `price_changed` → `priceChanged`, so a void reason names its own sentence. */
function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function Line({
  label,
  value,
  caption,
  emphasis,
}: {
  label: string;
  value: number;
  caption?: string;
  emphasis?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <View style={styles.lineLabel}>
        <Text tone="secondary">{label}</Text>
        {caption ? <Text tone="secondary" variant="caption">{caption}</Text> : null}
      </View>
      <MoneyValue value={value} size={emphasis ? 'default' : 'small'} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.xs, marginBottom: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  headerTitle: { flexShrink: 1 },
  meta: { gap: space.xs, paddingTop: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  lineLabel: { flexShrink: 1 },
  notice: { marginBottom: space.sm },
  actions: { gap: space.sm, marginBottom: space.sm },
}));
