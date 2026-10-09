import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';

/** The drawer, each float and each held commission now. */
export default function AgentPositionsScreen() {
  const { t } = useTranslation();
  return <ComingNext title={t('nav.agent.positions')} />;
}
