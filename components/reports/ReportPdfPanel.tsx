import React, { useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { FileText } from 'lucide-react-native';
import { Button, Card, InlineNotice, ListRow, RowGroup, Text } from '../ui';
import { ApiError } from '../../lib/api-client';
import { useConnectivity } from '../../lib/connectivity';
import { isolateLtr } from '../../lib/design/direction';
import { space } from '../../lib/design/tokens';
import { makeStyles } from '../../lib/design/theme';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import type { ReportRequest } from '../../lib/report-document';
import type { GeneratedReport } from '../../lib/report-pdf-flow';
import { canShareReportPdf, makeReportPdf, openReportPdf, shareReportPdf } from '../../lib/report-pdf';

/**
 * Generate PDF — the report on screen, as a file (docs/66).
 *
 * One row, then the finished file in place: Open to read it, Share or save to hand it to
 * the operating system's sheet, where the person chooses Files, Mail or a chat app. No
 * destination is chosen for them and nothing is sent by the app. On the web the page opens
 * in a new tab, where the browser's Print saves it as a PDF.
 *
 * The parent shows this only to somebody the server will give the document to; the server
 * checks again regardless. A new PDF is asked for each time — the figures of a live day
 * move — and whatever goes wrong while making, opening or sharing one changes nothing in
 * the shop: the flow only reads.
 */
export function ReportPdfPanel({ request, subtitle }: { request: ReportRequest; subtitle: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const online = useConnectivity((s) => s.online);
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'ready'; report: GeneratedReport } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const busy = state.kind === 'busy';

  const reason = (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.status === 401) return t('reports.error.signedOut');
      if (error.status === 403) return t('reports.error.notAllowed');
      return t('reportPdf.error.failed');
    }
    if (error instanceof Error && /network|fetch|timed? ?out/i.test(error.message)) return t('reports.error.offline');
    return t('reportPdf.error.failed');
  };

  const generate = async () => {
    if (busy) return;
    setState({ kind: 'busy' });
    try {
      const outcome = await makeReportPdf(request);
      if (outcome.status === 'ready') setState({ kind: 'ready', report: outcome.report });
      else if (outcome.status === 'unsupported') setState({ kind: 'error', message: t('reportPdf.error.unsupported') });
      else {
        // The branch changed while it was being made (or another PDF was under way): nothing is kept.
        setState({ kind: 'idle' });
        if (outcome.status === 'stale') toast.info(t('reports.contextChanged'));
      }
    } catch (error) {
      setState({ kind: 'error', message: reason(error) });
    }
  };

  const open = async (report: GeneratedReport) => {
    try {
      if ((await openReportPdf(report)) === 'blocked') {
        toast.error(t(Platform.OS === 'web' ? 'reportPdf.error.popupBlocked' : 'reportPdf.error.openFailed'));
      }
    } catch {
      toast.error(t('reportPdf.error.openFailed'));
    }
  };

  const share = async (report: GeneratedReport) => {
    try {
      await shareReportPdf(report);
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'sharing-unavailable' ? t('reports.error.sharingUnavailable') : t('reportPdf.error.failed'));
    }
  };

  return (
    <View style={styles.wrap}>
      {/* A row, not a button: its whole label stays at 320 pt and at large text. */}
      <RowGroup>
        <ListRow
          flat
          leading={FileText}
          title={t('reportPdf.generate')}
          subtitle={busy ? t('reportPdf.preparing') : subtitle}
          subtitleLines={2}
          accessory={busy ? <ActivityIndicator /> : undefined}
          chevron={false}
          disabled={busy || !online}
          onPress={() => void generate()}
        />
      </RowGroup>

      {state.kind === 'ready' ? (
        <Card style={styles.ready}>
          <Text variant="bodyStrong">{t('reportPdf.ready')}</Text>
          <Text variant="caption" tone="secondary" selectable>
            {isolateLtr(state.report.filename)}
          </Text>
          <View style={styles.actions}>
            <Button title={t('reportPdf.open')} variant="secondary" wrap style={styles.action} onPress={() => void open(state.report)} />
            {canShareReportPdf() ? <Button title={t('reportPdf.share')} wrap style={styles.action} onPress={() => void share(state.report)} /> : null}
          </View>
          {Platform.OS === 'web' ? (
            <Text variant="caption" tone="secondary">
              {t('reportPdf.web.hint')}
            </Text>
          ) : null}
          <Text variant="caption" tone="tertiary">
            {t('reports.leavingWarning')}
          </Text>
        </Card>
      ) : null}

      {state.kind === 'error' ? (
        <InlineNotice tone="warning" action={<Button title={t('action.retry')} variant="tertiary" size="sm" onPress={() => void generate()} />}>
          {state.message}
        </InlineNotice>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.sm },
  ready: { gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1, flexBasis: 140 },
}));
