import React from 'react';
import { View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { Button, EmptyState, InlineNotice, Section, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { dialog } from '../../lib/dialog';
import { toErrorMessage } from '../../lib/errors';
import { formatMoney, formatSmartDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useConnectivity } from '../../lib/connectivity';
import { toast } from '../../lib/toast';
import { useAnomalies, useDismissAnomaly, type Anomaly } from '../../lib/anomalies';

/**
 * "Needs your attention" — the six deterministic rules (A3).
 *
 * ## What this is not
 *
 * Not a score, not a ranking, not a prediction. Six sentences, each carrying
 * the numbers that produced it, so a shopkeeper can check the claim instead of
 * trusting it. The server decides which of the six this person may see — the
 * two involving margin and cost never leave it for anybody else — so this
 * component renders whatever arrives and gates nothing itself.
 *
 * ## Blank when offline, deliberately
 *
 * These are worked out from figures that move all day. A cached anomaly is a
 * claim about yesterday's cash, and a stale warning about money is worse than
 * none — so disconnected this says why it is empty rather than showing
 * something that used to be true.
 *
 * ## Dismissing is a snooze
 *
 * Seven days, for the whole shop, audited. It is how a false positive stops
 * being noise without anybody having to pretend it was wrong.
 */
export function AttentionList() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const query = useAnomalies();
  const dismiss = useDismissAnomaly();

  const rows = query.data?.rows ?? [];

  const onDismiss = async (row: Anomaly) => {
    const confirmed = await dialog.confirm({
      title: t('attention.dismissTitle'),
      message: t('attention.dismissBody'),
      confirmLabel: t('attention.dismiss'),
    });
    if (!confirmed) return;
    try {
      await dismiss.mutateAsync(row.key);
      toast.success(t('attention.dismissed'));
    } catch (e) {
      toast.error(toErrorMessage(e));
    }
  };

  return (
    <Section
      icon={<TriangleAlert size={18} color={colors.semantic.warning} />}
      title={t('attention.title')}
    >
      {!online ? (
        <InlineNotice tone="neutral">{t('attention.offline')}</InlineNotice>
      ) : rows.length === 0 ? (
        <EmptyState title={t('attention.empty')} body={t('attention.emptyBody')} />
      ) : (
        <View style={styles.list}>
          {rows.map((row) => (
            <Row key={row.key} row={row} onDismiss={() => void onDismiss(row)} />
          ))}
          {query.data?.generatedAt ? (
            /*
             * When this was worked out. A panel of figures with no timestamp
             * invites somebody to act at four o'clock on the morning's numbers.
             */
            <Text variant="caption" tone="tertiary">
              {t('attention.asOf', { time: formatSmartDateTime(query.data.generatedAt) })}
            </Text>
          ) : null}
        </View>
      )}
    </Section>
  );
}

function Row({ row, onDismiss }: { row: Anomaly; onDismiss: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();

  /*
   * Money in the parameters is formatted here, not by the server. The server
   * sends a number; how many decimals and which separator a reader expects is a
   * question about their locale, and it already has one answer in `formatMoney`.
   */
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(row.params)) {
    values[key] = key === 'amount' && typeof value === 'number' ? formatMoney(value) : value;
  }

  return (
    <View style={styles.row}>
      <InlineNotice
        tone={row.severity === 'caution' ? 'warning' : 'info'}
        action={
          <Button title={t('attention.dismiss')} variant="tertiary" size="sm" onPress={onDismiss} />
        }
      >
        {t(row.messageKey as never, values)}
      </InlineNotice>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: { gap: space.sm },
  row: {},
}));
