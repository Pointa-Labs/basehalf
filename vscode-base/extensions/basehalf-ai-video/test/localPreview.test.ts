/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_BRIEF_RECIPE_ID, CLIP_BRIEF_RECIPE_ID, STORYBOARD_FRAME_RECIPE_ID } from '../src/domain.ts';
import { createLocalPreviewArtifact } from '../out/localPreview.js';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test('renders a deterministic storyboard planning asset without claiming model output', () => {
	const artifact = createLocalPreviewArtifact({
		recipeId: STORYBOARD_FRAME_RECIPE_ID,
		nodeTitle: 'Opening frame',
		nodePath: 'video-workflow/shot-01/storyboard-frame.bhnode',
		prompt: 'A paper boat & rain <night>.',
		parameters: { 'aspect-ratio': '16:9', 'shot-label': 'Shot <01>' },
		inputs: [{ edgeId: 'edge-1', slotId: 'prompt', order: 0, source: { kind: 'text', path: 'video-workflow/shot-01/storyboard.md', text: 'A red umbrella crosses the frame.' } }]
	});
	const source = decode(artifact.bytes);
	assert.equal(artifact.fileName, 'storyboard-planning-frame.svg');
	assert.equal(artifact.kind, 'image');
	assert.match(source, /LOCAL STORYBOARD PLANNING FRAME/);
	assert.match(source, /no image model was called/);
	assert.match(source, /width="1600" height="900"/);
	assert.match(source, /Shot &lt;01&gt;/);
	assert.match(source, /paper boat &amp; rain &lt;night&gt;/);
	assert.match(source, /red umbrella crosses the/);
	assert.match(source, />frame\.<\/text>/);
});

test('renders a clip handoff as a Markdown file and states that it is not generated video', () => {
	const artifact = createLocalPreviewArtifact({
		recipeId: CLIP_BRIEF_RECIPE_ID,
		nodeTitle: 'Opening clip',
		nodePath: 'video-workflow/shot-01/clip.bhnode',
		prompt: 'Slow push in.',
		parameters: { 'duration-seconds': 7, 'aspect-ratio': '9:16', 'audio-mode': 'auto' },
		inputs: [
			{ edgeId: 'edge-1', slotId: 'prompt', order: 0, source: { kind: 'text', path: 'video-workflow/shot-01/storyboard.md', text: 'The character hesitates before entering.' } },
			{ edgeId: 'edge-2', slotId: 'first-frame', order: 1, source: { kind: 'image', path: 'video-workflow/shot-01/storyboard-frame.bhnode' } }
		]
	});
	const source = decode(artifact.bytes);
	assert.equal(artifact.fileName, 'clip-previsualization.md');
	assert.equal(artifact.kind, 'file');
	assert.match(source, /not generated video/);
	assert.match(source, /no video model was called/);
	assert.match(source, /Duration: 7 seconds/);
	assert.match(source, /Slow push in/);
	assert.match(source, /first-frame: `video-workflow\/shot-01\/storyboard-frame\.bhnode`/);
	assert.match(source, /character hesitates before entering/);
	assert.doesNotMatch(source, /\.mp4/);
});

test('renders an audio handoff as a Markdown file and states that it is not generated audio', () => {
	const artifact = createLocalPreviewArtifact({
		recipeId: AUDIO_BRIEF_RECIPE_ID,
		nodeTitle: 'Opening voice',
		nodePath: 'video-workflow/shot-01/voice.bhnode',
		prompt: 'Whispered delivery.',
		parameters: { purpose: 'voice', 'duration-seconds': 5, voice: 'auto' },
		inputs: []
	});
	const source = decode(artifact.bytes);
	assert.equal(artifact.fileName, 'audio-previsualization.md');
	assert.equal(artifact.kind, 'file');
	assert.match(source, /not generated audio/);
	assert.match(source, /no audio model was called/);
	assert.match(source, /Whispered delivery/);
	assert.match(source, /No direct inputs connected/);
});
