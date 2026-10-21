/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What BaseHalf hides of VS Code: Open Editors, competing views, status bar items, and commands.

import process from 'process';
import { isExpectedCommandRow, tryRunCommand, visibleQuickInput } from '../../lib/quickInput.mts';

export async function assertOpenEditorsHidden(page) {
	const headers = await page.locator('.pane-header h3.title').evaluateAll(nodes => nodes.map(node => (node.textContent || '').trim()).filter(text => text === 'Open Editors'));
	if (headers.length) {
		throw new Error('Open Editors view is visible in Explorer');
	}
}

export async function assertCompetingViewContainersHidden(page) {
	const forbidden = ['Extensions', 'Chat', 'Run and Debug', 'Debug Console', 'Testing', 'Test Results', 'Problems', 'Remote Explorer', 'Terminal'];
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
	for (const command of [
		'Extensions: Install Extensions',
		'Extensions: Install from VSIX...',
		'Extensions: Install Extension from Location...'
	]) {
		await assertCommandAbsentFromPalette(page, command);
	}
	const hiddenSurfaceCommands = [
		'Extensions: Focus on Extensions View',
		'Chat: Open Chat',
		'View: Show Run and Debug',
		'Debug Console: Focus on Debug Console View',
		'View: Show Testing',
		'Problems: Focus on Problems View',
		'View: Show Remote Explorer'
	];
	let exercisedCommands = 0;
	for (const command of hiddenSurfaceCommands) {
		console.error(`[basehalf-smoke] try hidden command ${command}`);
		if (await tryRunCommand(page, command, { expectedBestRowText: command })) {
			exercisedCommands++;
		}
		await assertCompetingViewContainersHidden(page);
		console.error(`[basehalf-smoke] pass hidden command ${command}`);
	}
	if (!exercisedCommands) {
		throw new Error('Hidden surface runtime guard did not exercise any VS Code command palette entries');
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
		throw new Error(`Stock extension installation command is exposed in the BaseHalf command palette: ${command}`);
	}
}
