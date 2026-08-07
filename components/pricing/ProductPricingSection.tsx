import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { History, PencilLine, ScanLine, Trash2 } from 'lucide-react-native';
import { Button, Card, Section, SkeletonList, Text } from '../ui';
import { PriceEditor } from './PriceEditor';
import { PriceSummary } from './PriceSummary';
import { space } from '../../lib/design/tokens';
import { dialog } from '../../lib/dialog';
import { toFriendlyError } from '../../lib/errors';
import { useTranslation } from '../../lib/i18n';
import { usePermission } from '../../lib/permissions';
import { money } from '../../lib/theme';
import { toast } from '../../lib/toast';
import {
  isStaleEdit,
  usePricingProduct,
  useRemovePrice,
  type PriceScope,
} from '../../lib/pricing';
import type { ProductDetail } from '../../types/api';

/**
 * The pricing block on Product Details.
 *
 * Every store role sees the price and where it came from — the counter needs it.
 * The edit controls appear only with `price.edit`, which is branch-scoped: the
 * same manager sees them in the branch it was delegated in and not in another.
 * An employee gets no controls at all rather than disabled ones, because a
 * button that exists only to refuse is worse than no button.
 *
 * Nothing here decides a price. It renders what the server resolved.
 */

export interface ProductPricingSectionProps {
  product: ProductDetail;
  branchName: string;
}

export function ProductPricingSection({ product, branchName }: ProductPricingSectionProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const canEdit = usePermission('price.edit');
  const pricing = usePricingProduct(product.id);
  const remove = useRemovePrice();
  const [editing, setEditing] = useState(false);

  const quantity = product.trackingType === 'quantity';
  const scope: PriceScope = quantity
    ? { kind: 'stock_item', productId: product.id }
    : { kind: 'branch_variant', productId: product.id };

  if (pricing.isLoading) {
    return (
      <Section title={t('pricing.section')}>
        <SkeletonList count={2} />
      </Section>
    );
  }

  // A pricing failure must not take the whole product page down: identity,
  // stock and specifications are still useful without it.
  if (pricing.isError || !pricing.data) {
    return (
      <Section title={t('pricing.section')}>
        <Card>
          <Text tone="secondary">{toFriendlyError(pricing.error).body}</Text>
        </Card>
      </Section>
    );
  }

  const current = pricing.data;

  const confirmRemove = async () => {
    if (current.version === null) return; // a fallback has no row to remove
    const ok = await dialog.confirm({
      title: t('pricing.remove.title'),
      // Say what the price becomes, not just that something is deleted.
      message:
        current.fallback === null || current.fallback.price === null
          ? t('pricing.fallbackPreviewNone')
          : t('pricing.fallbackPreview', { price: money(current.fallback.price) }),
      confirmLabel: t('pricing.remove.confirm'),
      cancelLabel: t('action.cancel'),
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await remove.mutateAsync({
        scope,
        expectedVersion: current.version,
        productId: product.id,
      });
    } catch (error) {
      if (isStaleEdit(error)) {
        await dialog.alert({
          title: t('pricing.conflict.title'),
          message: t('pricing.conflict.reload'),
        });
        void pricing.refetch();
        return;
      }
      toast.error(toFriendlyError(error).body);
    }
  };

  return (
    <Section title={t('pricing.section')}>
      <View style={styles.stack}>
        <PriceSummary pricing={current} branchName={branchName} />

        {/* Last sold stays where it already was — it is history, not a price. */}
        {product.lastSoldPrice !== null ? (
          <Card>
            <View style={styles.row}>
              <Text tone="secondary">{t('catalog.detail.lastSold')}</Text>
              <Text variant="bodyStrong">{money(product.lastSoldPrice)}</Text>
            </View>
          </Card>
        ) : null}

        {canEdit ? (
          <View style={styles.actions}>
            <Button
              title={quantity ? t('pricing.action.setStock') : t('pricing.action.setBranch')}
              icon={PencilLine}
              variant="secondary"
              onPress={() => setEditing(true)}
            />

            {/*
              Removing is only meaningful when a real row is producing the
              price. Against a fallback there is nothing to remove.
            */}
            {current.canRemove ? (
              <Button
                title={t('pricing.action.remove')}
                icon={Trash2}
                variant="tertiary"
                onPress={confirmRemove}
                loading={remove.isPending}
              />
            ) : null}

            {/* One phone's price is a different decision from the model's. */}
            {!quantity ? (
              <Button
                title={t('pricing.action.setUnit')}
                icon={ScanLine}
                variant="tertiary"
                onPress={() => router.push(`/pricing/unit?productId=${product.id}` as never)}
              />
            ) : null}

            <Button
              title={t('pricing.action.history')}
              icon={History}
              variant="tertiary"
              onPress={() => router.push(`/pricing/history?productId=${product.id}` as never)}
            />
          </View>
        ) : null}
      </View>

      {editing ? (
        <PriceEditor
          open={editing}
          onClose={() => setEditing(false)}
          scope={scope}
          current={current}
          productLabel={product.label}
          branchName={branchName}
          onSaved={() => void pricing.refetch()}
        />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { gap: space.sm },
});
