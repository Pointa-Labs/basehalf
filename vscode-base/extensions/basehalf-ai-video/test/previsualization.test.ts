/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeById, type AIProjectImageNode, type AIProjectVideoNode } from '../src/model.ts';
import { renderMediaNodeTextPrevisualization, renderProjectTextPrevisualization } from '../out/preview.js';
import { addCompletedRun, createCurrentWorkflowFixture } from './fixture.ts';

test('renders ordered independent clip results without claiming a final edit', () => {
	const project = createCurrentWorkflowFixture();
	const image = nodeById(project, 'image-1') as AIProjectImageNode;
	const video = nodeById(project, 'video-1') as AIProjectVideoNode;
	addCompletedRun(image, 'image-run-1', 'Night Bus.outputs/image-1/storyboard.svg');
	addCompletedRun(video, 'video-run-1', 'Night Bus.outputs/video-1/clip.mp4');
	const preview = renderProjectTextPrevisualization(project);
	assert.match(preview, /Production sequence: Night Bus/);
	assert.match(preview, /1\. Letter under the bench/);
	assert.match(preview, /clip\.mp4/);
	assert.match(preview, /does not claim that a final edited movie was rendered/);
});

test('renders one media handoff with connected text and media inputs', () => {
	const project = createCurrentWorkflowFixture();
	const video = nodeById(project, 'video-1') as AIProjectVideoNode;
	const preview = renderMediaNodeTextPrevisualization(project, video, {
		text: [{ nodeId: 'video-prompt-1', title: 'Video prompt', content: 'Slow push in.' }],
		image: ['Night Bus.outputs/image-1/storyboard.svg'],
		video: [],
		audio: []
	});
	assert.match(preview, /Slow push in/);
	assert.match(preview, /storyboard\.svg/);
	assert.match(preview, /Audio mode: auto/);
});
