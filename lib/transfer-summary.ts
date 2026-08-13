import type { TranslationKey, TranslationValues } from './i18n';

/**
 * How a transfer describes what it is carrying.
 *
 * Pure, so the grammar can be tested without a screen. It exists because the
 * list used to say "1 item" for ten chargers — the row count, not the thing
 * count — which is a lie to whoever has to receive the box.
 *
 * Both numbers are shown when they differ, in the order somebody would say
 * them: "2 phones · 10 accessories". Neither is derived from the other, and
 * pluralisation goes through `t()` so Arabic can use its own rules rather than
 * an English "(s)".
 */

export interface TransferCountLike {
  unitCount: number;
  quantityLineCount: number;
  totalQuantity: number;
}

type Translate = (key: TranslationKey, vars?: TranslationValues) => string;

export function transferSummary(counts: TransferCountLike, t: Translate): string {
  const accessories = Math.max(counts.totalQuantity - counts.unitCount, 0);
  const parts: string[] = [];

  if (counts.unitCount > 0) {
    parts.push(
      counts.unitCount === 1
        ? t('transfers.summary.unit.one' as never)
        : t('transfers.summary.unit' as never, { count: counts.unitCount }),
    );
  }
  if (accessories > 0) {
    parts.push(
      accessories === 1
        ? t('transfers.summary.accessory.one' as never)
        : t('transfers.summary.accessory' as never, { count: accessories }),
    );
  }
  // A transfer always carries something, but an empty summary would be worse
  // than a plain count if one ever appeared.
  if (parts.length === 0) return t('transfers.items' as never, { count: counts.totalQuantity });
  return parts.join(' · ');
}
