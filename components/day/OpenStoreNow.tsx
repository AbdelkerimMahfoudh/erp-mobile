import React, { useState } from 'react';
import { View } from 'react-native';
import { Store } from 'lucide-react-native';
import { Button, Text } from '../ui';
import { DayChoiceSheet } from '../closing/DayChoiceSheet';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { useConnectivity } from '../../lib/connectivity';
import { useOpenClosing, useReopenDay } from '../../lib/closing';
import type { ReopenMode } from '../../lib/home-day';

/**
 * *Open store now*, beneath a locked Sell and Receive (2026-09-27, `docs/59` D76).
 *
 * The existing reopen flow, as the Daily closing has it: before 06:00, when the
 * Owner may start the next day early, the choice sheet asks which business day
 * new sales use; otherwise one confirmation. The reopen finishes only once the
 * day has been read again, so Sell and Receive open on the server's answer and
 * the button cannot be pressed twice in between. Somebody who may not open the
 * store is told who can, instead of being shown a dead button.
 *
 * This is the only way back to the counter: the server refuses a sale, a
 * receipt or a later payment on a debt while the day is closed, and nothing
 * reopens it by itself (docs/61).
 */
export interface OpenStoreNowProps {
  /** The closed business day, from the light business-day view. */
  businessDate: string;
  /** `closing.perform`: the Owner or a named delegate. */
  mayOpen: boolean;
  /** What the store being closed stops here, said to someone who may open it; Sell and Receive by default. */
  closedText?: string;
  /** Once the store is open again — a screen holding refused work lets it be sent again, on purpose. */
  onOpened?: () => void;
}

export function OpenStoreNow({ businessDate, mayOpen, closedText, onOpened }: OpenStoreNowProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const reopen = useReopenDay();
  // The full day view — the choices, the next date, the store's clock — only now that the counter is locked.
  const view = useOpenClosing(undefined, { enabled: mayOpen });
  const day = view.data;
  const [sheet, setSheet] = useState(false);
  /** Remounts the choice sheet each time it is asked for, so the safe default is selected again. */
  const [nonce, setNonce] = useState(0);
  const [asking, setAsking] = useState(false);
  const date = formatDate(businessDate);

  const confirm = async (mode: ReopenMode) => {
    try {
      await reopen.mutateAsync(mode);
      setSheet(false);
      onOpened?.();
      toast.success(mode === 'start_new' && day ? t('reopen.started', { date: formatDate(day.nextDate) }) : t('reopen.done', { date }));
    } catch (e) {
      toast.error(toFriendlyError(e).body || t('reopen.failed'));
    }
  };
  const onPress = async () => {
    if (!day) return;
    if (day.reopenChoices.includes('start_new')) {
      setNonce((n) => n + 1);
      setSheet(true);
      return;
    }
    setAsking(true);
    const ok = await dialog.confirm({
      title: t('reopen.simple.title', { date }),
      message: t('reopen.simple.body'),
      confirmLabel: t('reopen.confirm'),
      cancelLabel: t('action.cancel'),
    });
    setAsking(false);
    if (ok) await confirm('continue');
  };

  return (
    <View style={styles.block}>
      <Text variant="body" tone="secondary" align="center">
        {mayOpen ? (closedText ?? t('home.store.closed', { date })) : t('home.store.noPermission', { date })}
      </Text>
      {mayOpen ? (
        <Button
          title={t('home.store.open')}
          icon={Store}
          size="lg"
          fullWidth
          loading={reopen.isPending || (view.isPending && view.fetchStatus !== 'idle')}
          disabled={!online || !day || reopen.isPending || asking}
          onPress={() => void onPress()}
        />
      ) : null}
      {day ? (
        <DayChoiceSheet
          key={nonce}
          intent="reopen"
          open={sheet}
          onClose={() => setSheet(false)}
          businessDate={day.businessDate}
          nextDate={day.nextDate}
          calendarDate={day.localNowDate}
          now={day.localNow}
          choices={day.reopenChoices}
          busy={reopen.isPending}
          onConfirm={(mode) => void confirm(mode)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  block: { gap: space.sm },
}));
