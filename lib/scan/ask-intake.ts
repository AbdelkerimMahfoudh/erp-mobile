import { api } from '../api-client';
import { CELLULAR_CATEGORY_KEYS, categoryLabel } from '../category-label';
import { dialog } from '../dialog';
import { hasKey, t } from '../i18n';
import type { Category, ScanResult } from '../../types/api';

/**
 * The questions a scan answers before a new product is drafted for it (D223).
 *
 * ## What does this code identify?
 *
 * A code that is not an IMEI is ambiguous on its own: "C02XK1ABJHD5" may be
 * one laptop's serial number or a barcode printed on every box of the model.
 * The answer decides which field the code travels in — a unit's serial, or the
 * product's barcode — and guessing wrong either poisons recognition for a whole
 * model or loses the one identifier the unit has. So it is asked, never
 * guessed, and closing the question is not an answer.
 *
 * ## Which kind of device is this IMEI from?
 *
 * An IMEI says "mobile connection", not "phone": a cellular tablet, a
 * smartwatch and a MiFi router carry one too. The answer files the new product
 * under the right built-in category instead of Phones by default.
 */
export interface IntakeAnswer {
  /** Where the scanned code goes. */
  field: 'imei' | 'serial' | 'productBarcode';
  /** The built-in category chosen for an IMEI, when the shop has it. */
  categoryId?: string;
}

export async function askScanIntake(result: Pick<ScanResult, 'kind' | 'code'>): Promise<IntakeAnswer | null> {
  if (result.kind === 'imei') {
    const categories = await api.get<Category[]>('/categories').catch(() => [] as Category[]);
    const options = CELLULAR_CATEGORY_KEYS.flatMap((key) => {
      const found = categories.find((c) => c.key === key && c.isActive);
      return found ? [found] : [];
    });
    // A shop without the built-ins (an older install) is not stopped: the form asks for a category.
    if (options.length === 0) return { field: 'imei' };
    const choice = await dialog.choose({
      title: t('intake.cellular.title'),
      message: t('intake.cellular.body'),
      choices: options.map((c) => categoryLabel(c, (k) => (hasKey(k) ? t(k) : k), hasKey)),
    });
    if (choice === null) return null;
    return { field: 'imei', categoryId: options[choice].id };
  }

  const choice = await dialog.choose({
    title: t('intake.identity.title'),
    message: result.code,
    // A title and what it means, both read in full (D225): never one line cut short.
    choices: [
      { title: t('intake.identity.unit.title'), description: t('intake.identity.unit.body') },
      { title: t('intake.identity.model.title'), description: t('intake.identity.model.body') },
    ],
  });
  if (choice === null) return null;
  return { field: choice === 0 ? 'serial' : 'productBarcode' };
}
