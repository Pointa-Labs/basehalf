/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AI_TEXT_NODE_DEFAULT_HEIGHT,
	AI_TEXT_NODE_DEFAULT_WIDTH,
	AI_TEXT_NODE_MAX_HEIGHT,
	AI_TEXT_NODE_MIN_WIDTH,
	createAIProject,
	connectWorkflowNodes,
	createMediaNode,
	invalidateDownstreamNodes,
	insertWorkflowNodeOnEdge,
	nodeById,
	nodeReadiness,
	orderedSequenceVideoNodes,
	parseAIProject,
	selectedOutputPaths,
	serializeAIProject,
	validateWorkflowConnection,
	workflowIntermediateKindsForConnection,
	workflowTargetKindsForSource,
	type AIProjectImageNode,
	type AIProjectVideoNode
} from '../src/model.ts';
import { addCompletedRun, createCurrentWorkflowFixture } from './fixture.ts';

test('starts a new project as an empty canvas', () => {
	const project = createAIProject();
	assert.deepStrictEqual(project.nodes, []);
	assert.deepStrictEqual(project.edges, []);
	assert.deepStrictEqual(project.sequence, []);
});

test('keeps Text node dimensions in local project data with safe defaults and bounds', () => {
	const project = createAIProject();
	const text = createMediaNode('text', { x: 80, y: 120 });
	assert.equal(text.width, AI_TEXT_NODE_DEFAULT_WIDTH);
	assert.equal(text.height, AI_TEXT_NODE_DEFAULT_HEIGHT);
	text.width = AI_TEXT_NODE_MIN_WIDTH - 100;
	text.height = AI_TEXT_NODE_MAX_HEIGHT + 100;
	project.nodes.push(text);

	const parsed = parseAIProject(JSON.stringify(project));
	const parsedText = nodeById(parsed, text.id);
	assert.equal(parsedText?.kind, 'text');
	if (parsedText?.kind === 'text') {
		assert.equal(parsedText.width, AI_TEXT_NODE_MIN_WIDTH);
		assert.equal(parsedText.height, AI_TEXT_NODE_MAX_HEIGHT);
	}

	const legacyShape = structuredClone(project);
	const legacyText = legacyShape.nodes[0];
	if (legacyText.kind === 'text') {
		delete legacyText.width;
		delete legacyText.height;
	}
	const defaulted = nodeById(parseAIProject(JSON.stringify(legacyShape)), text.id);
	assert.equal(defaulted?.kind === 'text' ? defaulted.width : undefined, AI_TEXT_NODE_DEFAULT_WIDTH);
	assert.equal(defaulted?.kind === 'text' ? defaulted.height : undefined, AI_TEXT_NODE_DEFAULT_HEIGHT);
});

test('stores the current workflow as four media kinds plus structural groups and sequence', () => {
	const project = createCurrentWorkflowFixture();
	project.nodes.push(createMediaNode('audio', { x: 120, y: 520 }));
	assert.deepStrictEqual([...new Set(project.nodes.map(node => node.kind))].sort(), ['audio', 'image', 'text', 'video']);
	assert.equal(project.groups.length, 1);
	assert.deepStrictEqual(project.sequence.map(item => item.videoNodeId), ['video-1']);
	assert.equal(JSON.parse(new TextDecoder().decode(serializeAIProject(project))).version, 4);
});

test('normalizes older connections to stable horizontal anchors', () => {
	const value = JSON.parse(JSON.stringify(createCurrentWorkflowFixture()));
	for (const edge of value.edges) {
		delete edge.sourceAnchor;
		delete edge.targetAnchor;
	}
	const project = parseAIProject(JSON.stringify(value));
	assert.equal(project.edges.every(edge => edge.sourceAnchor === 'east' && edge.targetAnchor === 'west'), true);
});

test('rejects an explicitly invalid connection anchor', () => {
	const value = JSON.parse(JSON.stringify(createCurrentWorkflowFixture()));
	value.edges[0].sourceAnchor = 'diagonal';
	assert.throws(() => parseAIProject(JSON.stringify(value)), /workflow anchor/);
});

test('accepts only the current project contract', () => {
	assert.throws(() => parseAIProject(JSON.stringify({ version: 3, title: 'Old' })), /Expected version 4/);
	assert.equal(parseAIProject(JSON.stringify(createCurrentWorkflowFixture())).version, 4);
});

test('recovers an interrupted run without treating it as a finished result', () => {
	const project = createCurrentWorkflowFixture();
	const image = nodeById(project, 'image-1') as AIProjectImageNode;
	image.status = 'running';
	assert.equal((nodeById(parseAIProject(JSON.stringify(project)), image.id) as AIProjectImageNode).status, 'draft');
	addCompletedRun(image, 'older-run', 'Night Bus.outputs/image-1/older.png');
	image.status = 'running';
	assert.equal((nodeById(parseAIProject(JSON.stringify(project)), image.id) as AIProjectImageNode).status, 'stale');
});

test('rejects node and Shot Group id collisions that would corrupt the canvas', () => {
	const project = createCurrentWorkflowFixture();
	project.groups[0].id = project.nodes[0].id;
	assert.throws(() => parseAIProject(JSON.stringify(project)), /share id/);
});

test('requires an image result before its dependent video can run', () => {
	const project = createCurrentWorkflowFixture();
	assert.equal(nodeReadiness(project, 'image-1').ready, true);
	assert.equal(nodeReadiness(project, 'video-1').ready, false);
	assert.match(nodeReadiness(project, 'video-1').reason ?? '', /Storyboard image/);

	const image = nodeById(project, 'image-1') as AIProjectImageNode;
	addCompletedRun(image, 'image-run-1', 'Night Bus.outputs/image-1/image.png');
	assert.equal(nodeReadiness(project, 'video-1').ready, true);
});

test('keeps immutable run history while a selected result change stales only descendants', () => {
	const project = createCurrentWorkflowFixture();
	const image = nodeById(project, 'image-1') as AIProjectImageNode;
	const video = nodeById(project, 'video-1') as AIProjectVideoNode;
	addCompletedRun(image, 'image-run-1', 'Night Bus.outputs/image-1/one.png');
	addCompletedRun(image, 'image-run-2', 'Night Bus.outputs/image-1/two.png');
	addCompletedRun(video, 'video-run-1', 'Night Bus.outputs/video-1/clip.mp4');
	image.selectedRunId = 'image-run-1';

	invalidateDownstreamNodes(project, [image.id], false);
	assert.equal(image.status, 'complete');
	assert.equal(video.status, 'stale');
	assert.equal(image.runs.length, 2);
	assert.deepStrictEqual(selectedOutputPaths(image), ['Night Bus.outputs/image-1/one.png']);
	assert.deepStrictEqual(selectedOutputPaths(video), ['Night Bus.outputs/video-1/clip.mp4']);
});

test('validates typed, unique, acyclic workflow connections', () => {
	const project = createCurrentWorkflowFixture();
	assert.match(validateWorkflowConnection(project, 'image-prompt-1', 'image-1').reason ?? '', /already exists/);
	assert.match(validateWorkflowConnection(project, 'video-1', 'image-1').reason ?? '', /not accepted/);

	const secondVideo = createMediaNode('video', { x: 1220, y: 100 }) as AIProjectVideoNode;
	secondVideo.id = 'video-2';
	project.nodes.push(secondVideo);
	project.edges.push({ id: 'video-chain', source: 'video-1', target: 'video-2', media: 'video', sourceAnchor: 'east', targetAnchor: 'west' });
	assert.match(validateWorkflowConnection(project, 'video-2', 'video-1').reason ?? '', /cycle/);
});

test('exposes the same typed connection targets to canvas composition', () => {
	assert.deepStrictEqual(workflowTargetKindsForSource('text'), ['text', 'image', 'video', 'audio']);
	assert.deepStrictEqual(workflowTargetKindsForSource('image'), ['text', 'image', 'video']);
	assert.deepStrictEqual(workflowTargetKindsForSource('video'), ['text', 'video']);
	assert.deepStrictEqual(workflowTargetKindsForSource('audio'), ['text', 'video', 'audio']);
});

test('offers only node kinds that can sit between both connection endpoints', () => {
	const project = createCurrentWorkflowFixture();
	assert.deepStrictEqual(workflowIntermediateKindsForConnection(project, 'image-prompt-1', 'image-1'), ['text', 'image']);
	assert.deepStrictEqual(workflowIntermediateKindsForConnection(project, 'image-1', 'video-1'), ['text', 'image', 'video']);
	assert.deepStrictEqual(workflowIntermediateKindsForConnection(project, 'missing', 'video-1'), []);
});

test('atomically replaces a connection when inserting a compatible node', () => {
	const project = createCurrentWorkflowFixture();
	const replaced = project.edges.find(edge => edge.id === 'edge-image-video')!;
	replaced.sourceAnchor = 'south';
	replaced.targetAnchor = 'north';
	const inserted = createMediaNode('text', { x: 650, y: 190 }, 'shot-group-1');
	inserted.id = 'inserted-direction';
	inserted.title = 'Motion direction';
	const result = insertWorkflowNodeOnEdge(project, 'edge-image-video', inserted);

	assert.equal(result.valid, true);
	assert.equal(project.edges.some(edge => edge.id === 'edge-image-video'), false);
	assert.equal(project.edges.some(edge => edge.source === 'image-1' && edge.target === inserted.id && edge.media === 'image'), true);
	assert.equal(project.edges.some(edge => edge.source === inserted.id && edge.target === 'video-1' && edge.media === 'text'), true);
	assert.equal(project.edges.find(edge => edge.source === 'image-1' && edge.target === inserted.id)?.sourceAnchor, 'south');
	assert.equal(project.edges.find(edge => edge.source === 'image-1' && edge.target === inserted.id)?.targetAnchor, 'north');
	assert.equal(project.edges.find(edge => edge.source === inserted.id && edge.target === 'video-1')?.sourceAnchor, 'south');
	assert.equal(project.edges.find(edge => edge.source === inserted.id && edge.target === 'video-1')?.targetAnchor, 'north');
	assert.equal(project.groups[0].nodeIds.includes(inserted.id), true);
	assert.equal(nodeById(project, inserted.id), inserted);
});

test('leaves the workflow untouched when an inserted node is incompatible', () => {
	const project = createCurrentWorkflowFixture();
	const snapshot = structuredClone(project);
	const inserted = createMediaNode('audio', { x: 500, y: 200 }, 'shot-group-1');
	inserted.id = 'invalid-audio';
	const result = insertWorkflowNodeOnEdge(project, 'edge-image-prompt-image', inserted);

	assert.equal(result.valid, false);
	assert.match(result.reason ?? '', /not accepted/);
	assert.deepStrictEqual(project, snapshot);
});

test('creates a validated connection to a newly composed node in one model operation', () => {
	const project = createCurrentWorkflowFixture();
	const video = createMediaNode('video', { x: 1280, y: 320 });
	video.id = 'video-from-image';
	project.nodes.push(video);
	const result = connectWorkflowNodes(project, 'image-1', video.id, 'south', 'north');
	assert.equal(result.valid, true);
	assert.deepStrictEqual(project.edges.at(-1), {
		id: project.edges.at(-1)?.id,
		source: 'image-1',
		target: video.id,
		media: 'image',
		sourceAnchor: 'south',
		targetAnchor: 'north'
	});

	const edgeCount = project.edges.length;
	assert.equal(connectWorkflowNodes(project, 'image-1', video.id).valid, false);
	assert.equal(project.edges.length, edgeCount);
});

test('keeps playback order separate from workflow dependency order', () => {
	const project = createCurrentWorkflowFixture();
	const secondVideo = createMediaNode('video', { x: 1220, y: 100 }) as AIProjectVideoNode;
	secondVideo.id = 'video-2';
	secondVideo.title = 'Second independent clip';
	project.nodes.push(secondVideo);
	project.sequence = [
		{ id: 'sequence-2', videoNodeId: secondVideo.id },
		{ id: 'sequence-1', videoNodeId: 'video-1' }
	];
	assert.deepStrictEqual(orderedSequenceVideoNodes(project).map(node => node.id), ['video-2', 'video-1']);
	assert.equal(project.edges.some(edge => edge.source === 'video-2' || edge.target === 'video-2'), false);
});

test('rejects a Shot Group whose membership differs from its contained nodes', () => {
	const project = createCurrentWorkflowFixture();
	project.groups[0].nodeIds.pop();
	assert.throws(() => parseAIProject(JSON.stringify(project)), /nodeIds do not match/);
});
