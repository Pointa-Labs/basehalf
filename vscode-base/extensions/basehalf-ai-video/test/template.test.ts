/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	AI_VIDEO_RECIPE_IDS,
	ADD_SEQUENCE_ITEM_COMMAND_ID,
	CREATE_WORKFLOW_COMMAND_ID,
	INSPECT_SEQUENCE_COMMAND_ID,
	MOVE_SEQUENCE_ITEM_COMMAND_ID,
	REMOVE_SEQUENCE_ITEM_COMMAND_ID,
	REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID,
	STARTER_TEMPLATE_ID,
	UPDATE_SEQUENCE_ITEM_COMMAND_ID,
	parseAIVideoSequenceDocument,
	parseAIVideoShotDocument
} from '../src/domain.ts';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const template = JSON.parse(readFileSync(new URL('../templates/starter-workflow.json', import.meta.url), 'utf8'));

test('contributes only reviewed host recipes, projections, cleanup, commands, and Agent discovery contracts', () => {
	assert.equal(manifest.basehalf.primaryCommand, CREATE_WORKFLOW_COMMAND_ID);
	assert.deepEqual(manifest.contributes.commands.map((command: { command: string }) => command.command), [
		CREATE_WORKFLOW_COMMAND_ID,
		INSPECT_SEQUENCE_COMMAND_ID,
		ADD_SEQUENCE_ITEM_COMMAND_ID,
		MOVE_SEQUENCE_ITEM_COMMAND_ID,
		UPDATE_SEQUENCE_ITEM_COMMAND_ID,
		REMOVE_SEQUENCE_ITEM_COMMAND_ID,
		REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID
	]);
	assert.deepEqual(manifest.contributes.basehalfCanvasRecipes.map((recipe: { id: string }) => recipe.id), AI_VIDEO_RECIPE_IDS);
	assert.equal(manifest.contributes.basehalfCanvasTemplates[0].id, STARTER_TEMPLATE_ID);
	assert.equal(manifest.contributes.basehalfCanvasTemplates[0].resource, 'templates/starter-workflow.json');
	assert.equal(manifest.contributes.basehalfAgentCapabilities.length, 1);
	const capability = manifest.contributes.basehalfAgentCapabilities[0];
	assert.equal(capability.id, 'pointa.basehalf-ai-video.sequence-capability');
	assert.deepEqual(capability.documents.map((document: { kind: string }) => document.kind), [
		'pointa.basehalf-ai-video.shot',
		'pointa.basehalf-ai-video.sequence'
	]);
	const sequenceDocument = capability.documents.find((document: { kind: string }) => document.kind === 'pointa.basehalf-ai-video.sequence');
	assert.deepEqual(sequenceDocument.pin, {
		mode: 'exact-result-version',
		field: 'items[].versionId',
		targetKinds: ['video'],
		acceptedVersionStates: ['succeeded', 'imported'],
		updatePolicy: 'explicit'
	});
	assert.deepEqual(capability.operations.map((operation: { command: string }) => operation.command), [
		INSPECT_SEQUENCE_COMMAND_ID,
		ADD_SEQUENCE_ITEM_COMMAND_ID,
		MOVE_SEQUENCE_ITEM_COMMAND_ID,
		UPDATE_SEQUENCE_ITEM_COMMAND_ID,
		REMOVE_SEQUENCE_ITEM_COMMAND_ID,
		REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID
	]);
	assert.ok(capability.operations.every((operation: { deterministic: boolean }) => operation.deterministic));
	const add = capability.operations.find((operation: { command: string }) => operation.command === ADD_SEQUENCE_ITEM_COMMAND_ID);
	assert.equal(add.parameters.find((parameter: { name: string }) => parameter.name === 'itemId').required, true);
	assert.deepEqual(manifest.contributes.basehalfCardProjections, [{
		id: 'pointa.basehalf-ai-video.sequence',
		label: 'Sequence',
		icon: 'list-ordered',
		fileNames: ['video-sequence.json'],
		order: 400,
		defaultPriority: 300
	}]);
	assert.deepEqual(manifest.contributes.basehalfStructuralCleanups, [{
		id: 'pointa.basehalf-ai-video.sequence-membership',
		extensions: ['.bhnode']
	}]);
	assert.equal(manifest.contributes.jsonValidation, undefined);
	assert.equal(JSON.stringify(manifest).includes('.aivideo'), false);
});

test('keeps the starter workflow declarative and inside host-owned primitives', () => {
	assert.deepEqual(Object.keys(template).sort(), ['cards', 'files', 'nodes', 'references', 'version']);
	assert.equal(template.version, 1);
	const paths = [...template.files, ...template.nodes].map((entry: { path: string }) => entry.path);
	assert.equal(new Set(paths).size, paths.length);
	assert.equal(template.nodes.every((node: { path: string }) => node.path.endsWith('.bhnode')), true);
	assert.equal(template.nodes.every((node: { recipe?: { recipeId: string } }) => !node.recipe || AI_VIDEO_RECIPE_IDS.includes(node.recipe.recipeId as never)), true);
	assert.equal(template.cards.every((card: { path: string }) => paths.includes(card.path)), true);

	const references = new Set(template.references.map((reference: { from: string; to: string }) => `${reference.from}\u0000${reference.to}`));
	for (const node of template.nodes as readonly { path: string; recipe?: { inputBindings: readonly { sourcePath: string }[] } }[]) {
		for (const binding of node.recipe?.inputBindings ?? []) {
			assert.equal(paths.includes(binding.sourcePath), true);
			assert.equal(references.has(`${binding.sourcePath}\u0000${node.path}`), true);
		}
	}

	const forbiddenKeys = new Set(['credentials', 'current', 'history', 'outputs', 'runs', 'groups']);
	walkKeys(template, key => assert.equal(forbiddenKeys.has(key), false, `template must not contain '${key}'`));
	assert.equal(JSON.stringify(template).includes('.aivideo'), false);
});

test('starts with an empty, portable clip sequence rather than placeholder results', () => {
	const shotFile = template.files.find((file: { path: string }) => file.path === 'shots/shot-01/shot.json');
	assert.ok(shotFile);
	const shot = parseAIVideoShotDocument(shotFile.contents);
	assert.equal(shot.clipNodePath, 'clip.bhnode');
	const shotDirectory = shotFile.path.slice(0, shotFile.path.lastIndexOf('/') + 1);
	assert.ok(template.nodes.some((node: { path: string }) => node.path === `${shotDirectory}${shot.clipNodePath}`));

	const sequenceFile = template.files.find((file: { path: string }) => file.path === 'video-sequence.json');
	assert.ok(sequenceFile);
	const sequence = parseAIVideoSequenceDocument(sequenceFile.contents);
	assert.deepEqual(sequence.items, []);
	assert.equal(JSON.stringify(template).includes('versionId'), false);
	assert.equal(template.references.some((reference: { from: string; to: string }) => reference.to === 'video-sequence.json'), false);

	const readme = template.files.find((file: { path: string }) => file.path === 'README.md');
	assert.ok(readme);
	assert.match(readme.contents, /ordered list of exact Video results/);
	assert.match(readme.contents, /Add Current Video to Sequence/);
	assert.match(readme.contents, /Show Video Sequence Status/);
	assert.match(readme.contents, /Remove Video Sequence Clip/);
	assert.match(readme.contents, /does not silently change/);
});

test('keeps planning outputs honest and reserves media nodes for real media', () => {
	const nodes = new Map(template.nodes.map((node: { path: string }) => [node.path, node]));
	assert.equal(nodes.get('shots/shot-01/storyboard-frame.bhnode').kind, 'image');
	assert.equal(nodes.get('shots/shot-01/audio-plan.bhnode').kind, 'file');
	assert.equal(nodes.get('shots/shot-01/clip-plan.bhnode').kind, 'file');
	assert.equal(nodes.get('shots/shot-01/audio.bhnode').kind, 'audio');
	assert.equal(nodes.get('shots/shot-01/audio.bhnode').recipe, undefined);
	assert.equal(nodes.get('shots/shot-01/clip.bhnode').kind, 'video');
	assert.equal(nodes.get('shots/shot-01/clip.bhnode').recipe, undefined);
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
