import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '../overlay/BottomSheet';
import { Button, Chip, Divider, InlineNotice, MoneyValue, Text, TextField, Toggle } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { isolateLtr } from '../../lib/design/direction';
import { formatDate, formatMoney } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { toFriendlyError } from '../../lib/errors';
import { ApiError } from '../../lib/api-client';
import { uuidv4 } from '../../lib/utils';
import { canConfirmClose, channelLabel, verificationKey, verificationTone, warningKey, type Freshness } from '../../lib/closing-report-view';
import { useCloseDay, type DailyReport } from '../../lib/closing-report';

/**
 * "Review and close" (docs/51 D2, D5).
 *
 * The final report in a few lines, the warnings that matter, and — when some
 * balance was not physically checked — the list of them, an explicit
 * acknowledgement and a reason. Nothing is disabled because a count is missing:
 * counts are optional. The confirm button waits only for live figures and, when
 * needed, the acknowledgement.
 *
 * One idempotency key per opening of the sheet: a double tap, or a retry after a
 * lost response, replays the close the server already made instead of failing.
 */
export interface CloseReviewSheetProps {
  open: boolean;
  onClose: () => void;
  report: DailyReport;
  freshness: Freshness;
  /** Refetch the report — after the server says the figures moved. */
  onChanged: () => void;
}

export function CloseReviewSheet({ open, onClose, report, freshness, onChanged }: CloseReviewSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const close = useCloseDay(report.isToday ? undefined : report.date);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  // A fresh key each time the sheet opens; the same key for every retry while it is open.
  const clientUuid = useMemo(() => (open ? uuidv4() : ''), [open]);
  /** Closing the sheet forgets the acknowledgement: the next review starts from nothing. */
  const dismiss = () => {
    setAcknowledged(false);
    setReason('');
    onClose();
  };

  const words = { cash: t('closing.channel.cash'), unattributed: t('closing.channel.unattributed') };
  const needsAck = report.close?.requiresAcknowledgement ?? false;
  const unverified = (report.close?.unverified ?? []).map((key) => {
    const channel = report.money.channels.find((c) => c.key === key);
    const verification = key === 'cash:NONE' ? report.expected.cash.verification : (report.expected.accounts.find((a) => a.key === key)?.verification ?? 'not_counted');
    return { key, label: channel ? channelLabel(channel, words) : key, verification };
  });
  const enabled = canConfirmClose({
    canClose: report.close?.canClose ?? false,
    freshness,
    requiresAcknowledgement: needsAck,
    acknowledged,
    reason,
    busy: close.isPending,
  });
  const warnings = report.warnings.filter((w) => w.severity !== 'info' && w.code !== 'channels_not_verified');
  const money = (v: number) => isolateLtr(formatMoney(v));
  const params = (p?: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, typeof v === 'number' && k !== 'count' && k !== 'days' ? money(v) : String(v)]));

  const confirm = async () => {
    try {
      const done = await close.mutateAsync({
        date: report.date,
        clientUuid,
        reportVersion: report.reportVersion,
        ...(needsAck ? { acknowledgeUnverified: true, reason: reason.trim() } : {}),
      });
      toast.success(t('closeReview.done', { date: formatDate(done.date) }));
      dismiss();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'report_changed') {
        toast.error(t('closeReview.changed'));
        onChanged();
        return;
      }
      toast.error(toFriendlyError(e).body || t('closeReview.failed'));
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={dismiss}
      title={t('closeReview.title', { date: formatDate(report.date) })}
      subtitle={t('closeReview.subtitle')}
      footer={
        <View style={styles.footer}>
          {freshness === 'offline' ? (
            <Text variant="caption" tone="secondary" align="center">
              {t('closing.offline')}
            </Text>
          ) : freshness === 'stale' ? (
            <Text variant="caption" tone="secondary" align="center">
              {t('closeReview.stale')}
            </Text>
          ) : null}
          <Button title={t('closeReview.confirm')} fullWidth loading={close.isPending} disabled={!enabled} onPress={() => void confirm()} />
          <Text variant="caption" tone="tertiary" align="center">
            {t('closeReview.selling')}
          </Text>
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.lines}>
          {report.sales ? <Line label={t('closeReview.sales')} value={report.sales.value} /> : null}
          <Line label={t('closeReview.received')} value={report.money.totals.in} />
          <Line label={t('closeReview.paidOut')} value={report.money.totals.out} />
          <Divider />
          <Line label={t(report.expected.cash.opening.anchorDate === null ? 'dailyReport.expected.movementFromZero' : 'closeReview.expected')} value={report.expected.cash.expected} strong />
          {report.result.status === 'ok' ? <Line label={t('closeReview.result')} value={report.result.resultAfterExpenses ?? 0} strong signed /> : null}
        </View>

        {warnings.map((w) => (
          <InlineNotice key={w.code} tone={w.severity === 'error' ? 'danger' : 'warning'}>
            {t(warningKey(w.code) as never, params(w.params))}
          </InlineNotice>
        ))}

        {needsAck ? (
          <View style={styles.unverified}>
            <Text variant="bodyStrong">{t('closeReview.unverified.title')}</Text>
            {unverified.map((u) => (
              <View key={u.key} style={styles.between}>
                <Text variant="body" style={styles.flex}>
                  {u.label}
                </Text>
                <Chip tone={verificationTone(u.verification, null)} label={t(verificationKey(u.verification) as never)} size="sm" dot />
              </View>
            ))}
            <Text variant="caption" tone="secondary">
              {t('closeReview.unverified.body')}
            </Text>
            <Toggle label={t('closeReview.acknowledge')} value={acknowledged} onValueChange={setAcknowledged} />
            <TextField
              label={t('closeReview.reason')}
              value={reason}
              onChangeText={setReason}
              placeholder={t('closeReview.reason.placeholder')}
              maxLength={255}
            />
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function Line({ label, value, strong, signed }: { label: string; value: number; strong?: boolean; signed?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.between}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'primary' : 'secondary'} style={styles.flex}>
        {label}
      </Text>
      <MoneyValue value={value} size={strong ? 'default' : 'small'} signed={signed} tone={signed ? 'auto' : 'default'} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: space.md, paddingVertical: space.sm },
  lines: { gap: space.sm },
  unverified: { gap: space.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  flex: { flex: 1, minWidth: 0 },
  footer: { gap: space.sm },
}));
