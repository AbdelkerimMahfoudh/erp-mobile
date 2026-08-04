import { create } from 'zustand';
import { uuidv4 } from './utils';

/**
 * Modal dialogs — the deliberate speed bump.
 *
 * Used sparingly. docs/05 prefers undo over confirmation, so a dialog is only
 * correct when the action is genuinely hard to reverse or when a business rule
 * demands an explicit override.
 *
 * Promise-based, so a guard reads as a straight line at the call site:
 *
 *   const ok = await dialog.confirm({ title: 'Sell below cost?', … });
 *   if (!ok) return;
 *
 * `confirmWithReason` exists because Business Rule 14 requires below-cost sales
 * to be explained and logged — the reason travels to the backend as
 * `overrideReason`. Capturing it here means every override in the app is
 * recorded the same way instead of each screen inventing its own prompt.
 */

export type DialogTone = 'default' | 'danger';

export interface DialogRequest {
  id: string;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone: DialogTone;
  /** Show a required free-text field; confirm stays disabled until filled. */
  requireReason: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Hide the cancel button — an acknowledgement rather than a choice. */
  acknowledgeOnly: boolean;
  resolve: (result: DialogResult) => void;
}

export interface DialogResult {
  confirmed: boolean;
  reason?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

export interface ConfirmWithReasonOptions extends ConfirmOptions {
  reasonLabel?: string;
  reasonPlaceholder?: string;
}

interface DialogState {
  queue: DialogRequest[];
  push: (request: DialogRequest) => void;
  resolveTop: (result: DialogResult) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  push: (request) => set((state) => ({ queue: [...state.queue, request] })),
  resolveTop: (result) => {
    const [top, ...rest] = get().queue;
    if (!top) return;
    set({ queue: rest });
    top.resolve(result);
  },
}));

function request(
  options: ConfirmWithReasonOptions & { requireReason?: boolean; acknowledgeOnly?: boolean },
): Promise<DialogResult> {
  return new Promise<DialogResult>((resolve) => {
    useDialogStore.getState().push({
      id: uuidv4(),
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      tone: options.tone ?? 'default',
      requireReason: options.requireReason ?? false,
      reasonLabel: options.reasonLabel,
      reasonPlaceholder: options.reasonPlaceholder,
      acknowledgeOnly: options.acknowledgeOnly ?? false,
      resolve,
    });
  });
}

export const dialog = {
  /** Resolves true when confirmed. */
  confirm: async (options: ConfirmOptions): Promise<boolean> => {
    const { confirmed } = await request(options);
    return confirmed;
  },

  /** Confirmation that also captures why — for logged overrides. */
  confirmWithReason: (options: ConfirmWithReasonOptions): Promise<DialogResult> =>
    request({ ...options, requireReason: true }),

  /** Tell the user something they must acknowledge. Resolves when dismissed. */
  alert: async (options: Omit<ConfirmOptions, 'cancelLabel'>): Promise<void> => {
    await request({ ...options, acknowledgeOnly: true });
  },
};
