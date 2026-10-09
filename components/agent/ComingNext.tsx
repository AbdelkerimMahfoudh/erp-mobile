import React from 'react';
import { Stack } from 'expo-router';
import { Hourglass } from 'lucide-react-native';
import { EmptyState, Screen, TabHeader } from '../ui';
import { useBranch } from '../../lib/branch';
import { useTranslation } from '../../lib/i18n';

/**
 * A screen of the money services counter whose content is the next step of
 * checkpoint 4 (docs/73 §5, D157). The route exists now — registered, with its
 * back arrow and its place in the tab bar — so the navigation of every activity
 * can be built and tested as one piece; the screen says plainly that it holds
 * nothing yet rather than showing an empty figure.
 */
export function ComingNext({ title, tab = false }: { title: string; tab?: boolean }) {
  const { t } = useTranslation();
  const { branchName } = useBranch();
  return (
    <Screen>
      {tab ? <TabHeader context={branchName} title={title} /> : <Stack.Screen options={{ title }} />}
      <EmptyState icon={Hourglass} title={title} body={t('agent.next.body')} />
    </Screen>
  );
}
