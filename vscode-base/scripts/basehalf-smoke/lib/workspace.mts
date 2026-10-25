/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The files of the workspace, and what BaseHalf must never install in it.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { workspacePath } from '../context.mts';
import { runCommand } from './quickInput.mts';

/** Brings Files to the front of the sidebar, with its button or, when no button shows, the command. */
export async function showExplorer(page) {
	const explorerAction = page.locator([
		'.part.activitybar .action-label.codicon-explorer-view-icon',
		'.part.activitybar .action-label[aria-label^="Explorer"]',
		'.part.activitybar .action-label[aria-label^="Files"]',
		'.part.sidebar .composite-bar .action-label.codicon-explorer-view-icon',
		'.part.sidebar .composite-bar .action-label[aria-label^="Explorer"]',
		'.part.sidebar .composite-bar .action-label[aria-label^="Files"]',
	].join(', ')).first();
	if (await explorerAction.isVisible().catch(() => false)) {
		await explorerAction.click();
	} else {
		// Projection webviews keep keyboard focus inside their iframe. Return it
		// to the workbench before invoking a host command-palette keybinding.
		await page.locator('.part.sidebar .title-label').click();
		await runCommand(page, 'Focus on Files Explorer');
	}
}

export async function openExplorerRow(page, label) {
	const row = page.locator('.explorer-viewlet .monaco-list-row', { hasText: label }).first();
	if (!(await row.isVisible().catch(() => false))) {
		await showExplorer(page);
	}
	await row.waitFor({ state: 'visible', timeout: 20_000 });
	await row.click();
	const isFolder = (await row.getAttribute('aria-expanded')) !== null;
	const openKey = process.platform === 'darwin' && !isFolder ? 'Meta+ArrowDown' : 'Enter';
	await page.keyboard.press(openKey);
}

// Opening a workspace installs nothing: BaseHalf creates no agent guide, no
// .bh/agent-harness, and no .gitignore (the fixture has none of them), and no
// focus mirror file exists.
export async function assertWorkspaceOpenInstallsNothing() {
	for (const rel of ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md', '.gitignore', '.bh/agent-harness']) {
		if (lstatOrUndefined(path.join(workspacePath, rel))) {
			throw new Error(`Opening the workspace must not create ${rel}`);
		}
	}
	assertNoFocusMirrorFiles();
}

// Neither the retired current-focus link nor any per-node focus file exists.
function assertNoFocusMirrorFiles() {
	if (lstatOrUndefined(path.join(workspacePath, '.bh', 'current_focus.yaml'))) {
		throw new Error('.bh/current_focus.yaml must not be written');
	}
	const pending = [path.join(workspacePath, '.bh', 'mirror')];
	while (pending.length > 0) {
		const directory = pending.pop();
		let entries;
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				pending.push(entryPath);
			} else if (entry.name === 'focus.yaml') {
				throw new Error(`Focus mirror file must not be written: ${path.relative(workspacePath, entryPath)}`);
			}
		}
	}
}

function lstatOrUndefined(filePath) {
	try {
		return fs.lstatSync(filePath);
	} catch {
		return undefined;
	}
}

export function readWorkspaceFile(relativePath) {
	const filePath = path.join(workspacePath, ...relativePath.split('/'));
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
}
