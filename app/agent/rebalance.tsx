import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';

/** Money moved between the drawer and the floats, or brought in from outside (A8): never an exchange. */
export default function AgentRebalanceScreen() {
  const { t } = useTranslation();
  return <ComingNext title={t('nav.agent.rebalance')} />;
}
