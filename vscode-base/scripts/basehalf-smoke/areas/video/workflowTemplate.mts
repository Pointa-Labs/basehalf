/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// No plugin surface, and the Video workflow template.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, openRootCanvas, waitForCanvasCardSelection } from '../../lib/canvas.mts';
import { tryRunCommand, visibleQuickInput } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

async function runCommandWhenAvailable(page, value, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	do {
		if (await tryRunCommand(page, value, { expectedBestRowText: value })) {
			return;
		}
		await page.waitForTimeout(250);
	} while (Date.now() < deadline);
	throw new Error(`Command did not become available in QuickInput: ${value}`);
}

// The plugin platform is frozen and AI Video is built in
// (docs/specs/built-in-ai-video-and-plugin-freeze.md). The product has no
// plugin surface: the sidebar shows exactly Files, Git, and Search, and no
// command opens Plugins or manages a plugin.
export async function assertNoPluginSurface(page) {
	if (await page.locator('.part.sidebar .sidebar-utility-footer').count()) {
		throw new Error('The retired custom sidebar plugin footer is still mounted');
	}
	const compositeBarLabels = await page.locator([
		'.part.activitybar .composite-bar .action-item .action-label',
		'.part.sidebar .composite-bar .action-item .action-label'
	].join(', ')).evaluateAll(elements => elements
		.filter(element => (element as HTMLElement).offsetParent !== null)
		.map(element => (element.getAttribute('aria-label') ?? '').trim())
		.filter(label => label.length > 0 && !/^Additional Views/.test(label)));
	const expectedAreas = [/^(Explorer|Files)\b/, /^Source Control\b/, /^Search\b/];
	if (compositeBarLabels.length !== expectedAreas.length
		|| !expectedAreas.every(area => compositeBarLabels.some(label => area.test(label)))) {
		throw new Error(`The sidebar does not show exactly Files, Git, and Search: ${JSON.stringify(compositeBarLabels)}`);
	}
	if (await page.locator('.basehalf-plugins-view, .basehalf-plugin-library').count()) {
		throw new Error('A frozen plugin surface is mounted in the workbench');
	}

	const previousQuickInput = visibleQuickInput(page);
	if (await previousQuickInput.isVisible().catch(() => false)) {
		await page.keyboard.press('Escape');
		await previousQuickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	}
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	// Positive control: the palette must show a command it is known to have,
	// so that a list without plugin commands is a filtered command list and not
	// an unfilled or stale one.
	await quickInput.fill('>Reload Window');
	const controlRow = page.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: 'Reload Window' }).first();
	await controlRow.waitFor({ state: 'visible', timeout: 15_000 });
	// No letter sequence of "Plugin" matches "Reload Window", so the control
	// row leaving the list shows that the list was filtered for the new query.
	await quickInput.fill('>Plugin');
	await controlRow.waitFor({ state: 'hidden', timeout: 15_000 });
	const readCommandRows = () => page.locator('.quick-input-list .monaco-list-row[role="option"]')
		.evaluateAll(rows => rows.map(row => (row.getAttribute('aria-label') ?? row.textContent ?? '').replace(/\s+/g, ' ').trim()));
	let commandRows = await readCommandRows();
	for (let settledReads = 0; settledReads < 2;) {
		await page.waitForTimeout(250);
		const next = await readCommandRows();
		settledReads = JSON.stringify(next) === JSON.stringify(commandRows) ? settledReads + 1 : 0;
		commandRows = next;
	}
	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	const pluginCommands = commandRows.filter(row => /plug-?in/i.test(row));
	if (pluginCommands.length) {
		throw new Error(`The Command Palette still lists plugin commands: ${JSON.stringify(pluginCommands)}`);
	}
}

export async function assertVideoWorkflowTemplate(page) {
	const workflowName = 'Video Starter Workflow';
	const workflowRoot = path.join(workspacePath, workflowName);
	await openRootCanvas(page);
	await runCommandWhenAvailable(page, 'Create Video Workflow…');
	await waitUntil(() => [
		'brief.md',
		'script.md',
		'shots/shot-01/storyboard.md',
		'shots/shot-01/audio-plan.md',
		'shots/shot-01/clip.bhnode',
		'video-sequence.json'
	].every(relativePath => fs.existsSync(path.join(workflowRoot, relativePath))), 'video workflow template files to be created', 20_000);
	await assertCanvasFolder(page, '');
	const workflowCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}"]`);
	await workflowCard.waitFor({ state: 'visible', timeout: 15_000 });
	await waitForCanvasCardSelection(page, workflowName, 15_000);
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas template creation opened content instead of staying on the parent canvas');
	}
	await workflowCard.dblclick();
	await assertCanvasFolder(page, workflowName);
	for (const relativePath of [
		'brief.md',
		'script.md',
			'video-sequence.json',
		'shots'
	]) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/${relativePath}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	}
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots"]`).dblclick();
	await assertCanvasFolder(page, `${workflowName}/shots`);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots/shot-01"]`).dblclick();
	await assertCanvasFolder(page, `${workflowName}/shots/shot-01`);
	for (const relativePath of [
		'storyboard.md',
		'audio-plan.md',
		'clip.bhnode'
	]) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots/shot-01/${relativePath}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	}
	// The starter makes one empty Video node of version 6, whose inputs are
	// the shot's notes, and no planning nodes (D58, D59).
	const shotNodes = fs.readdirSync(path.join(workflowRoot, 'shots/shot-01')).filter(name => name.toLowerCase().endsWith('.bhnode'));
	const clipNode = JSON.parse(fs.readFileSync(path.join(workflowRoot, 'shots/shot-01/clip.bhnode'), 'utf8'));
	if (JSON.stringify(shotNodes) !== JSON.stringify(['clip.bhnode'])
		// A new Video node may start with the settings last used on this computer.
		|| JSON.stringify(Object.keys(clipNode).filter(key => key !== 'generation')) !== JSON.stringify(['version', 'id', 'kind', 'title', 'prompt', 'upstream'])
		|| clipNode.version !== 6
		|| clipNode.kind !== 'video'
		|| clipNode.prompt !== ''
		|| JSON.stringify(clipNode.upstream) !== JSON.stringify([`${workflowName}/shots/shot-01/storyboard.md`, `${workflowName}/shots/shot-01/audio-plan.md`])) {
		throw new Error(`The starter workflow did not produce one empty Video node: ${JSON.stringify({ shotNodes, clipNode })}`);
	}
	// Template references are stored once, in each target: a Markdown target
	// keeps them in its frontmatter, merged by the planner.
	const script = fs.readFileSync(path.join(workflowRoot, 'script.md'), 'utf8');
	if (!script.startsWith(`---\nupstream:\n  - ${workflowName}/brief.md\n---\n# Script\n`)) {
		throw new Error(`The starter workflow did not store the brief → script connection in script.md: ${JSON.stringify(script.slice(0, 120))}`);
	}
	if (fs.existsSync(path.join(workspacePath, '.bh', 'mirror', workflowName, 'brief.md', 'badge.yaml'))) {
		throw new Error('The starter workflow wrote a badge for a template connection');
	}
}
