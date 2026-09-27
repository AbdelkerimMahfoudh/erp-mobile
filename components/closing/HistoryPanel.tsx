import React from 'react';
import { Expandable } from '../ui';
import { useTranslation } from '../../lib/i18n';

/**
 * The Closing history as one rectangle (docs/58 D72, D75): a purple header as
 * prominent as the day's main button, its title with the number of events
 * written out under it, and the chevron at the right edge — in Arabic too, so
 * it never changes sides while the entries open. The entries are always the
 * server's, every earlier one kept, counts after a reopen included.
 */
export interface HistoryPanelProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

export function HistoryPanel({ title, count, children }: HistoryPanelProps) {
  const { t } = useTranslation();
  // Said in words, never a bare number: a lone "4" on the header read as nothing.
  const meta = count === 0 ? t('closing.history.events.none') : count === 1 ? t('closing.history.events.one') : t('closing.history.events', { count });
  return (
    <Expandable title={title} meta={meta} tone="solid" chevron="edge" accessibilityLabel={`${title}, ${meta}`}>
      {children}
    </Expandable>
  );
}
