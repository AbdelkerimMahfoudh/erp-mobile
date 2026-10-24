import React from 'react';
import { useRouter } from 'expo-router';
import { Compass } from 'lucide-react-native';
import { EmptyState, Screen } from '../components/ui';
import { useTranslation } from '../lib/i18n';

/**
 * An address the app does not have — mistyped, or out of date (the browser export serves this page with a 404).
 *
 * In the person's language, with one way on: the start, where the sign-in guard sends them to sign-in, the branch
 * choice or Home. It replaces Expo's default page, which was English only, ran past a 320-point screen and linked to a
 * list of every route (owner's review, 2026-10-24).
 */
export default function NotFound() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        size="page"
        icon={Compass}
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={{ label: t('notFound.action'), onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
