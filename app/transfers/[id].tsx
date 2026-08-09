import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Send, Truck, X } from 'lucide-react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  Identifier,
  Screen,
  Section,
  SkeletonList,
  StatusChip,
  Text,
} from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatSmartDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { isStaleTransfer, useTransfer, useTransferAction } from '../../lib/transfers';
import type { TransferAction, TransferActionName, TransferDetail } from '../../types/api';

/**
 * One transfer, and what this person may do with it right now.
 *
 * **The server decides availability.** Each action arrives with `allowed`, a
 * reason, and the branch it must be performed from. The screen renders that
 * answer rather than re-deriving it — the client knowing its own permissions is
 * not the same as knowing the transfer's state, and two sources of truth is how
 * a button appears that will 403.
 *
 * A notification can land here while the app is pointed at the other branch.
 * That is the normal case, not an error: the screen explains where the action
 * belongs and offers to switch, and never switches silently.
 */
export default function TransferDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useTransfer(id);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: t('transfers.detail.title') }} />

      {query.isLoading ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403) ? (
          // An answer about this transfer, not a fault. Retry would only ask again.
          <EmptyState title={t('transfers.notFound')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : query.data ? (
        <Detail transfer={query.data} onRefresh={() => void query.refetch()} />
      ) : null}
    </Screen>
  );
}

function Detail({ transfer, onRefresh }: { transfer: TransferDetail; onRefresh: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const branchName = useBranch((s) => s.branchName);
  const clearBranch = useBranch((s) => s.clear);
  const action = useTransferAction();
  /** Guards against a double tap firing two requests before the first answers. */
  const [busy, setBusy] = useState<TransferActionName | null>(null);

  /**
   * Which action the user most likely came here to do — the one whose button
   * gets the branch prompt. Order follows the lifecycle.
   */
  const primary: TransferActionName[] = ['approve', 'reject', 'ship', 'receive', 'cancel'];
  const blockedOnBranch = primary
    .map((name) => transfer.actions[name])
    .find((a) => a.reason === 'branch');

  const confirmFor = async (name: TransferActionName): Promise<{ go: boolean; reason?: string }> => {
    const common = { from: transfer.from.name, to: transfer.to.name };
    switch (name) {
      case 'approve': {
        const ok = await dialog.confirm({
          title: t('transfers.confirm.approve.title'),
          message: t('transfers.confirm.approve.body', common),
          confirmLabel: t('transfers.action.approve'),
          cancelLabel: t('action.cancel'),
        });
        return { go: ok };
      }
      case 'reject': {
        // A refusal without a reason is how the same request comes back next week.
        const r = await dialog.confirmWithReason({
          title: t('transfers.confirm.reject.title'),
          message: t('transfers.confirm.reject.body', common),
          confirmLabel: t('transfers.action.reject'),
          cancelLabel: t('action.cancel'),
          reasonLabel: t('transfers.confirm.reject.reason'),
          reasonPlaceholder: t('transfers.reason.placeholder'),
          tone: 'danger',
        });
        return { go: r.confirmed && Boolean(r.reason?.trim()), reason: r.reason };
      }
      case 'ship': {
        // Shipping is a claim about the physical world, so ask about the physical world.
        const ok = await dialog.confirm({
          title: t('transfers.confirm.ship.title', common),
          message: t('transfers.confirm.ship.body', common),
          confirmLabel: t('transfers.action.ship'),
          cancelLabel: t('action.cancel'),
        });
        return { go: ok };
      }
      case 'receive': {
        const ok = await dialog.confirm({
          title: t('transfers.confirm.receive.title', common),
          message: t('transfers.confirm.receive.body'),
          confirmLabel: t('transfers.action.receive'),
          cancelLabel: t('action.cancel'),
        });
        return { go: ok };
      }
      case 'cancel': {
        const r = await dialog.confirmWithReason({
          title: t('transfers.confirm.cancel.title'),
          message: t('transfers.confirm.cancel.body', common),
          confirmLabel: t('transfers.action.cancel'),
          cancelLabel: t('transfers.new.keep'),
          reasonLabel: t('transfers.confirm.cancel.reason'),
          reasonPlaceholder: t('transfers.reason.placeholder'),
          tone: 'danger',
        });
        return { go: r.confirmed && Boolean(r.reason?.trim()), reason: r.reason };
      }
    }
  };

  const run = async (name: TransferActionName) => {
    if (busy) return;
    const { go, reason } = await confirmFor(name);
    if (!go) return;

    setBusy(name);
    try {
      await action.mutateAsync({
        id: transfer.id,
        action: name,
        // The version this screen was rendered from. If anything moved since,
        // the server refuses rather than overwriting somebody's decision.
        expectedVersion: transfer.version,
        reason,
        // Receiving confirms what physically arrived. Serialized-only in H1.3,
        // so that is every listed item; partial receipt is future work.
        identifiers:
          name === 'receive'
            ? transfer.items.map((i) => i.identifier).filter((v): v is string => Boolean(v))
            : undefined,
      });
    } catch (error) {
      if (isStaleTransfer(error)) {
        /**
         * Someone else acted while this screen was open. Show where it stands
         * now rather than refreshing and resubmitting — that would replay an
         * intent formed against a state that no longer exists.
         */
        await dialog.alert({
          title: t('transfers.conflict.title'),
          message: t('transfers.conflict.body'),
        });
        onRefresh();
        return;
      }
      toast.error(toFriendlyError(error).body);
    } finally {
      setBusy(null);
    }
  };

  const switchBranch = () => {
    // Never silently. The user chooses, and lands on the picker.
    clearBranch();
    router.replace('/select-branch');
  };

  return (
    <>
      <Section>
        <Card>
          <View style={styles.head}>
            <StatusChip domain="transfer" value={transfer.status} />
            {transfer.autoApproved ? (
              <Chip label={t('transfers.autoApproved')} tone="neutral" size="sm" />
            ) : null}
          </View>
          <Text variant="title" style={styles.ref}>
            {transfer.transferNo ?? t('transfers.detail.title')}
          </Text>
          <Text tone="secondary">
            {t('transfers.route', { from: transfer.from.name, to: transfer.to.name })}
          </Text>
          {transfer.decisionReason ? (
            <View style={styles.reason}>
              <Text variant="caption" tone="tertiary">
                {t('transfers.detail.reason')}
              </Text>
              <Text tone="secondary">{transfer.decisionReason}</Text>
            </View>
          ) : null}
        </Card>
      </Section>

      {/*
        The wrong-branch case, explained once at the top rather than repeated on
        every disabled button. Switching is an explicit choice.
      */}
      {blockedOnBranch ? (
        <Section>
          <Card>
            <Text variant="bodyStrong">
              {t('transfers.wrongBranch.title', { current: branchName ?? '—' })}
            </Text>
            <Text tone="secondary" style={styles.gapTop}>
              {t('transfers.wrongBranch.body', { branch: blockedOnBranch.branchName })}
            </Text>
            <Button
              title={t('transfers.switchBranch', { branch: blockedOnBranch.branchName })}
              variant="secondary"
              onPress={switchBranch}
              style={styles.gapTop}
            />
          </Card>
        </Section>
      ) : null}

      <Actions transfer={transfer} busy={busy} onRun={run} />

      <Section title={t('transfers.detail.items')}>
        <Card>
          {transfer.items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.item}>
                <View style={styles.itemBody}>
                  <Text variant="bodyStrong">{item.product ?? '—'}</Text>
                  {item.identifier ? <Identifier>{item.identifier}</Identifier> : null}
                </View>
                {item.unitStatus ? (
                  <StatusChip domain="unit" value={item.unitStatus} size="sm" />
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      </Section>

      <Section title={t('transfers.detail.history')}>
        <Card>
          <Timeline transfer={transfer} />
        </Card>
      </Section>
    </>
  );
}

/**
 * Only actions the server says are possible get a button. An action refused for
 * status is not shown at all — a finished transfer showing five greyed-out
 * buttons is noise. Permission and ownership refusals ARE shown, as a sentence,
 * because otherwise the user simply wonders where the button went.
 */
function Actions({
  transfer,
  busy,
  onRun,
}: {
  transfer: TransferDetail;
  busy: TransferActionName | null;
  onRun: (name: TransferActionName) => void;
}) {
  const { t } = useTranslation();

  const meta: Record<TransferActionName, { icon: typeof Check; variant: 'primary' | 'secondary' | 'danger' }> = {
    approve: { icon: Check, variant: 'primary' },
    reject: { icon: X, variant: 'danger' },
    ship: { icon: Send, variant: 'primary' },
    receive: { icon: Truck, variant: 'primary' },
    cancel: { icon: X, variant: 'danger' },
  };

  const order: TransferActionName[] = ['approve', 'ship', 'receive', 'reject', 'cancel'];
  const visible = order.filter((name) => transfer.actions[name].reason !== 'status');
  if (visible.length === 0) return null;

  const explained = new Set<string>();

  return (
    <Section>
      <View style={styles.actions}>
        {visible.map((name) => {
          const a: TransferAction = transfer.actions[name];
          if (a.allowed) {
            return (
              <Button
                key={name}
                title={t(`transfers.action.${name}` as never)}
                icon={meta[name].icon}
                variant={meta[name].variant}
                loading={busy === name}
                // Any action in flight disables the rest: two lifecycle writes
                // from one screen would race each other on purpose.
                disabled={busy !== null}
                onPress={() => onRun(name)}
              />
            );
          }
          // One sentence per distinct reason, not one per hidden button.
          if (a.reason === 'branch' || !a.reason || explained.has(a.reason)) return null;
          explained.add(a.reason);
          return (
            <Text key={name} tone="secondary" variant="caption">
              {t(`transfers.blocked.${a.reason}` as never, { branch: a.branchName })}
            </Text>
          );
        })}
      </View>
    </Section>
  );
}

/** What happened, in the order it happened. Audit-friendly, and no money. */
function Timeline({ transfer }: { transfer: TransferDetail }) {
  const { t } = useTranslation();
  const who = (name: string | null) => name ?? t('transfers.person.unknown');

  const events: { at: string | null; label: string }[] = [
    {
      at: transfer.timestamps.requestedAt,
      label: t('transfers.event.requested', { name: who(transfer.people.requestedBy) }),
    },
    {
      at: transfer.timestamps.approvedAt,
      label: t('transfers.event.approved', { name: who(transfer.people.approvedBy) }),
    },
    {
      at: transfer.timestamps.sentAt,
      label: t('transfers.event.shipped', { name: who(transfer.people.sentBy) }),
    },
    {
      at: transfer.timestamps.receivedAt,
      label: t('transfers.event.received', { name: who(transfer.people.receivedBy) }),
    },
    {
      at: transfer.timestamps.decidedAt,
      label: t(
        transfer.status === 'rejected' ? 'transfers.event.rejected' : 'transfers.event.cancelled',
        { name: who(transfer.people.decidedBy) },
      ),
    },
  ];

  return (
    <>
      {events
        .filter((e): e is { at: string; label: string } => Boolean(e.at))
        .map((e, index) => (
          <View key={e.at} style={index > 0 ? styles.gapTop : undefined}>
            <Text variant="bodyStrong">{e.label}</Text>
            <Text variant="caption" tone="tertiary">
              {formatSmartDateTime(e.at)}
            </Text>
          </View>
        ))}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  ref: { marginTop: space.sm },
  reason: { marginTop: space.base, gap: space.xs },
  gapTop: { marginTop: space.sm },
  actions: { gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  itemBody: { flex: 1, gap: space.xs },
});
