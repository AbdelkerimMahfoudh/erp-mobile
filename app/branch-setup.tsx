import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeftRight, PackagePlus, UserPlus, Users, Wallet } from 'lucide-react-native';
import { Button, ListRow, PageIntro, RowGroup, Screen } from '../components/ui';
import { checklistDoneKey } from '../lib/branch-requests';
import { useBranch } from '../lib/branch';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import { setItem } from '../lib/storage';

/** Home, where the checklist leaves to. */
const HOME = '/(tabs)' as const;

/**
 * A newly activated store, opened for the first time (0130): what to set up, each a way to the screen that does it —
 * and each of those screens reads its own rules from the server (who may be assigned, whether another staff member
 * fits the store's allowance), so nothing here invents a limit. Shown once; closing it remembers that on this phone.
 */
export default function BranchSetup() {
  const { t } = useTranslation();
  const router = useRouter();
  const branchId = useBranch((s) => s.branchId);

  const finish = () => {
    if (branchId) void setItem(checklistDoneKey(branchId), '1');
    router.dismissTo(HOME);
  };

  return (
    <Screen gap="lg" footer={<Button title={t('branchSetup.done')} onPress={finish} fullWidth />}>
      <Stack.Screen options={{ title: t('branchSetup.title') }} />
      <PageIntro description={t('branchSetup.intro')} />
      <View style={styles.list}>
        <RowGroup>
          <ListRow flat leading={Users} title={t('branchSetup.assign')} subtitle={t('branchSetup.assignBody')} onPress={() => router.push('/team')} />
          <ListRow flat leading={UserPlus} title={t('branchSetup.invite')} subtitle={t('branchSetup.inviteBody')} onPress={() => router.push('/team')} />
          <ListRow flat leading={Wallet} title={t('branchSetup.money')} subtitle={t('branchSetup.moneyBody')} onPress={() => router.push('/money-balances')} />
          <ListRow flat leading={PackagePlus} title={t('branchSetup.receive')} subtitle={t('branchSetup.receiveBody')} onPress={() => router.push('/receive')} />
          <ListRow flat leading={ArrowLeftRight} title={t('branchSetup.transfer')} subtitle={t('branchSetup.transferBody')} onPress={() => router.push('/transfers')} />
        </RowGroup>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { gap: space.sm } });
