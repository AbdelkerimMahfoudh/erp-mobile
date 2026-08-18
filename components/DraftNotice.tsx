import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, InlineNotice, Text } from './ui';
import { space } from '../lib/design/tokens';
import { useTranslation } from '../lib/i18n';
import type { DraftHandle } from '../lib/offline/use-draft';

/**
 * "This was still here from before" (Milestone J.1).
 *
 * Restoring a form silently is how somebody submits yesterday's numbers
 * believing they typed them today. The notice says when the work was saved and
 * offers to throw it away, so a restored draft is always a choice rather than
 * something that happened to the shopkeeper.
 *
 * It also carries the honest wording: what came back is what was typed here.
 * Nothing about prices, balances or stock is restored — the screen re-asks the
 * server for those, because a stale figure shown confidently is worse than no
 * figure at all.
 */
export function DraftNotice({ draft, onDiscard }: { draft: DraftHandle; onDiscard: () => void }) {
  const { t } = useTranslation();

  if (draft.refused) {
    /*
      A write was refused — a forbidden field or an oversized payload. Said out
      loud rather than swallowed, because the shop is about to lose work it has
      every reason to think is being kept.
    */
    return <InlineNotice tone="warning">{t('draft.notSaved')}</InlineNotice>;
  }

  if (draft.restoredAt === null) return null;

  return (
    <InlineNotice tone="info">
      <View style={styles.body}>
        <Text variant="body">
          {t('draft.restored', { when: new Date(draft.restoredAt).toLocaleString() })}
        </Text>
        <Text variant="caption" tone="secondary">
          {t('draft.restored.hint')}
        </Text>
        <View style={styles.actions}>
          <Button
            title={t('draft.keep')}
            variant="ghost"
            onPress={draft.acknowledge}
          />
          <Button
            title={t('draft.discard')}
            variant="ghost"
            onPress={() => {
              draft.clear();
              onDiscard();
            }}
          />
        </View>
      </View>
    </InlineNotice>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
