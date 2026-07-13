/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AI_VIDEO_SCRIPT_NODE_ID,
	createAIProject,
	createWorkflowEdgeId,
	invalidateDownstreamShots,
	parseAIProject,
	pendingShotIdsInWorkflowOrder,
	upstreamWorkflowNodeIds,
	validateWorkflowConnection
} from '../src/model.ts';

test('creates a connected script, scene, and shot workflow', () => {
	const project = createAIProject('Episode 1');
	assert.deepStrictEqual(project.workflow.nodes.map(node => node.kind), ['script', 'scene', 'shot']);
	assert.equal(project.workflow.edges.length, 2);
	assert.deepStrictEqual(upstreamWorkflowNodeIds(project, project.shots[0].id), [AI_VIDEO_SCRIPT_NODE_ID, project.scenes[0].id]);
});

test('migrates the original list-only project into a workflow graph', () => {
	const project = parseAIProject(JSON.stringify({
		version: 1,
		title: 'Legacy',
		script: 'Opening',
		characters: [{ id: 'character-a', name: 'A', description: '' }],
		scenes: [{ id: 'scene-a', name: 'Room', description: '' }],
		shots: [{
			id: 'shot-a', title: 'Wide', sceneId: 'scene-a', prompt: '', dialogue: '',
			videoProvider: 'prompt-package', voiceProvider: 'none', status: 'draft', outputs: []
		}]
	}));
	assert.equal(project.version, 2);
	assert.equal(project.workflow.nodes.length, 4);
	assert.ok(project.workflow.edges.some(edge => edge.source === 'scene-a' && edge.target === 'shot-a'));
	assert.equal(project.shots[0].sceneId, 'scene-a');
});

test('requires the graph for version 2 projects', () => {
	const serialized = JSON.parse(JSON.stringify(createAIProject()));
	delete serialized.workflow;
	assert.throws(() => parseAIProject(JSON.stringify(serialized)), /workflow/);
});

test('rejects cyclic workflow dependencies', () => {
	const project = createAIProject();
	const sceneId = project.scenes[0].id;
	const shotId = project.shots[0].id;
	project.workflow.edges.push({ id: createWorkflowEdgeId(shotId, sceneId), source: shotId, target: sceneId });
	assert.throws(() => parseAIProject(JSON.stringify(project)), /creates a cycle/);
});

test('orders pending shots by dependency instead of array position', () => {
	const project = createAIProject();
	const first = project.shots[0];
	const second = {
		...first,
		id: 'shot-second',
		title: 'Second',
		outputs: []
	};
	project.shots.unshift(second);
	project.workflow.nodes.push({ id: second.id, kind: 'shot', position: { x: 1100, y: 90 } });
	project.workflow.edges.push({ id: createWorkflowEdgeId(first.id, second.id), source: first.id, target: second.id });
	assert.deepStrictEqual(pendingShotIdsInWorkflowOrder(project), [first.id, second.id]);
});

test('allows an explicitly triggered run to recover interrupted shots', () => {
	const project = createAIProject();
	project.shots[0].status = 'running';
	assert.deepStrictEqual(pendingShotIdsInWorkflowOrder(project), [project.shots[0].id]);
});

test('invalidates reachable shots while preserving their prior local outputs', () => {
	const project = createAIProject();
	const shot = project.shots[0];
	const downstream = { ...shot, id: 'shot-downstream', title: 'Downstream', outputs: [] };
	shot.status = 'complete';
	shot.outputs = ['episode.outputs/shot/request.json'];
	downstream.status = 'prepared';
	project.shots.push(downstream);
	project.workflow.nodes.push({ id: downstream.id, kind: 'shot', position: { x: 1100, y: 90 } });
	project.workflow.edges.push({ id: createWorkflowEdgeId(shot.id, downstream.id), source: shot.id, target: downstream.id });
	invalidateDownstreamShots(project, [project.scenes[0].id]);
	assert.equal(shot.status, 'draft');
	assert.equal(downstream.status, 'draft');
	assert.deepStrictEqual(shot.outputs, ['episode.outputs/shot/request.json']);
});

test('does not invalidate shots that are outside the edited node dependency branch', () => {
	const project = createAIProject();
	project.shots[0].status = 'complete';
	project.characters.push({ id: 'character-isolated', name: 'Isolated', description: '' });
	project.workflow.nodes.push({ id: 'character-isolated', kind: 'character', position: { x: 80, y: 500 } });
	invalidateDownstreamShots(project, ['character-isolated']);
	assert.equal(project.shots[0].status, 'complete');
});

test('validates duplicate, source, and cycle connection rules', () => {
	const project = createAIProject();
	const sceneId = project.scenes[0].id;
	const shotId = project.shots[0].id;
	assert.equal(validateWorkflowConnection(project, AI_VIDEO_SCRIPT_NODE_ID, sceneId).valid, false);
	assert.match(validateWorkflowConnection(project, sceneId, AI_VIDEO_SCRIPT_NODE_ID).reason ?? '', /source node/);
	assert.match(validateWorkflowConnection(project, shotId, sceneId).reason ?? '', /cycle/);
});
