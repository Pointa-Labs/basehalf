import { create } from 'zustand';
import {
  type NotificationToast,
  NotificationToastModel,
  type NotificationToastTone,
  addNotificationToast,
  dismissNotificationToast,
  notificationToastDurationMs,
} from '../common/notification.js';

export type ToastTone = NotificationToastTone;
export type Toast = NotificationToast;

interface ToastState {
  readonly toasts: readonly Toast[];
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

const toastModel = new NotificationToastModel();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, tone = 'info') => {
    const toast = toastModel.create(message, tone);
    set((s) => ({ toasts: addNotificationToast(s.toasts, toast) }));
    // The renderer's setTimeout is fine here (no resume-journal concern).
    setTimeout(() => get().dismiss(toast.id), notificationToastDurationMs(tone));
  },
  dismiss: (id) => set((s) => ({ toasts: dismissNotificationToast(s.toasts, id) })),
}));

/** Convenience: `toast.error('…')` / `toast.info(…)` / `toast.success(…)`. */
export const toast = {
  error: (message: string): void => useToastStore.getState().show(message, 'error'),
  info: (message: string): void => useToastStore.getState().show(message, 'info'),
  success: (message: string): void => useToastStore.getState().show(message, 'success'),
};
