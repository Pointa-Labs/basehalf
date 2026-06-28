import { create } from 'zustand';

/**
 * A tiny global toast (transient notification) store — the standard surface for
 * action outcomes that shouldn't live as permanent panel chrome (a push that
 * failed, a sync that succeeded). Modeled on VS Code's notifications: stack at a
 * corner, auto-dismiss, dismissible early. Call via the `toast` helper.
 */
export type ToastTone = 'error' | 'info' | 'success';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

interface ToastState {
  readonly toasts: readonly Toast[];
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

// Errors linger (you may need to read them); info/success fade faster.
const DURATION: Record<ToastTone, number> = { error: 6000, info: 3500, success: 2800 };
let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, tone = 'info') => {
    seq += 1;
    const id = seq;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    // The renderer's setTimeout is fine here (no resume-journal concern).
    setTimeout(() => get().dismiss(id), DURATION[tone]);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience: `toast.error('…')` / `toast.info(…)` / `toast.success(…)`. */
export const toast = {
  error: (message: string): void => useToastStore.getState().show(message, 'error'),
  info: (message: string): void => useToastStore.getState().show(message, 'info'),
  success: (message: string): void => useToastStore.getState().show(message, 'success'),
};
