import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';

/** The counter's reports on a combined branch, a row of Money beside Results (D157). */
export default function AgentReportsScreen() {
  const { t } = useTranslation();
  return <ComingNext title={t('nav.agent.reports')} />;
}
