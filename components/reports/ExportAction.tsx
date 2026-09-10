import React, { useState } from 'react';
import { Download } from 'lucide-react-native';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { IconButton } from '../ui/IconButton';
import { ExportSheet } from './ExportSheet';

/**
 * The Export button, and the sheet behind it.
 *
 * One component so Analytics and Money cannot drift apart: the same icon, the
 * same list, the same period. It renders NOTHING for a user without
 * `report.view` — a control that always answers "you may not" is worse than no
 * control, and this screen is already hidden from those users anyway.
 *
 * ⚠️ The hiding is courtesy, not security. The server refuses the request.
 */
export function ExportAction({ days }: { days?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!usePermission('report.view')) return null;

  return (
    <>
      <IconButton
        icon={Download}
        accessibilityLabel={t('reports.export')}
        onPress={() => setOpen(true)}
      />
      <ExportSheet open={open} onClose={() => setOpen(false)} days={days} />
    </>
  );
}
