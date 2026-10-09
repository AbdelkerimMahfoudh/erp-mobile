import React from 'react';
import { ComingNext } from '../../components/agent/ComingNext';
import { useTranslation } from '../../lib/i18n';

/** One exchange of the counter. */
export default function ExchangeDetailScreen() {
  const { t } = useTranslation();
  return <ComingNext title={t('nav.agent.transactions')} />;
}
