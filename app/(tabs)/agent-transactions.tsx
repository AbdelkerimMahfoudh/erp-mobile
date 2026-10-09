import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';
import { useBranchActivity } from '../../lib/entitlement';
import { tabLabelKey } from '../../lib/navigation/registry';

/** The counter's exchanges (D157): Transactions on an agent-only branch, Exchanges on a combined one. */
export default function AgentTransactionsTab() {
  const { t } = useTranslation();
  const activity = useBranchActivity();
  return <ComingNext tab title={t(tabLabelKey('agent', activity))} />;
}
