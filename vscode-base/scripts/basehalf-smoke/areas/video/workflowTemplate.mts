/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// No plugin surface, the Video workflow template, and its Sequence.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { videoSmokeProvider } from './generationCards.mts';
import {
	cardInformationFiles,
	closeAgentArea,
	mirrorFolder,
	readGenerationCard,
	readGenerationInfo,
	readMade,
	readUpstreamSidecar,
	runGenerateInTerminal,
	watchGenerations,
	workspaceFile,
	writeGenerationInfo
} from './generationProbes.mts';
import { workspacePath } from '../../context.mts';
import { assertCanvasEdgeVisible, assertCanvasFolder, openRootCanvas, waitForCanvasCardSelection } from '../../lib/canvas.mts';
import { SMOKE_PROVIDER } from '../../lib/providers.mts';
import { tryRunCommand, visibleQuickInput } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

const WORKFLOW = 'Video Starter Workflow';
const SHOT = `${WORKFLOW}/shots/shot-01`;
const SHOT_CLIP = `${SHOT}/clip.mp4`;

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


// Generation cards, "Sequence and the starter template": the starter makes
// folders, notes, a video draft whose inputs are the shot's notes, and an
// empty Sequence, with the connections it declares; every shot folder holds
// a note, and nothing of it is a node file.
export async function assertVideoWorkflowTemplate(page) {
	const workflowRoot = path.join(workspacePath, WORKFLOW);
	await openRootCanvas(page);
	await runCommandWhenAvailable(page, 'Create Video Workflow…');
	await waitUntil(() => [
		'README.md',
		'brief.md',
		'script.md',
		'shots/shot-01/storyboard.md',
		'shots/shot-01/audio-plan.md',
		'shots/shot-01/shot.json',
		'video-sequence.json'
	].every(relativePath => fs.existsSync(path.join(workflowRoot, relativePath))) && readGenerationInfo(SHOT_CLIP) !== undefined, 'the files and the draft of the video workflow template to be created', 20_000);
	await assertCanvasFolder(page, '');
	const workflowCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${WORKFLOW}"]`);
	await workflowCard.waitFor({ state: 'visible', timeout: 15_000 });
	await waitForCanvasCardSelection(page, WORKFLOW, 15_000);
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas template creation opened content instead of staying on the parent canvas');
	}
	await workflowCard.dblclick();
	await assertCanvasFolder(page, WORKFLOW);
	for (const relativePath of ['brief.md', 'script.md', 'video-sequence.json', 'shots']) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${WORKFLOW}/${relativePath}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	}
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${WORKFLOW}/shots"]`).dblclick();
	await assertCanvasFolder(page, `${WORKFLOW}/shots`);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${SHOT}"]`).dblclick();
	await assertCanvasFolder(page, SHOT);
	for (const relativePath of ['storyboard.md', 'audio-plan.md', 'shot.json', 'clip.mp4']) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${SHOT}/${relativePath}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	}
	// The video card of the shot is a draft: its prompt and settings, its inputs, and no file.
	const clip = await waitForReading(() => readGenerationCard(page, SHOT_CLIP), card => card?.face?.state === 'draft', `the card of ${SHOT_CLIP} to show a draft`);
	if (clip.generation !== 'draft' || clip.kind !== 'video' || fs.existsSync(workspaceFile(SHOT_CLIP))
		|| JSON.stringify(readGenerationInfo(SHOT_CLIP)) !== JSON.stringify({ prompt: '' })
		|| JSON.stringify(readUpstreamSidecar(SHOT_CLIP)) !== JSON.stringify([`${SHOT}/storyboard.md`, `${SHOT}/audio-plan.md`])
		|| JSON.stringify(cardInformationFiles(SHOT_CLIP)) !== JSON.stringify(['generation.yaml', 'upstream.yaml'])) {
		throw new Error(`The starter workflow must make the shot's video draft, connected to its notes: ${JSON.stringify({ clip, info: readGenerationInfo(SHOT_CLIP), upstream: readUpstreamSidecar(SHOT_CLIP), files: cardInformationFiles(SHOT_CLIP) })}`);
	}
	await assertCanvasEdgeVisible(page, `${SHOT}/storyboard.md`, SHOT_CLIP);
	await assertCanvasEdgeVisible(page, `${SHOT}/audio-plan.md`, SHOT_CLIP);
	// No node file and no outputs folder; every shot folder holds a note, so that git keeps it.
	const files = [];
	const visit = folder => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const full = path.join(folder, entry.name);
			files.push(path.relative(workflowRoot, full).split(path.sep).join('/'));
			if (entry.isDirectory()) {
				visit(full);
			}
		}
	};
	visit(workflowRoot);
	const shots = fs.readdirSync(path.join(workflowRoot, 'shots'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
	if (files.some(file => file.endsWith('.bhnode') || file.split('/').includes('outputs')) || !shots.length
		|| shots.some(shot => !fs.readdirSync(path.join(workflowRoot, 'shots', shot)).some(name => name.endsWith('.md')))) {
		throw new Error(`The starter workflow must make no node file and a note in every shot folder: ${JSON.stringify(files)}`);
	}
	// Template references are stored once, in each target: a Markdown target
	// keeps them in its frontmatter, merged by the planner.
	const script = fs.readFileSync(path.join(workflowRoot, 'script.md'), 'utf8');
	if (!script.startsWith(`---\nupstream:\n  - ${WORKFLOW}/brief.md\n---\n# Script\n`)) {
		throw new Error(`The starter workflow did not store the brief → script connection in script.md: ${JSON.stringify(script.slice(0, 120))}`);
	}
	if (fs.existsSync(path.join(workspacePath, '.bh', 'mirror', WORKFLOW, 'brief.md', 'badge.yaml'))) {
		throw new Error('The starter workflow wrote a badge for a template connection');
	}
}

// Generation cards, criteria 1 and 30: the shot's video draft generates as
// an agent asks, with the text of the shot's notes joined to its prompt;
// made.yaml names the notes and holds the card's own prompt, not their text.
// Add Video Result to Sequence adds the video with the id of its made.yaml;
// when another video takes its path, Show Video Sequence Status says that the
// clip changed; Repair Moved Video Sequence Clip finds the moved video by
// that id and updates only the path.
export async function assertSequenceAddsGeneratedVideo(page) {
	const provider = await videoSmokeProvider();
	writeGenerationInfo(SHOT_CLIP, { prompt: '', provider: SMOKE_PROVIDER, model: 'seedance-2.5', mode: 'frames' });
	await page.waitForTimeout(500);
	const requestsBefore = provider.mock.requests.length;
	const watch = watchGenerations([SHOT]);
	const answer = await runGenerateInTerminal(page, SHOT_CLIP);
	if (answer.ok !== true || JSON.stringify(answer.cards) !== JSON.stringify([SHOT_CLIP])) {
		throw new Error(`basehalf --generate must start the shot's video: ${JSON.stringify(answer)}`);
	}
	await watch.until(w => w.first()?.removed && fs.existsSync(workspaceFile(SHOT_CLIP)) && readMade(SHOT_CLIP) !== undefined, 'the shot\'s video to land');
	watch.stop();
	const made = readMade(SHOT_CLIP);
	if (made.prompt !== '' || JSON.stringify(made.inputs) !== JSON.stringify([`${SHOT}/storyboard.md`, `${SHOT}/audio-plan.md`])) {
		throw new Error(`made.yaml must hold the card's own prompt and the paths of its notes, not their text: ${JSON.stringify(made)}`);
	}
	const requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || !requests[0].prompt?.includes('Describe what the viewer sees.') || !requests[0].prompt.includes('Write the lines spoken in this shot') || requests[0].prompt.includes('---')) {
		throw new Error(`The prompt sent must be the text of the shot's notes: ${JSON.stringify(requests)}`);
	}
	await closeAgentArea(page);

	await runCommandWhenAvailable(page, 'Add Video Result to Sequence…');
	const input = visibleQuickInput(page);
	await input.waitFor({ state: 'visible', timeout: 15_000 });
	await waitForReading(() => input.inputValue(), value => value === 'Shot 01', 'Add Video Result to Sequence to suggest the title of the clip');
	await page.keyboard.press('Enter');
	await input.waitFor({ state: 'hidden', timeout: 15_000 });
	const sequenceFile = path.join(workspacePath, WORKFLOW, 'video-sequence.json');
	const sequence = await waitForReading(() => JSON.parse(fs.readFileSync(sequenceFile, 'utf8')), document => document.items?.length === 1, 'the Sequence to hold the video', 15_000);
	const item = sequence.items[0];
	if (item.title !== 'Shot 01' || item.videoPath !== 'shots/shot-01/clip.mp4' || item.generationId !== made.id || 'nodeId' in item || 'videoNodePath' in item) {
		throw new Error(`The Sequence must name the video by its path and the id of its made.yaml: ${JSON.stringify(item)}`);
	}

	// The video moves in Finder, and another video takes its path.
	const moved = `${SHOT}/clip-take-1.mp4`;
	// BaseHalf takes the new video into what it follows after its quiet second.
	await page.waitForTimeout(3_000);
	fs.renameSync(workspaceFile(SHOT_CLIP), workspaceFile(moved));
	await waitUntil(() => readMade(moved)?.id === made.id && !fs.existsSync(mirrorFolder(SHOT_CLIP)), 'the record of the moved video to follow it', 20_000);
	fs.writeFileSync(workspaceFile(SHOT_CLIP), provider.video);
	await runCommandWhenAvailable(page, 'Show Video Sequence Status…');
	const rows = await waitForReading(() => page.locator('.quick-input-list .monaco-list-row[role="option"]').allInnerTexts(), texts => texts.some(text => text.includes('Shot 01')), 'the status of the Sequence to list its clip');
	if (!rows.some(text => text.includes('Shot 01') && text.includes('Changed'))) {
		throw new Error(`A clip whose path another video took must show as changed: ${JSON.stringify(rows)}`);
	}
	await page.keyboard.press('Escape');
	await visibleQuickInput(page).waitFor({ state: 'hidden', timeout: 15_000 });

	await runCommandWhenAvailable(page, 'Repair Moved Video Sequence Clip…');
	await waitForReading(() => page.locator('.quick-input-list .monaco-list-row[role="option"]').allInnerTexts(), texts => texts.some(text => text.includes('Shot 01')), 'the repair to offer the moved clip');
	await page.keyboard.press('Enter');
	const repaired = await waitForReading(() => JSON.parse(fs.readFileSync(sequenceFile, 'utf8')), document => document.items?.[0]?.videoPath === 'shots/shot-01/clip-take-1.mp4', 'the repair to update the path of the clip', 15_000);
	if (repaired.items.length !== 1 || repaired.items[0].generationId !== made.id || repaired.items[0].title !== 'Shot 01' || repaired.items[0].id !== item.id) {
		throw new Error(`The repair must update only the path of the clip: ${JSON.stringify(repaired)}`);
	}
}
