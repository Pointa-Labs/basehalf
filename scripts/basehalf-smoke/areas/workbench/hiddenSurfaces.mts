/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What BaseHalf hides of VS Code: Open Editors, competing views, status bar items, and commands.

import process from 'process';
import { isExpectedCommandRow, runCommand, visibleQuickInput } from '../../lib/quickInput.mts';

export async function assertOpenEditorsHidden(page) {
	const headers = await page.locator('.pane-header h3.title').evaluateAll(nodes => nodes.map(node => (node.textContent || '').trim()).filter(text => text === 'Open Editors'));
	if (headers.length) {
		throw new Error('Open Editors view is visible in Explorer');
	}
}

export async function assertCompetingViewContainersHidden(page) {
	const forbidden = ['Extensions', 'Chat', 'Run and Debug', 'Debug Console', 'Testing', 'Test Results', 'Problems', 'Output', 'Remote Explorer', 'Terminal'];
	const started = Date.now();
	let visibleForbidden = [];
	while (Date.now() - started < 5_000) {
		const visibleTitles = await visibleViewContainerTitles(page);
		visibleForbidden = forbidden.filter(title => visibleTitles.includes(title));
		if (!visibleForbidden.length) {
			return;
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Competing VS Code view containers are visible: ${visibleForbidden.join(', ')}`);
}

async function visibleViewContainerTitles(page) {
	return page.locator('.part.sidebar .title-label h2, .part.panel .title-label h2, .part.auxiliarybar .title-label h2').evaluateAll(nodes => nodes
		.filter(node => {
			const element = node;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0
				&& rect.right > 0
				&& rect.bottom > 0
				&& rect.left < window.innerWidth
				&& rect.top < window.innerHeight;
		})
		.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
		.filter(Boolean));
}

export async function assertStatusBarCurated(page) {
	// The status bar stays curated: Git/notification entries remain, while the
	// remote-window indicator and the problems counter point at flows BaseHalf
	// hides. Both entries register asynchronously, so hold the assertion over a
	// settle window instead of sampling once.
	await page.locator('.part.statusbar').waitFor({ state: 'visible', timeout: 20_000 });
	const started = Date.now();
	let sawVisibleEntry = false;
	while (Date.now() - started < 5_000) {
		const visibleEntryIds = await page.locator('.part.statusbar .statusbar-item').evaluateAll(nodes => nodes
			.filter(node => {
				const rect = node.getBoundingClientRect();
				return getComputedStyle(node).display !== 'none' && rect.width > 0 && rect.height > 0;
			})
			.map(node => node.id));
		const visibleCurated = visibleEntryIds.filter(id => id === 'status.host' || id === 'status.problems');
		if (visibleCurated.length) {
			throw new Error(`Curated status bar entries are visible: ${visibleCurated.join(', ')}`);
		}
		sawVisibleEntry ||= visibleEntryIds.length > 0;
		if (sawVisibleEntry && Date.now() - started >= 2_000) {
			return;
		}
		await page.waitForTimeout(200);
	}

	if (!sawVisibleEntry) {
		throw new Error('No visible status bar entries found; the curated status bar assertion never exercised real entries');
	}
}

export async function assertHiddenSurfaceCommandsStayHidden(page) {
	// A command of what BaseHalf does not have is not in the Command Palette (D141).
	for (const command of [
		'Extensions: Install Extensions',
		'Extensions: Install from VSIX...',
		'Extensions: Install Extension from Location...',
		'Extensions: Focus on Extensions View',
		'Chat: Open Chat',
		'Chat: Use AI Features with Copilot for free...',
		'View: Show Run and Debug',
		'Debug: Add Configuration...',
		'Tasks: Run Task',
		'View: Show Testing',
		'Problems: Focus on Problems View',
		'View: Toggle Output',
		'View: Show Remote Explorer',
		'Browser: Open Integrated Browser',
		'Profiles: Switch Profile...',
		'View: Split Editor Right',
		'View: Toggle Breadcrumbs',
		'View: Toggle Sidebar Position',
		// What the shell listed under another name, or of what BaseHalf does not have (D150).
		'View: Toggle Panel Visibility',
		'View: Toggle Terminal',
		'View: Close All Editors in Group',
		'View: Close Editors to the Left in Group',
		'Terminal: Attach to Session',
		'Preferences: Product Icon Theme'
	]) {
		await assertCommandAbsentFromPalette(page, command);
	}
	// Nor is any command that the palette lists under the category of a hidden family: a base update
	// that adds one shows here.
	for (const category of ['Tasks', 'Debug', 'Notebook', 'Test', 'Profiles', 'Browser', 'Chat', 'Voice', 'MCP', 'Remote', 'Problems', 'Merge Editor', 'Comments', 'Refactor Preview']) {
		const listed = await commandsOfCategory(page, category);
		if (listed.length) {
			throw new Error(`The Command Palette lists commands of a family BaseHalf does not have: ${listed.join(' | ')}`);
		}
	}
	// What the palette still lists is there: the check above did not pass on an empty list.
	if (!(await commandsOfCategory(page, 'Git')).length) {
		throw new Error('The Command Palette lists no Git command; the check of the hidden families checked nothing');
	}
	await assertCompetingViewContainersHidden(page);
}

async function commandsOfCategory(page, category) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(`>${category}: `);
	await page.locator('.quick-input-list .monaco-list-row[role="option"]').first().waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForTimeout(300);
	const labels = await page.locator('.quick-input-list .monaco-list-row[role="option"] .label-name').evaluateAll(nodes => nodes.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim()));
	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	return labels.filter(label => label.startsWith(`${category}: `));
}

// The More menu of the title bar and its Accounts hold only what BaseHalf has, in BaseHalf's order (D141, D155).
export async function assertTitleBarMenusHoldWhatBaseHalfHas(page) {
	const more = await moreMenu(page);
	// Settings is the first entry. The entries of an update follow these, in a window that looks for updates.
	const expected = ['Settings', 'Keyboard Shortcuts', 'Themes', 'Layout Density', 'Command Palette...', 'Customize Layout...', 'Accounts'];
	if (JSON.stringify(more.slice(0, expected.length)) !== JSON.stringify(expected)) {
		throw new Error(`The More menu does not start with ${expected.join(' | ')}: ${more.join(' | ')}`);
	}
	// Snippets is a command of the Command Palette only (D150).
	const forbidden = more.filter(entry => /^(Profiles?|Tasks|Snippets)\b/.test(entry));
	if (forbidden.length) {
		throw new Error(`The More menu holds entries of what BaseHalf does not have: ${forbidden.join(' | ')}`);
	}
	const accounts = await moreMenu(page, 'Accounts');
	for (const entry of ['Manage Accounts...', 'Manage Extension Account Preferences...']) {
		if (!accounts.includes(entry)) {
			throw new Error(`Accounts of the More menu has no ${entry}: ${accounts.join(' | ')}`);
		}
	}
	const languageModel = accounts.filter(entry => /Language Model|Copilot|Cloud Changes/.test(entry));
	if (languageModel.length) {
		throw new Error(`Accounts of the More menu holds entries of what BaseHalf does not have: ${languageModel.join(' | ')}`);
	}
}

/** The entries of the More menu of the title bar, or of the submenu of the given name in it. Escape closes it. */
async function moreMenu(page, submenu) {
	await page.locator('.titlebar-container .action-toolbar-container [aria-label="More"]').first().click();
	const menus = page.locator('.monaco-menu');
	await menus.first().locator('.action-item .action-label').first().waitFor({ state: 'visible', timeout: 10_000 });
	if (submenu) {
		await menus.first().locator('.action-item', { hasText: submenu }).first().hover();
		await menus.nth(1).locator('.action-item .action-label').first().waitFor({ state: 'visible', timeout: 10_000 });
	}
	const entries = await menus.nth(submenu ? 1 : 0).evaluate(menu => Array.from(menu.querySelectorAll(':scope > .monaco-action-bar > .actions-container > .action-item .action-label'))
		.map(node => (node.textContent || '').trim()).filter(Boolean));
	for (let tries = 0; tries < 3 && await menus.count(); tries++) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
	}
	await menus.first().waitFor({ state: 'hidden', timeout: 10_000 });
	return entries;
}

// Output opens as a document over the canvas, and the bottom panel stays shut (D141).
export async function assertOutputOpensOverTheCanvas(page) {
	await runCommand(page, 'Git: Show Git Output');
	const overlay = page.locator('.monaco-modal-editor-block');
	await overlay.waitFor({ state: 'visible', timeout: 15_000 });
	await overlay.locator('.monaco-editor .view-line').first().waitFor({ state: 'visible', timeout: 15_000 });
	const panel = await page.locator('.part.panel').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0));
	if (panel) {
		throw new Error('Show Git Output opened the bottom panel');
	}
	await assertCompetingViewContainersHidden(page);
	await page.keyboard.press('Escape');
	await overlay.waitFor({ state: 'hidden', timeout: 15_000 });
}

// A key that the base gives to a surface BaseHalf does not have opens nothing (D141).
export async function assertKeysOfHiddenCommandsOpenNothing(page) {
	const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
	for (const key of [`${mod}+Shift+U`, `${mod}+Shift+M`, `${mod}+Shift+D`, `${mod}+Shift+X`, 'F5', `${mod}+Shift+B`]) {
		await page.keyboard.press(key);
		await page.waitForTimeout(400);
		const panel = await page.locator('.part.panel').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0));
		if (panel) {
			throw new Error(`The key ${key} opened the bottom panel`);
		}
		await assertCompetingViewContainersHidden(page);
		const toasts = await page.locator('.notification-toast .notification-list-item-message').evaluateAll(nodes => nodes.map(node => node.textContent || ''));
		if (toasts.some(text => /not found/.test(text))) {
			throw new Error(`The key ${key} ran a command BaseHalf does not have: ${toasts.join(' | ')}`);
		}
	}
}

async function assertCommandAbsentFromPalette(page, command) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(`>${command}`);
	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const rowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	if (!/^No matching/.test(rowText) && isExpectedCommandRow(rowText, command)) {
		throw new Error(`The Command Palette lists a command BaseHalf does not have: ${command}`);
	}
}
