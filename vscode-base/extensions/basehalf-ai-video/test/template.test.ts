/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	ADD_SEQUENCE_ITEM_COMMAND_ID,
	CREATE_WORKFLOW_COMMAND_ID,
	INSPECT_SEQUENCE_COMMAND_ID,
	MOVE_SEQUENCE_ITEM_COMMAND_ID,
	REMOVE_SEQUENCE_ITEM_COMMAND_ID,
	REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID,
	STARTER_TEMPLATE_ID,
	parseAIVideoSequenceDocument,
	parseAIVideoShotDocument
} from '../src/domain.ts';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const template = JSON.parse(readFileSync(new URL('../templates/starter-workflow.json', import.meta.url), 'utf8'));

interface TemplateDraft {
	readonly path: string;
	readonly prompt?: string;
}

test('contributes the commands, Sequence, template, and Agent contracts, and nothing of the retired recipe platform or node documents', () => {
	assert.equal(manifest.basehalf.primaryCommand, CREATE_WORKFLOW_COMMAND_ID);
	// Deleting a video changes no Sequence, so AI Video contributes no structural cleanup (D63).
	assert.deepEqual(Object.keys(manifest.contributes).sort(), ['basehalfAgentCapabilities', 'basehalfCanvasTemplates', 'basehalfCardProjections', 'commands']);
	assert.deepEqual(manifest.contributes.commands.map((command: { command: string }) => command.command), [
		CREATE_WORKFLOW_COMMAND_ID,
		INSPECT_SEQUENCE_COMMAND_ID,
		ADD_SEQUENCE_ITEM_COMMAND_ID,
		MOVE_SEQUENCE_ITEM_COMMAND_ID,
		REMOVE_SEQUENCE_ITEM_COMMAND_ID,
		REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID
	]);
	// The provider commands are internal: they activate AI Video but are not in the Command Palette.
	assert.deepEqual(manifest.activationEvents, [
		'onCommand:basehalf.video.provider.catalog',
		'onCommand:basehalf.video.provider.check',
		'onCommand:basehalf.video.provider.submit',
		'onCommand:basehalf.video.provider.poll',
		'onCommand:basehalf.video.provider.download',
		'onCommand:basehalf.video.provider.cancel',
		'onCommand:basehalf.video.provider.place'
	]);
	assert.equal(manifest.contributes.basehalfCanvasTemplates[0].id, STARTER_TEMPLATE_ID);
	assert.equal(manifest.contributes.basehalfCanvasTemplates[0].resource, 'templates/starter-workflow.json');
	const capability = manifest.contributes.basehalfAgentCapabilities[0];
	assert.equal(manifest.contributes.basehalfAgentCapabilities.length, 1);
	assert.equal(capability.id, 'pointa.basehalf-ai-video.sequence-capability');
	assert.deepEqual(capability.documents.map((document: { kind: string }) => document.kind), ['pointa.basehalf-ai-video.shot', 'pointa.basehalf-ai-video.sequence']);
	assert.deepEqual(capability.operations.map((operation: { command: string }) => operation.command), [
		INSPECT_SEQUENCE_COMMAND_ID,
		ADD_SEQUENCE_ITEM_COMMAND_ID,
		MOVE_SEQUENCE_ITEM_COMMAND_ID,
		REMOVE_SEQUENCE_ITEM_COMMAND_ID,
		REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID
	]);
	assert.ok(capability.operations.every((operation: { deterministic: boolean }) => operation.deterministic));
	// Add Video Result to Sequence takes a video card with its file.
	assert.deepEqual(capability.operations[1].parameters.map((parameter: { name: string }) => parameter.name), ['sequence', 'video', 'itemId', 'title']);
	assert.deepEqual(manifest.contributes.basehalfCardProjections, [{
		id: 'pointa.basehalf-ai-video.sequence',
		label: 'Sequence',
		icon: 'list-ordered',
		fileNames: ['video-sequence.json'],
		order: 400,
		defaultPriority: 300
	}]);
	const text = JSON.stringify(manifest);
	for (const retired of ['basehalfCanvasRecipes', 'basehalfModelProviderCatalogs', 'basehalfVideoModelCatalogs', 'basehalfStructuralCleanups', 'models/', '.aivideo', '.bhnode', 'Video node', 'nodeId', 'videoNodePath']) {
		assert.equal(text.includes(retired), false, retired);
	}
});

test('makes notes, a video draft, and an empty Sequence, and nothing that runs (D63)', () => {
	assert.deepEqual(Object.keys(template).sort(), ['cards', 'drafts', 'files', 'references', 'version']);
	const drafts = template.drafts as readonly TemplateDraft[];
	// A draft is declared by its path and, optionally, its prompt; its file lands under that name.
	assert.deepEqual(drafts, [{ path: 'shots/shot-01/clip.mp4' }]);
	for (const draft of drafts) {
		assert.deepEqual(Object.keys(draft).filter(key => !['path', 'prompt'].includes(key)), []);
	}
	const paths = [...template.files, ...drafts].map((entry: { path: string }) => entry.path);
	assert.equal(new Set(paths).size, paths.length);
	// Every card shows a file or a draft of the template; only the README stays off the canvas.
	assert.deepEqual(template.cards.map((card: { path: string }) => card.path).sort(), paths.filter(path => path !== 'README.md').sort());

	const forbiddenKeys = new Set(['nodes', 'role', 'recipe', 'attempts', 'task', 'result', 'credentials', 'outputs', 'upstream', 'generation', 'provider', 'model']);
	walkKeys(template, key => assert.equal(forbiddenKeys.has(key), false, `template must not contain '${key}'`));
	const text = JSON.stringify(template);
	for (const retired of ['.aivideo', '.bhnode', 'outputs/', 'Video node']) {
		assert.equal(text.includes(retired), false, retired);
	}
});

test('every shot folder holds a note, so that git keeps the folder of its draft', () => {
	const files = template.files as readonly { path: string }[];
	const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
	for (const draft of template.drafts as readonly TemplateDraft[]) {
		assert.ok(files.some(file => folderOf(file.path) === folderOf(draft.path) && /\.md$/.test(file.path)), draft.path);
	}
	const shotFolders = new Set(files.map(file => file.path).filter(path => path.startsWith('shots/')).map(folderOf));
	for (const folder of shotFolders) {
		assert.ok(files.some(file => folderOf(file.path) === folder && /\.md$/.test(file.path)), folder);
	}
});

test('connects the shot\'s notes to its video draft, where they join the prompt', () => {
	const paths = new Set([...template.files, ...template.drafts].map((entry: { path: string }) => entry.path));
	const upstreamByTarget = new Map<string, string[]>();
	for (const reference of template.references as readonly { from: string; to: string }[]) {
		assert.ok(paths.has(reference.from) && paths.has(reference.to), `${reference.from} -> ${reference.to}`);
		upstreamByTarget.set(reference.to, [...upstreamByTarget.get(reference.to) ?? [], reference.from]);
	}
	assert.deepEqual(upstreamByTarget.get('shots/shot-01/clip.mp4'), ['shots/shot-01/storyboard.md', 'shots/shot-01/audio-plan.md']);
	assert.equal(upstreamByTarget.has('video-sequence.json'), false);
	for (const file of template.files as readonly { path: string; contents: string }[]) {
		if (/\.(?:md|markdown)$/i.test(file.path)) {
			const frontmatter = /^(?:﻿)?---\r?\n(?<block>[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(file.contents)?.groups?.block ?? '';
			assert.equal(/^upstream\s*:/m.test(frontmatter), false, `${file.path} must not declare upstream`);
		}
	}
	const clipCard = template.cards.find((card: { path: string }) => card.path === 'shots/shot-01/clip.mp4');
	assert.deepEqual({ width: clipCard.width, height: clipCard.height }, { width: 720, height: 405 });
});

test('starts with an empty, portable clip sequence and a shot that names its video draft', () => {
	const shotFile = template.files.find((file: { path: string }) => file.path === 'shots/shot-01/shot.json');
	const shot = parseAIVideoShotDocument(shotFile.contents);
	const shotDirectory = shotFile.path.slice(0, shotFile.path.lastIndexOf('/') + 1);
	assert.ok((template.drafts as readonly TemplateDraft[]).some(draft => draft.path === `${shotDirectory}${shot.clipNodePath}`));
	const sequenceFile = template.files.find((file: { path: string }) => file.path === 'video-sequence.json');
	assert.deepEqual(parseAIVideoSequenceDocument(sequenceFile.contents).items, []);
	const readme = template.files.find((file: { path: string }) => file.path === 'README.md');
	assert.match(readme.contents, /Add Video Result to Sequence/);
	assert.match(readme.contents, /Show Video Sequence Status/);
	assert.match(readme.contents, /Remove Video Sequence Clip/);
	assert.match(readme.contents, /clip\.mp4/);
	assert.doesNotMatch(readme.contents, /sealed|recipe|Attempt|outputs|Video node|\.bhnode/i);
});

function walkKeys(value: unknown, visitor: (key: string) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			walkKeys(item, visitor);
		}
		return;
	}
	if (!value || typeof value !== 'object') {
		return;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		visitor(key);
		walkKeys(child, visitor);
	}
}
