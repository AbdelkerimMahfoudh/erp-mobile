import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  InlineNotice,
  MoneyValue,
  StatusChip,
  Text,
  TextField,
} from '../ui';
import { BottomSheet } from '../overlay';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useConnectivity } from '../../lib/connectivity';
import { usePermission } from '../../lib/permissions';
import { toast } from '../../lib/toast';
import { uuidv4 } from '../../lib/utils';
import { useApprovalsForUnit, useRequestApproval } from '../../lib/discount-approvals';
import {
  approvalFor,
  discountPercent,
  minutesLeft,
  pendingFor,
  viewOf,
  type DiscountApproval,
} from '../../lib/discount-approval-state';

/**
 * Asking the Owner, without leaving the sale (A2/CP4).
 *
 * The server refused the sale with `approval_required` and said which line,
 * which unit, what the set price is and whether this is below cost. That
 * refusal is the only reason this opens — the phone never decides on its own
 * that an approval is needed, because the floor is the ladder's answer and only
 * the server resolves the ladder.
 *
 * ## What it shows, and why in this order
 *
 * The set price, then the price being asked for, then the difference. That is
 * the order the question is asked in — "it costs this, they want to pay that,
 * so we are giving up this much" — and the percentage is there because a
 * shopkeeper judges a discount as a proportion, not as an amount.
 *
 * ## Cost, and the two versions of the same warning
 *
 * Below cost, a reader with `cost.view` is shown the loss. Everybody else is
 * told a stronger approval is needed and shown no figure at all. Both are true;
 * only one discloses what the shop pays. The server decides which by whether it
 * sent `unitCost` — the app never estimates the missing one.
 *
 * ## Submitting is not being approved
 *
 * After the request goes in, this shows **Waiting for the Owner** and keeps
 * saying that nothing has been sold. The only thing that turns it into
 * "approved" is the server's own row coming back approved, and even then the
 * sale is completed by re-submitting it — the Owner's yes and the sale are two
 * separate events, and pretending otherwise is how a customer walks out with a
 * phone that was never sold.
 */

export interface ApprovalRequest {
  /** The physical unit, from the server's refusal. */
  unitId: string;
  /** What the counter is showing for it. */
  label: string;
  identifier: string | null;
  /** The ladder's answer, from the refusal — never guessed here. */
  configuredPrice: number | null;
  proposedPrice: number;
  belowCost: boolean;
}

export interface ApprovalRequestSheetProps {
  request: ApprovalRequest | null;
  onClose: () => void;
  /** Called once the server says approved, so the sale can be completed. */
  onApproved: (approval: DiscountApproval) => void;
}

export function ApprovalRequestSheet({ request, onClose, onApproved }: ApprovalRequestSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const maySeeCost = usePermission('cost.view');
  const submit = useRequestApproval();
  const [reason, setReason] = useState('');

  /*
   * One key for one asking. A retried tap replays the original request rather
   * than creating a second one the Owner would have to answer twice — and a
   * changed price under the same key is refused by the server as the client bug
   * it would be.
   */
  const clientUuid = useRef(uuidv4());

  const outstanding = useApprovalsForUnit(request?.unitId ?? null);
  const rows = outstanding.data ?? [];
  const now = new Date();

  const live = useMemo(() => {
    if (!request) return null;
    return (
      approvalFor(rows, request.unitId, request.proposedPrice, now) ??
      pendingFor(rows, request.unitId, request.proposedPrice, now) ??
      /*
       * Nothing live for this exact price. A decided request for the same unit
       * is still worth showing — "the Owner said no" is the answer to the
       * question that was asked, and hiding it would send the seller round the
       * loop again.
       */
      rows.find((r) => r.unitId === request.unitId) ??
      null
    );
    // `now` is deliberately not a dependency: it is read, not watched. The
    // polling query is what re-renders this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, rows]);

  const view = live ? viewOf(live, now) : null;

  React.useEffect(() => {
    if (live && view === 'approved') onApproved(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.id, view]);

  if (!request) return null;

  const percent =
    request.configuredPrice === null
      ? null
      : discountPercent({
          configuredPrice: request.configuredPrice,
          requestedPrice: request.proposedPrice,
        });

  const needsReason = request.belowCost;
  const canSubmit =
    online && !submit.isPending && (!needsReason || reason.trim().length > 0) && !live;

  const ask = async () => {
    try {
      await submit.mutateAsync({
        unitId: request.unitId,
        requestedPrice: request.proposedPrice,
        reason: reason.trim() || undefined,
        clientUuid: clientUuid.current,
      });
      toast.success(t('approval.asked'));
    } catch (e) {
      toast.error(toErrorMessage(e) || t('approval.askFailed'));
    }
  };

  return (
    <BottomSheet open onClose={onClose} title={t('approval.needed.title')}>
      <View style={styles.body}>
        <Text tone="secondary">{t('approval.needed.body')}</Text>

        <View style={styles.item}>
          <Text variant="bodyStrong">{request.label}</Text>
          {request.identifier ? <Text variant="mono">{request.identifier}</Text> : null}
        </View>

        {request.configuredPrice !== null ? (
          <Line label={t('approval.setPrice')} value={request.configuredPrice} />
        ) : null}
        <Line label={t('approval.yourPrice')} value={request.proposedPrice} emphasis />
        {request.configuredPrice !== null ? (
          <Line
            label={t('approval.discount')}
            value={request.configuredPrice - request.proposedPrice}
            caption={percent === null ? undefined : t('approval.percentOff', { percent })}
          />
        ) : null}

        {request.belowCost ? (
          <InlineNotice tone="danger">
            {/*
              Two versions of one truth. The loss for whoever may see cost; for
              everybody else, that a stronger approval is needed — which is
              equally true and reveals nothing about what the shop pays.
            */}
            {maySeeCost && live?.unitCost !== undefined
              ? t('approval.needed.loss', {
                  amount: formatMoney(live.unitCost - request.proposedPrice),
                })
              : t('approval.needed.enhanced')}
          </InlineNotice>
        ) : null}

        {!online ? <InlineNotice tone="warning">{t('approval.offline')}</InlineNotice> : null}

        {live ? (
          <View style={styles.state}>
            <StatusChip domain="approval" value={view === 'lapsed' ? 'expired' : (view as string)} />
            <Text tone="secondary">{message(view, live, now, t)}</Text>
          </View>
        ) : (
          <>
            <TextField
              label={t('approval.reason')}
              placeholder={t('approval.reasonPlaceholder')}
              hint={needsReason ? t('approval.reasonRequired') : undefined}
              required={needsReason}
              value={reason}
              onChangeText={setReason}
              maxLength={255}
              multiline
            />
            <Button
              title={submit.isPending ? t('approval.asking') : t('approval.ask')}
              fullWidth
              disabled={!canSubmit}
              loading={submit.isPending}
              onPress={() => void ask()}
            />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

/** The one sentence that is true right now. Never "not approved" for all four. */
function message(
  view: ReturnType<typeof viewOf> | null,
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
    default:
      return t('approval.state.voidedBody' as never);
  }
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
        {caption ? (
          <Text tone="secondary" variant="caption">
            {caption}
          </Text>
        ) : null}
      </View>
      <MoneyValue value={value} size={emphasis ? 'default' : 'small'} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: space.sm },
  item: { gap: space.xs },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  lineLabel: { flexShrink: 1 },
  state: { gap: space.xs, alignItems: 'flex-start' },
}));
