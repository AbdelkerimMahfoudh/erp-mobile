import React from 'react';
import { View } from 'react-native';
import { Store } from 'lucide-react-native';
import { Button, Text } from '../ui';
import { useOpeningFlow } from './useOpeningFlow';
import { useOpenClosing } from '../../lib/closing';
import { useConnectivity } from '../../lib/connectivity';
import type { GateReason } from '../../lib/day-gate';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useBranchActivity } from '../../lib/entitlement';
import { formatDate } from '../../lib/format';
import { useTranslation, type TranslationKey } from '../../lib/i18n';

/**
 * *Open store now*, beneath a locked Sell and Receive (2026-09-27, `docs/59` D76).
 *
 * The store waits for one of two things (docs/63): a closed day is opened again
 * — the reopen, by the Owner or a named delegate — and a day nobody has opened
 * yet is opened — by whoever counts. Either way it is the shared opening flow:
 * before 06:00 the day first, then the money the shop opens with, recorded with
 * the opening. Sell and Receive open on the server's answer, and the button
 * cannot be pressed twice in between. Somebody who may not open the store is
 * told who can, instead of being shown a dead button.
 *
 * This is the only way to the counter: the server refuses a sale, a receipt or
 * a later payment on a debt until the day is open, and nothing opens it by
 * itself (docs/61, docs/63).
 */
export interface OpenStoreNowProps {
  /** The day that waits, from the light business-day view. */
  businessDate: string;
  /** Closed and reopened, or not opened yet; an older server's lock is always the closed day. */
  reason?: GateReason;
  /** `closing.perform` for a closed day; `closing.count` for one not opened yet. */
  mayOpen: boolean;
  /** What the store being closed stops here, said to someone who may open it; Sell and Receive by default. */
  closedText?: string;
  /** Once the store is open — a screen holding refused work lets it be sent again, on purpose. */
  onOpened?: () => void;
}

const CLOSED: Record<'electronics' | 'money_agent' | 'both', TranslationKey> = {
  electronics: 'home.store.closed',
  money_agent: 'home.store.closed.agent',
  both: 'home.store.closed.both',
};
const NOT_OPENED: Record<'electronics' | 'money_agent' | 'both', TranslationKey> = {
  electronics: 'home.store.notOpened',
  money_agent: 'home.store.notOpened.agent',
  both: 'home.store.notOpened.both',
};

export function OpenStoreNow({ businessDate, reason = 'closed', mayOpen, closedText, onOpened }: OpenStoreNowProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  // The full day view — the choices, the next date, the store's clock, the amounts — only now that the counter waits.
  const view = useOpenClosing(undefined, { enabled: mayOpen });
  const day = view.data;
  const notOpened = reason === 'not_opened';
  const flow = useOpeningFlow({ intent: notOpened ? 'open' : 'reopen', day, onOpened });
  const date = formatDate(businessDate);
  // What the closed store stops, in the branch's own work: selling and receiving, exchanges, or both (D157).
  const activity = useBranchActivity();
  const waiting: TranslationKey = notOpened ? NOT_OPENED[activity] : CLOSED[activity];

  return (
    <View style={styles.block}>
      <Text variant="body" tone="secondary" align="center">
        {mayOpen
          ? (closedText ?? t(waiting, { date }))
          : t(notOpened ? 'home.store.notOpened.noPermission' : 'home.store.noPermission', { date })}
      </Text>
      {mayOpen ? (
        <Button
          title={t(notOpened ? 'closingHistory.open' : 'home.store.open')}
          icon={Store}
          size="lg"
          wrap
          fullWidth
          loading={flow.busy || (view.isPending && view.fetchStatus !== 'idle')}
          disabled={!online || !day || flow.busy}
          onPress={flow.start}
        />
      ) : null}
      {flow.element}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm },
}));
