import { create } from 'zustand';
import { haptics } from './haptics';
import { uuidv4 } from './utils';

/**
 * Toasts — brief, non-blocking confirmation that something happened.
 *
 * The store lives outside React so `toast.error(…)` can be called from a
 * mutation handler, an API interceptor or a scanner callback without threading
 * a hook through. `<ToastHost />` renders whatever is in here.
 *
 * The `action` slot is what makes docs/05's "undo over confirm dialogs" rule
 * practical: a reversible action completes immediately and offers a way back,
 * instead of stopping the employee with "are you sure?" before every step.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  /** Optional second line for detail the message cannot carry. */
  description?: string;
  /** Milliseconds on screen. `0` keeps it until dismissed. */
  duration: number;
  action?: ToastAction;
}

export interface ToastOptions {
  description?: string;
  duration?: number;
  action?: ToastAction;
}

/**
 * Errors sit longer than confirmations — a success is a glance, a failure has
 * to be read and understood. A toast carrying an action gets longer still, or
 * it disappears before the employee has decided to undo.
 */
const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 2600,
  info: 3000,
  warning: 4200,
  error: 5200,
};
const DURATION_WITH_ACTION = 6500;

/** Cap what is on screen; a stack taller than this hides the app itself. */
const MAX_VISIBLE = 3;

interface ToastState {
  toasts: Toast[];
  push: (toast: Toast) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE) })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((x) => x.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

const HAPTIC: Record<ToastTone, () => void> = {
  success: haptics.success,
  error: haptics.error,
  warning: haptics.warning,
  info: haptics.tap,
};

function show(tone: ToastTone, message: string, options: ToastOptions = {}): string {
  const id = uuidv4();
  const duration =
    options.duration ?? (options.action ? DURATION_WITH_ACTION : DEFAULT_DURATION[tone]);

  useToastStore.getState().push({
    id,
    tone,
    message,
    description: options.description,
    duration,
    action: options.action,
  });
  HAPTIC[tone]();
  return id;
}

export const toast = {
  success: (message: string, options?: ToastOptions) => show('success', message, options),
  error: (message: string, options?: ToastOptions) => show('error', message, options),
  warning: (message: string, options?: ToastOptions) => show('warning', message, options),
  info: (message: string, options?: ToastOptions) => show('info', message, options),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
