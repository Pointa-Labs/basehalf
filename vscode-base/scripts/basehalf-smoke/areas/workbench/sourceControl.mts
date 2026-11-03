/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Source Control with git.

import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { runCommand, visibleQuickInput, waitForQuickInputResult } from '../../lib/quickInput.mts';
import { waitForReading } from '../../lib/steps.mts';

function changesPaneOf(page) {
	return page.locator('.pane', { has: page.locator('.pane-header', { hasText: 'Changes' }) }).first();
}

export async function assertSourceControlPanel(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	await page.locator('.part.sidebar .title-label h2', { hasText: /Source Control/i }).waitFor({ state: 'visible', timeout: 20_000 });
	const changesPane = changesPaneOf(page);
	await changesPane.locator('.scm-view').waitFor({ state: 'visible', timeout: 20_000 });
	await changesPane.locator('.monaco-button', { hasText: /Commit/ }).first().waitFor({ state: 'visible', timeout: 20_000 });

	await changesPane.evaluate(async element => {
		const started = Date.now();
		while (Date.now() - started < 20_000) {
			// The SCM tree is virtualized, so only assert an actual rendered
			// change instead of requiring every dirty file to share the DOM.
			const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
			if (text.includes('main')
				&& text.includes('Changes')
				&& text.includes('README.md')) {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
		throw new Error(`Source Control Changes view did not show expected Git state: ${text}`);
	});
}

/**
 * Changes shows a tree: a changed file stands under its open folder, and the
 * folder of BaseHalf's own records starts closed and opens with a click
 * (Git, SCM, GitHub, And GitGraph Boundary, "The Changes View").
 */
export async function assertSourceControlChangesAsTree(page) {
	const inFolder = path.join(workspacePath, 'src', 'in-a-folder.txt');
	const underBh = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'a-record.txt');
	fs.writeFileSync(inFolder, 'in a folder\n', 'utf8');
	fs.writeFileSync(underBh, 'a record\n', 'utf8');
	try {
		await runCommand(page, 'Git: Refresh');
		await runCommand(page, 'Source Control: Focus on Changes View');
		const changesPane = changesPaneOf(page);
		const readRows = () => changesPane.evaluate(element => Array.from(element.querySelectorAll('.monaco-list-row')).map(row => ({
			label: row.getAttribute('aria-label') ?? '',
			level: Number(row.getAttribute('aria-level')),
			expanded: row.getAttribute('aria-expanded')
		})));
		const rowOf = (rows, start) => rows.find(row => row.label === start || row.label.startsWith(`${start}, `));

		await waitForReading(readRows, rows => {
			const folder = rowOf(rows, 'src');
			const file = rowOf(rows, 'in-a-folder.txt');
			return folder?.expanded === 'true' && file?.level === folder.level + 1
				&& rowOf(rows, '.bh')?.expanded === 'false' && !rowOf(rows, 'a-record.txt');
		}, 'a tree with src open, its new file under it, and .bh closed with its record not shown');

		await changesPane.locator('.monaco-list-row[aria-label=".bh"] .monaco-icon-label').click();
		await waitForReading(readRows, rows => !!rowOf(rows, 'a-record.txt'), 'the record under .bh after a click on .bh');
	} finally {
		fs.rmSync(inFolder, { force: true });
		fs.rmSync(underBh, { force: true });
		await runCommand(page, 'Git: Refresh');
	}
}

export async function assertSourceControlPublishBranchAction(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	await page.waitForFunction(() => {
		const buttons = Array.from(document.querySelectorAll('.pane .monaco-button'));
		return buttons.some(button => (button.textContent || '').replace(/\s+/g, ' ').includes('Publish Branch'));
	}, null, { timeout: 20_000 });
}

export async function assertGitBranchCheckoutQuickPick(page) {
	await page.locator('.part.statusbar .statusbar-item', { hasText: 'main' }).first().click();
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill('branch-picker-target');
	await waitForQuickInputResult(page, 'branch-picker-target');

	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const firstRowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	if (!firstRowText.includes('branch-picker-target')) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		throw new Error(`Git branch picker did not offer branch-picker-target first: ${firstRowText}`);
	}

	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 20_000 });
}
