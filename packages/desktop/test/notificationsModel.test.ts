import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_TOAST_DURATION_MS,
  NotificationToastModel,
  addNotificationToast,
  dismissNotificationToast,
  notificationToastDurationMs,
} from '../src/platform/notification/common/notification.js';

describe('NotificationToastModel', () => {
  it('creates monotonic toast ids with info as the default tone', () => {
    const model = new NotificationToastModel();

    expect(model.create('One')).toEqual({ id: 1, message: 'One', tone: 'info' });
    expect(model.create('Two', 'error')).toEqual({ id: 2, message: 'Two', tone: 'error' });
  });

  it('adds and dismisses toasts without mutating the input list', () => {
    const first = { id: 1, message: 'First', tone: 'info' as const };
    const second = { id: 2, message: 'Second', tone: 'success' as const };
    const initial = [first] as const;

    const added = addNotificationToast(initial, second);
    const dismissed = dismissNotificationToast(added, first.id);

    expect(initial).toEqual([first]);
    expect(added).toEqual([first, second]);
    expect(dismissed).toEqual([second]);
  });

  it('keeps the existing tone-specific purge durations', () => {
    expect(notificationToastDurationMs('error')).toBe(NOTIFICATION_TOAST_DURATION_MS.error);
    expect(notificationToastDurationMs('info')).toBe(3500);
    expect(notificationToastDurationMs('success')).toBe(2800);
  });
});
