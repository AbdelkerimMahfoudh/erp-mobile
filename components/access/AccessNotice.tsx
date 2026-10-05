import React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { BadgeCheck } from 'lucide-react-native';
import { InlineNotice, Text } from '../ui';
import { accessNotice } from '../../lib/access';
import { useBusinessAccess } from '../../lib/entitlement';
import { formatDateTime } from '../../lib/format';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';

/**
 * The one thing the tabs say about business access (docs/21, 2026-10-05).
 *
 * Mounted once at the top of Home, Partners, Money, Stock and More, so the five
 * never disagree: grace is one restrained warning carrying the server's exact
 * deadline; read-only says that reading and exports continue; an Owner over the
 * staff allowance is told so. An open shop sees nothing, and a closed one never
 * reaches a tab. Every word comes from the server's state — no price, no
 * payment, no link, no call to action; the details are one tap away.
 */
export function AccessNotice({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const access = useBusinessAccess();
  const mayManageStaff = usePermission('user.manage');
  const kind = accessNotice(access, mayManageStaff);
  if (kind === 'none') return null;

  const message =
    kind === 'read_only'
      ? t('access.readOnly.notice')
      : kind === 'grace'
        ? t('access.grace.notice', { deadline: access.graceEnd ? formatDateTime(access.graceEnd) : '' })
        : t('access.staff.over');

  return (
    <InlineNotice
      tone={kind === 'read_only' ? 'danger' : 'warning'}
      title={t('access.title')}
      icon={BadgeCheck}
      action={
        <Pressable onPress={() => router.push('/access' as Href)} accessibilityRole="button">
          <Text variant="caption" tone="accent">
            {t('access.details')}
          </Text>
        </Pressable>
      }
      style={style}
    >
      <Text variant="caption" tone="secondary">
        {message}
      </Text>
    </InlineNotice>
  );
}
