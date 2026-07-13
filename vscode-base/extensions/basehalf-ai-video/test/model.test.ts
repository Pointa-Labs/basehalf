/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AI_VIDEO_BRIEF_NODE_ID,
	AI_VIDEO_SCRIPT_NODE_ID,
	composeShotPrompt,
	createAIProject,
	createWorkflowEdgeId,
	invalidateDownstreamShots,
	parseAIProject,
	pendingShotIdsInWorkflowOrder,
	priorShotIds,
	upstreamContextNodeIds,
	upstreamWorkflowNodeIds,
	validateWorkflowConnection
} from '../src/model.ts';

test('creates a complete brief, script, direction, scene, and shot workflow', () => {
	const project = createAIProject('Episode 1');
	assert.deepStrictEqual(project.workflow.nodes.map(node => node.kind), ['brief', 'script', 'style', 'scene', 'shot']);
	assert.equal(project.workflow.edges.length, 5);
	assert.deepStrictEqual(upstreamWorkflowNodeIds(project, project.shots[0].id), [AI_VIDEO_BRIEF_NODE_ID, AI_VIDEO_SCRIPT_NODE_ID, project.styles[0].id, project.scenes[0].id]);
});

test('migrates the original list-only project into the version 3 workflow graph', () => {
	const project = parseAIProject(JSON.stringify({
		version: 1,
		title: 'Legacy',
		script: 'Opening',
		characters: [{ id: 'character-a', name: 'A', description: '' }],
		scenes: [{ id: 'scene-a', name: 'Room', description: '' }],
		shots: [{
			id: 'shot-a', title: 'Wide', sceneId: 'scene-a', prompt: 'Wide room.', dialogue: '',
			videoProvider: 'prompt-package', voiceProvider: 'none', status: 'draft', outputs: []
		}]
	}));
	assert.equal(project.version, 3);
	assert.equal(project.workflow.nodes.length, 5);
	assert.ok(project.workflow.edges.some(edge => edge.source === AI_VIDEO_BRIEF_NODE_ID && edge.target === AI_VIDEO_SCRIPT_NODE_ID));
	assert.ok(project.workflow.edges.some(edge => edge.source === 'scene-a' && edge.target === 'shot-a' && edge.kind === 'context'));
	assert.equal(project.shots[0].sceneId, 'scene-a');
	assert.equal(project.shots[0].storyboard, 'Wide room.');
});

test('migrates version 2 node positions and infers semantic edge kinds', () => {
	const v2 = {
		version: 2,
		title: 'Version 2',
		script: 'Opening',
		characters: [],
		scenes: [{ id: 'scene-a', name: 'Room', description: '' }],
		shots: [{ id: 'shot-a', title: 'Wide', sceneId: 'scene-a', prompt: '', dialogue: '', videoProvider: 'prompt-package', voiceProvider: 'none', status: 'draft', outputs: [] }],
		workflow: {
			nodes: [
				{ id: 'script', kind: 'script', position: { x: 1, y: 2 } },
				{ id: 'scene-a', kind: 'scene', position: { x: 3, y: 4 } },
				{ id: 'shot-a', kind: 'shot', position: { x: 5, y: 6 } }
			],
			edges: [
				{ id: 'e1', source: 'script', target: 'scene-a' },
				{ id: 'e2', source: 'scene-a', target: 'shot-a' }
			]
		}
	};
	const project = parseAIProject(JSON.stringify(v2));
	assert.equal(project.workflow.nodes.find(node => node.id === 'script')?.position.x, 1);
	assert.deepStrictEqual(project.workflow.edges.map(edge => edge.kind), ['context', 'context', 'context']);
});

test('requires the graph for version 3 projects', () => {
	const serialized = JSON.parse(JSON.stringify(createAIProject()));
	delete serialized.workflow;
	assert.throws(() => parseAIProject(JSON.stringify(serialized)), /workflow/);
});

test('rejects cyclic workflow dependencies', () => {
	const project = createAIProject();
	const sceneId = project.scenes[0].id;
	const shotId = project.shots[0].id;
	project.workflow.edges.push({ id: createWorkflowEdgeId(shotId, sceneId), source: shotId, target: sceneId, kind: 'context' });
	assert.throws(() => parseAIProject(JSON.stringify(project)), /incompatible|cycle/);
});

test('orders pending shots by sequence dependency instead of array position', () => {
	const project = createAIProject();
	const first = project.shots[0];
	const second = {
		...first,
		id: 'shot-second',
		title: 'Second',
		outputs: []
	};
	project.shots.unshift(second);
	project.workflow.nodes.push({ id: second.id, kind: 'shot', position: { x: 1360, y: 90 } });
	project.workflow.edges.push({ id: createWorkflowEdgeId(first.id, second.id), source: first.id, target: second.id, kind: 'sequence' });
	assert.deepStrictEqual(pendingShotIdsInWorkflowOrder(project), [first.id, second.id]);
});

test('allows an explicitly triggered run to recover interrupted shots', () => {
	const project = createAIProject();
	project.shots[0].status = 'running';
	assert.deepStrictEqual(pendingShotIdsInWorkflowOrder(project), [project.shots[0].id]);
});

test('invalidates reachable shots while preserving prior local outputs', () => {
	const project = createAIProject();
	const shot = project.shots[0];
	const downstream = { ...shot, id: 'shot-downstream', title: 'Downstream', outputs: [] };
	shot.status = 'complete';
	shot.outputs = ['episode.outputs/shot/request.json'];
	downstream.status = 'prepared';
	project.shots.push(downstream);
	project.workflow.nodes.push({ id: downstream.id, kind: 'shot', position: { x: 1360, y: 90 } });
	project.workflow.edges.push({ id: createWorkflowEdgeId(shot.id, downstream.id), source: shot.id, target: downstream.id, kind: 'sequence' });
	invalidateDownstreamShots(project, [project.scenes[0].id]);
	assert.equal(shot.status, 'draft');
	assert.equal(downstream.status, 'draft');
	assert.deepStrictEqual(shot.outputs, ['episode.outputs/shot/request.json']);
});

test('does not invalidate shots outside the edited dependency branch', () => {
	const project = createAIProject();
	project.shots[0].status = 'complete';
	project.characters.push({ id: 'character-isolated', name: 'Isolated', description: '', referenceFiles: [] });
	project.workflow.nodes.push({ id: 'character-isolated', kind: 'character', position: { x: 400, y: 500 } });
	invalidateDownstreamShots(project, ['character-isolated']);
	assert.equal(project.shots[0].status, 'complete');
});

test('validates semantic source, duplicate, and cycle connection rules', () => {
	const project = createAIProject();
	const sceneId = project.scenes[0].id;
	const shotId = project.shots[0].id;
	assert.equal(validateWorkflowConnection(project, AI_VIDEO_BRIEF_NODE_ID, AI_VIDEO_SCRIPT_NODE_ID).valid, false);
	assert.match(validateWorkflowConnection(project, sceneId, AI_VIDEO_BRIEF_NODE_ID).reason ?? '', /source/);
	assert.match(validateWorkflowConnection(project, shotId, sceneId).reason ?? '', /planning nodes/);
});

test('keeps shot sequence results separate from creative context', () => {
	const project = createAIProject();
	const first = project.shots[0];
	const second = { ...first, id: 'shot-second', title: 'Second', outputs: [] };
	project.shots.push(second);
	project.workflow.nodes.push({ id: second.id, kind: 'shot', position: { x: 1360, y: 90 } });
	project.workflow.edges.push({ id: createWorkflowEdgeId(first.id, second.id), source: first.id, target: second.id, kind: 'sequence' });
	assert.deepStrictEqual(priorShotIds(project, second.id), [first.id]);
	assert.deepStrictEqual(upstreamContextNodeIds(project, second.id), []);
	assert.ok(upstreamWorkflowNodeIds(project, second.id).includes(project.scenes[0].id));
});

test('rejects a second current scene for one shot', () => {
	const project = createAIProject();
	project.scenes.push({ id: 'scene-second', name: 'Second scene', description: '', continuity: '' });
	project.workflow.nodes.push({ id: 'scene-second', kind: 'scene', position: { x: 720, y: 310 } });
	assert.match(validateWorkflowConnection(project, 'scene-second', project.shots[0].id).reason ?? '', /only one current scene/);
});

test('requires creative brief context to reach the script', () => {
	const project = createAIProject();
	project.workflow.edges = project.workflow.edges.filter(edge => edge.target !== AI_VIDEO_SCRIPT_NODE_ID);
	assert.throws(() => parseAIProject(JSON.stringify(project)), /must connect the creative brief/);
});

test('composes a provider-neutral shot prompt from connected context', () => {
	const project = createAIProject();
	const shot = project.shots[0];
	project.scenes[0].description = 'A rain-dark bus stop under one sodium lamp.';
	project.styles[0].prompt = 'Muted blue shadows, restrained grain, natural skin texture.';
	shot.storyboard = 'Mira reaches for a letter caught beneath the bench.';
	shot.camera = 'Low medium shot, slow push in.';
	shot.motion = 'Wind lifts one corner of the letter; her hand enters and holds it still.';
	const prompt = composeShotPrompt(project, shot.id);
	assert.match(prompt, /slow push in/i);
	assert.match(prompt, /letter caught beneath the bench/i);
	assert.match(prompt, /Muted blue shadows/);
	assert.match(prompt, /5 seconds/);
});
