export type NotificationToastTone = 'error' | 'info' | 'success';

export interface NotificationToast {
  readonly id: number;
  readonly message: string;
  readonly tone: NotificationToastTone;
}

// Mirrors VS Code's notification split: common decides notification metadata
// and purge timing, browser code owns rendering and timers.
export const NOTIFICATION_TOAST_DURATION_MS: Record<NotificationToastTone, number> = {
  error: 6000,
  info: 3500,
  success: 2800,
};

export class NotificationToastModel {
  private nextToastId = 1;

  create(message: string, tone: NotificationToastTone = 'info'): NotificationToast {
    const toast = { id: this.nextToastId, message, tone };
    this.nextToastId += 1;
    return toast;
  }
}

export function addNotificationToast(
  toasts: readonly NotificationToast[],
  toast: NotificationToast,
): readonly NotificationToast[] {
  return [...toasts, toast];
}

export function dismissNotificationToast(
  toasts: readonly NotificationToast[],
  id: number,
): readonly NotificationToast[] {
  return toasts.filter((toast) => toast.id !== id);
}

export function notificationToastDurationMs(tone: NotificationToastTone): number {
  return NOTIFICATION_TOAST_DURATION_MS[tone];
}
