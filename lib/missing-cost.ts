import { dialog } from './dialog';
import { t } from './i18n';

/**
 * The buying cost was left empty and the final stock action pressed (D223, 2026-10-28).
 *
 * Asked, never assumed: without the cost the app cannot calculate the item's
 * profit, so the person decides. The answer is one of three:
 *
 * - `add` — back to the form, the cost field focused; nothing is sent.
 * - `continue` — the one stock operation runs, the cost sent as ABSENT: the
 *   server records it as unknown (0107), never as zero, and an Owner or a
 *   Manager can enter it later.
 * - `cancel` — nothing changes; the completed intake stays as it was.
 *
 * Dismissing it (the backdrop, Back) is `cancel` and submits nothing. Asked
 * once at a time: a second press while it is up gets `cancel`, so the dialog can
 * neither stack nor open twice.
 */
export type MissingCostAnswer = 'add' | 'continue' | 'cancel';

let asking = false;

export async function askMissingCost(): Promise<MissingCostAnswer> {
  if (asking) return 'cancel';
  asking = true;
  try {
    const choice = await dialog.choose({
      title: t('cost.missing.title'),
      message: t('cost.missing.body'),
      choices: [t('cost.missing.add'), t('cost.missing.continue')],
      cancelLabel: t('action.cancel'),
    });
    return choice === 0 ? 'add' : choice === 1 ? 'continue' : 'cancel';
  } finally {
    asking = false;
  }
}

export { parseBuyingCost } from './missing-cost-parse.ts';
