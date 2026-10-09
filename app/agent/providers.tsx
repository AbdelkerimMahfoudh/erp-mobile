import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';

/** The company's providers and their configuration, read from each real schedule: the Owner's (docs/73 §1.2). */
export default function AgentProvidersScreen() {
  const { t } = useTranslation();
  return <ComingNext title={t('nav.agent.providers')} />;
}
