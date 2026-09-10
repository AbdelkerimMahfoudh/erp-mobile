import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Download } from 'lucide-react-native';
import { space } from '../../lib/design/tokens';
import { useTranslation } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api-client';
import { useBranch } from '../../lib/branch';
import {
  availableReports,
  exportReport,
  PERIOD_KINDS,
  type ReportKind,
} from '../../lib/report-export';
import { BottomSheet } from '../overlay/BottomSheet';
import { ListRow } from '../ui/ListRow';
import { RowGroup } from '../ui/RowGroup';
import { Text } from '../ui/Text';
import { makeStyles } from '../../lib/design/theme';

/**
 * Choose a report and get it off the phone.
 *
 * One sheet rather than a screen: exporting is a thing you do while looking at
 * figures, not a place you go. It opens from Analytics and from Money and
 * offers the same list either way — a report is a report, and two lists that
 * drift is one more thing to keep in step.
 *
 * The list is what the SERVER will allow, mirrored client-side so nobody is
 * shown a door that does not open. The server checks again regardless.
 */

export interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * The window a period report should cover, matching what the screen shows.
   * Reports that describe the present ignore it — the server refuses a date
   * range on those outright.
   */
  days?: number;
}

export function ExportSheet({ open, onClose, days = 30 }: ExportSheetProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { branchName } = useBranch();
  /** Which row is working, so only that row shows a spinner. */
  const [busy, setBusy] = useState<ReportKind | null>(null);

  const kinds = availableReports();

  async function run(kind: ReportKind) {
    // A second tap on a working row does nothing. `exportReport` refuses a
    // concurrent run too — this is the visible half of the same rule.
    if (busy) return;
    setBusy(kind);
    try {
      const result = await exportReport(kind, { days });
      switch (result.status) {
        case 'shared':
        case 'downloaded':
          toast.success(t('reports.exported', { name: result.filename }));
          onClose();
          break;
        case 'stale':
          // The branch changed while it was generating. Saying so is better
          // than silently handing over the wrong shop's figures.
          toast.info(t('reports.contextChanged'));
          break;
        case 'cancelled':
          break;
      }
    } catch (error) {
      toast.error(reasonFor(error, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('reports.export')}>
      <View style={styles.body}>
        {/*
          What the file will contain, before it is asked for. A report is only
          useful if the reader knows which branch and which window it covers,
          and the moment to say so is now — not after it lands in Mail.
        */}
        <Text variant="caption" tone="secondary">
          {t('reports.scope', {
            branch: branchName ?? t('reports.allBranches'),
            days: String(days),
          })}
        </Text>

        {kinds.length === 0 ? (
          <Text variant="body" tone="secondary">
            {t('reports.noneAvailable')}
          </Text>
        ) : (
          // RowGroup draws the separators; adding our own would double them.
          <RowGroup>
            {kinds.map((kind) => (
              <ListRow
                key={kind}
                flat
                title={t(KIND_KEY[kind])}
                subtitle={
                  PERIOD_KINDS.has(kind)
                    ? t('reports.period', { days: String(days) })
                    : t('reports.asOfToday')
                }
                leading={Download}
                accessory={busy === kind ? <ActivityIndicator /> : undefined}
                chevron={false}
                disabled={busy !== null}
                onPress={() => run(kind)}
              />
            ))}
          </RowGroup>
        )}

        {/*
          The one thing a shop must understand about a file that has left the
          app: nothing on it is protected any more.
        */}
        <Text variant="caption" tone="secondary">
          {t('reports.leavingWarning')}
        </Text>
      </View>
    </BottomSheet>
  );
}

/**
 * Say what actually went wrong, in the user's words.
 *
 * The server's own message is preferred wherever it has one — it knows whether
 * the report was too large, the session expired or the permission was revoked,
 * and inventing a generic failure would throw that away.
 */
function reasonFor(error: unknown, t: (key: ReportErrorKey) => string): string {
  if (error instanceof Error && error.message === 'sharing-unavailable') {
    return t('reports.error.sharingUnavailable');
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return t('reports.error.signedOut');
    if (error.status === 403) return t('reports.error.notAllowed');
    if (error.status === 413) return t('reports.error.tooLarge');
    return error.message;
  }
  return t('reports.error.offline');
}

/** The literal keys `reasonFor` may return, so the typed i18n still applies. */
type ReportErrorKey =
  | 'reports.error.sharingUnavailable'
  | 'reports.error.signedOut'
  | 'reports.error.notAllowed'
  | 'reports.error.tooLarge'
  | 'reports.error.offline';

/** One key per report, spelled out so a kebab-case id stays a valid key. */
const KIND_KEY = {
  'profit-by-product': 'reports.kind.profitByProduct',
  'profit-by-employee': 'reports.kind.profitByEmployee',
  'profit-by-branch': 'reports.kind.profitByBranch',
  movers: 'reports.kind.movers',
  'dead-stock': 'reports.kind.deadStock',
  'debtors-creditors': 'reports.kind.debtorsCreditors',
} as const;

const useStyles = makeStyles(() => ({
  body: { gap: space.md, paddingBottom: space.md },
}));
