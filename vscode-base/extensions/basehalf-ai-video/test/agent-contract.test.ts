/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAIVideoAgentBrief } from '../out/agent.js';
import { createCurrentWorkflowFixture } from './fixture.ts';

test('asks the existing Agent to build the current local workflow contract', () => {
	const prompt = createAIVideoAgentBrief('/work/Night Bus.aivideo', createCurrentWorkflowFixture());
	assert.match(prompt, /\/work\/Night Bus\.aivideo/);
	assert.match(prompt, /complete version 4 workflow/);
	assert.match(prompt, /"text", "image", "video", and "audio"/);
	assert.match(prompt, /One Shot Group per intended clip/);
	assert.match(prompt, /playback order/);
	assert.match(prompt, /never represents editing or a combined final movie/);
	assert.match(prompt, /Preserve all existing runs/);
	assert.match(prompt, /Never place credentials in this project/);
	assert.match(prompt, /Exact JSON contract/);
	assert.match(prompt, /SequenceItem/);
});
