import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';

/**
 * Reports — the tab of an agent-only branch (D157). A combined branch reaches
 * the same reports from Money, beside Results, at /agent/reports.
 */
export default function AgentReportsTab() {
  const { t } = useTranslation();
  return <ComingNext tab title={t('tab.reports')} />;
}
