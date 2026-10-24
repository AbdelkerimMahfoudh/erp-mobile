import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FileText, LifeBuoy, ShieldCheck, UserX } from 'lucide-react-native';
import { Button, ListRow, RowGroup, Section, Text } from '../ui';
import { space } from '../../lib/design/tokens';
import { useTranslation, type TranslationKey } from '../../lib/i18n';
import { LEGAL_PAGES, type LegalPage } from '../../lib/legal-links';
import { legalPagesAvailable, openLegalPage } from '../../lib/navigation/no-browser';
import { toast } from '../../lib/toast';

/**
 * The privacy policy, the terms, support and how account deletion works (the owner's brief of 2026-10-16, docs/85):
 * read on the Dukan ERP website, in the person's language, in the phone's own browser — never inside the app. Each
 * is a page to read: none leads to a price, an application or a sign-in. A build with no legal origin configured shows
 * nothing here, and a release cannot be built without one (`scripts/verify-release-config.js`).
 */
const LABEL: Record<LegalPage, TranslationKey> = {
  privacy: 'legal.privacy',
  terms: 'legal.terms',
  support: 'legal.support',
  accountDeletion: 'legal.accountDeletion',
};
const ICON = { privacy: ShieldCheck, terms: FileText, support: LifeBuoy, accountDeletion: UserX } as const;

function useOpen() {
  const { t, language } = useTranslation();
  return (page: LegalPage) => {
    openLegalPage(page, language).catch(() => toast.error(t('legal.openFailed')));
  };
}

/** The pages as rows under their own heading: Your account, the deletion screen, the closed-access screen. */
export function LegalPageRows({ pages = LEGAL_PAGES }: { pages?: readonly LegalPage[] }) {
  const { t } = useTranslation();
  const open = useOpen();
  if (!legalPagesAvailable()) return null;
  return (
    <Section title={t('legal.title')}>
      <RowGroup>
        {pages.map((page) => (
          <ListRow key={page} flat title={t(LABEL[page])} subtitle={t('legal.opensOutside')} leading={ICON[page]} onPress={() => open(page)} />
        ))}
      </RowGroup>
    </Section>
  );
}

/** The pages as quiet buttons at the foot of a screen: sign-in and the branch choice. */
export function LegalPageButtons({ pages = LEGAL_PAGES }: { pages?: readonly LegalPage[] }) {
  const { t } = useTranslation();
  const open = useOpen();
  if (!legalPagesAvailable()) return null;
  return (
    <View style={styles.foot}>
      <View style={styles.buttons}>
        {pages.map((page) => (
          // A long label (French: "Comment fonctionne la suppression du compte") wraps within the row instead of pushing
          // the page sideways at 320 px — WebKit does not shrink a one-line label (2026-10-24).
          <Button key={page} title={t(LABEL[page])} variant="tertiary" size="sm" wrap style={styles.button} onPress={() => open(page)} />
        ))}
      </View>
      <Text variant="caption" tone="tertiary" style={styles.caption}>
        {t('legal.opensOutside')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  foot: { gap: space.xs, alignItems: 'center' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.xs },
  button: { maxWidth: '100%' },
  caption: { textAlign: 'center' },
});
