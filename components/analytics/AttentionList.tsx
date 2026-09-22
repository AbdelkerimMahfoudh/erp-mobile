import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { Button, EmptyState, InlineNotice, RowGroup, Section, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { makeStyles, useColors } from '../../lib/design/theme';
import { toErrorMessage } from '../../lib/errors';
import { formatSmartDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { useConnectivity } from '../../lib/connectivity';
import { attentionPreview } from '../../lib/attention-rules';
import { useAnomalies } from '../../lib/anomalies';
import { AlertRow, useAcknowledge } from './AlertRow';

/**
 * "Needs your attention" — the newest three, and a way to the rest (A3).
 *
 * ## What this is not
 *
 * Not a score, not a ranking, not a prediction. A few sentences, each carrying
 * the numbers that produced it, so a shopkeeper can check the claim instead of
 * trusting it. The server decides which rules this person may see — the two
 * involving margin and cost never leave it for anybody else — and it orders
 * them, newest first; this component renders what arrives and re-sorts nothing.
 *
 * ## Three, not all
 *
 * The overview is for glancing. Twelve warnings in a column of notices pushed
 * every chart off the screen, and a panel somebody has to scroll past is a
 * panel nobody reads. So: the three newest in one compact surface, and "View
 * all 12" only when there is a fourth.
 *
 * ## Blank when offline, deliberately
 *
 * These are worked out from figures that move all day. A cached anomaly is a
 * claim about yesterday's cash, and a stale warning about money is worse than
 * none — so disconnected this says why it is empty rather than showing
 * something that used to be true.
 */
export function AttentionList() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const online = useConnectivity((s) => s.online);
  const query = useAnomalies();
  const { acknowledge, pendingKey } = useAcknowledge();

  const preview = attentionPreview(query.data?.rows ?? [], query.data?.total ?? 0);

  return (
    <Section
      icon={<TriangleAlert size={18} color={colors.semantic.warning} />}
      title={t('attention.title')}
      action={
        preview.showAll ? (
          <Button
            title={t('attention.viewAll', { count: String(preview.total) })}
            variant="tertiary"
            size="sm"
            onPress={() => router.push('/alerts' as never)}
          />
        ) : undefined
      }
    >
      {!online ? (
        <InlineNotice tone="neutral">{t('attention.offline')}</InlineNotice>
      ) : query.isError ? (
        <InlineNotice tone="danger">{toErrorMessage(query.error)}</InlineNotice>
      ) : preview.shown.length === 0 ? (
        <EmptyState title={t('attention.empty')} body={t('attention.emptyBody')} size="inline" />
      ) : (
        <View style={styles.list}>
          <RowGroup separatorInset={0}>
            {preview.shown.map((row) => (
              <AlertRow key={row.key} row={row} pending={pendingKey === row.key} onAcknowledge={(r) => void acknowledge(r)} />
            ))}
          </RowGroup>
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

const useStyles = makeStyles(() => ({
  list: { gap: space.sm },
}));
