/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Notifications.

// Notification toasts never render under --enable-smoke-test-driver (the
// stock NotificationsToasts skips them so they cannot cover smoke targets), so
// the smoke reads notifications from the notification center, opened from the
// status bar bell. The center lists every notification that is still open.
export async function showNotificationsCenter(page) {
	const center = page.locator('.notifications-center.visible');
	if (!(await center.isVisible().catch(() => false))) {
		await page.locator('#status\\.notifications .statusbar-item-label').click();
	}
	await center.waitFor({ state: 'visible', timeout: 10_000 });
	return center;
}

export async function hideNotificationsCenter(page) {
	const center = page.locator('.notifications-center.visible');
	if (await center.isVisible().catch(() => false)) {
		await page.locator('#status\\.notifications .statusbar-item-label').click();
		await center.waitFor({ state: 'hidden', timeout: 10_000 });
	}
}

// Waits for the open notification whose message contains `message` (a string
// or a RegExp) and returns its row in the notification center, which stays open.
async function waitForNotification(page, message, timeout = 15_000) {
	// A center that is opened before the notification arrives can close again
	// with nothing to show, and the notification does not reopen it. So the
	// center is opened again for as long as the notification is not listed.
	const deadline = Date.now() + timeout;
	for (; ;) {
		const center = await showNotificationsCenter(page);
		const item = center.locator('.notification-list-item', { hasText: message }).first();
		try {
			await item.waitFor({ state: 'visible', timeout: Math.max(250, Math.min(1_000, deadline - Date.now())) });
			return item;
		} catch (error) {
			if (Date.now() >= deadline) {
				throw error;
			}
		}
	}
}

// Waits for a notification, checks it, and clears it so later lookups of the
// same message never match it; then closes the notification center.
export async function expectNotification(page, message, timeout = 15_000) {
	const item = await waitForNotification(page, message, timeout);
	await item.locator('.action-label.codicon-notifications-clear').evaluate(action => action.click());
	await item.waitFor({ state: 'hidden', timeout: 10_000 });
	await hideNotificationsCenter(page);
}

// Clicks an action button of the notification whose message contains
// `message`, then closes the notification center.
export async function clickNotificationAction(page, message, action, timeout = 15_000) {
	const item = await waitForNotification(page, message, timeout);
	await item.locator('.notification-list-item-buttons-container .monaco-button', { hasText: action }).first().click();
	await item.waitFor({ state: 'hidden', timeout: 10_000 });
	await hideNotificationsCenter(page);
}
