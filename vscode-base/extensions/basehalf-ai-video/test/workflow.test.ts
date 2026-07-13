/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createMediaNode,
	invalidateDownstreamNodes,
	nodeById,
	nodeReadiness,
	orderedSequenceVideoNodes,
	parseAIProject,
	runnableNodeIdsInWorkflowOrder,
	selectedOutputPaths,
	serializeAIProject,
	validateWorkflowConnection,
	type AIProjectImageNode,
	type AIProjectVideoNode
} from '../src/model.ts';
import { addCompletedRun, createCurrentWorkflowFixture } from './fixture.ts';

test('stores the current workflow as four media kinds plus structural groups and sequence', () => {
	const project = createCurrentWorkflowFixture();
	project.nodes.push(createMediaNode('audio', { x: 120, y: 520 }));
	assert.deepStrictEqual([...new Set(project.nodes.map(node => node.kind))].sort(), ['audio', 'image', 'text', 'video']);
	assert.equal(project.groups.length, 1);
	assert.deepStrictEqual(project.sequence.map(item => item.videoNodeId), ['video-1']);
	assert.equal(JSON.parse(new TextDecoder().decode(serializeAIProject(project))).version, 4);
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

test('schedules an image before the video that consumes it', () => {
	const project = createCurrentWorkflowFixture();
	assert.deepStrictEqual(runnableNodeIdsInWorkflowOrder(project), ['image-1', 'video-1']);
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
	project.edges.push({ id: 'video-chain', source: 'video-1', target: 'video-2', media: 'video' });
	assert.match(validateWorkflowConnection(project, 'video-2', 'video-1').reason ?? '', /cycle/);
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
