import React from 'react';
import { Lock } from 'lucide-react-native';
import { useTranslation } from '../../lib/i18n';
import { InlineNotice } from './InlineNotice';

/**
 * "You are not allowed to do this, and here is why."
 *
 * The alternative — hiding the control entirely — is right for whole features
 * (a warehouse employee has no Sell tab at all). It is wrong for one action
 * inside a screen someone can otherwise use: a Manager looking at a return they
 * cannot confirm needs to know a confirmation step exists and who performs it,
 * or they will conclude the app is broken and telephone the Owner.
 *
 * Neutral-toned on purpose. Lacking a permission is not an error and not a
 * warning — nothing has gone wrong, and colouring it red would teach staff to
 * fear a screen they use correctly every day.
 */

export interface PermissionNoticeProps {
  /**
   * What the user cannot do, in plain words — already translated.
   * e.g. "Only an owner or manager can confirm a refund."
   */
  message: string;
  testID?: string;
}

export function PermissionNotice({ message, testID }: PermissionNoticeProps) {
  const { t } = useTranslation();

  return (
    <InlineNotice
      tone="neutral"
      icon={Lock}
      title={t('permission.notice.title')}
      testID={testID}
    >
      {message}
    </InlineNotice>
  );
}
