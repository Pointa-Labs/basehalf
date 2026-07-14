/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	createAIProject,
	createMediaNode,
	createShotGroup,
	type AIProject,
	type AIProjectImageNode,
	type AIProjectTextNode,
	type AIProjectVideoNode
} from '../src/model.ts';

export function createCurrentWorkflowFixture(): AIProject {
	const project = createAIProject('Night Bus');
	const brief: AIProjectTextNode = {
		id: 'intent', kind: 'text', role: 'brief', title: 'Creative brief',
		content: 'A quiet vertical animation about returning a lost letter.',
		position: { x: 120, y: 160 }
	};
	project.nodes.push(brief);

	const group = createShotGroup(1, { x: 420, y: 120 });
	group.id = 'shot-group-1';
	group.title = 'Letter under the bench';

	const storyboard: AIProjectTextNode = {
		id: 'storyboard-1', kind: 'text', role: 'storyboard', title: 'Storyboard',
		content: 'A rain-soaked bus stop. A letter slides under the bench.',
		position: { x: 32, y: 82 }, groupId: group.id
	};
	const imagePrompt: AIProjectTextNode = {
		id: 'image-prompt-1', kind: 'text', role: 'imagePrompt', title: 'Image prompt',
		content: 'Vertical cinematic frame, wet concrete, red raincoat, sodium lamp.',
		position: { x: 412, y: 82 }, groupId: group.id
	};
	const image = createMediaNode('image', { x: 792, y: 82 }, group.id) as AIProjectImageNode;
	image.id = 'image-1';
	image.title = 'Storyboard image';
	const videoPrompt: AIProjectTextNode = {
		id: 'video-prompt-1', kind: 'text', role: 'videoPrompt', title: 'Video prompt',
		content: 'Slow push in. Wind moves the letter, then a hand holds it still.',
		position: { x: 1070, y: 82 }, groupId: group.id
	};
	const video = createMediaNode('video', { x: 1450, y: 82 }, group.id) as AIProjectVideoNode;
	video.id = 'video-1';
	video.title = 'Generated clip';
	group.nodeIds = [storyboard.id, imagePrompt.id, image.id, videoPrompt.id, video.id];

	project.groups.push(group);
	project.nodes.push(storyboard, imagePrompt, image, videoPrompt, video);
	project.edges.push(
		{ id: 'edge-storyboard-image-prompt', source: storyboard.id, target: imagePrompt.id, media: 'text' },
		{ id: 'edge-image-prompt-image', source: imagePrompt.id, target: image.id, media: 'text' },
		{ id: 'edge-storyboard-video-prompt', source: storyboard.id, target: videoPrompt.id, media: 'text' },
		{ id: 'edge-video-prompt-video', source: videoPrompt.id, target: video.id, media: 'text' },
		{ id: 'edge-image-video', source: image.id, target: video.id, media: 'image' }
	);
	project.sequence.push({ id: 'sequence-1', videoNodeId: video.id });
	return project;
}

export function addCompletedRun(node: AIProjectImageNode | AIProjectVideoNode, id: string, output: string): void {
	node.runs.push({
		id,
		createdAt: '2026-07-13T08:00:00.000Z',
		provider: 'local-preview',
		model: 'auto',
		status: 'complete',
		prompt: node.prompt,
		inputPaths: [],
		outputs: [output]
	});
	node.selectedRunId = id;
	node.status = 'complete';
}
