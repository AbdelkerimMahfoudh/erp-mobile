import React from 'react';
import { useRouter, type Href } from 'expo-router';
import { BadgeCheck } from 'lucide-react-native';
import { ListRow, RowGroup } from '../ui';
import { useAuth } from '../../hooks/useAuth';
import { accessSummary } from '../../lib/access-summary';
import { useEntitlement } from '../../lib/entitlement';
import { useTranslation } from '../../lib/i18n';

/** Business access first on More (D227): its state, what is left, its stores and seats. Status and dates only: no price, no link. */
export function BusinessAccessRow() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const entitlement = useEntitlement();
  const summary = accessSummary(entitlement.data, Boolean(user?.isTestBusiness));
  const subtitle = summary ? [t(summary.stateKey as never), ...summary.parts.map((p) => t(p.key as never, p.values as never))].join(' · ') : undefined;
  return (
    <RowGroup>
      <ListRow flat title={t('nav.access')} subtitle={subtitle} leading={BadgeCheck} onPress={() => router.push('/access' as Href)} />
    </RowGroup>
  );
}
