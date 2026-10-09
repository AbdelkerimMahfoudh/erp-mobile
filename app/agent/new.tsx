import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';

/** The counter flow (docs/73 §5.2). */
export default function NewExchangeScreen() {
  const { t } = useTranslation();
  return <ComingNext title={t('nav.agent.new')} />;
}
