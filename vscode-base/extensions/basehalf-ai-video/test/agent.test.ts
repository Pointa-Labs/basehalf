/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAIVideoAgentBrief } from '../src/agent.ts';
import { createAIProject } from '../src/model.ts';

test('prepares an Agent brief that targets the local project and version 3 contract', () => {
	const project = createAIProject('Night Bus');
	project.brief.objective = 'A quiet story about returning a lost letter.';
	const prompt = createAIVideoAgentBrief('/work/Night Bus.aivideo', project);
	assert.match(prompt, /\/work\/Night Bus\.aivideo/);
	assert.match(prompt, /version 3 workflow/);
	assert.match(prompt, /storyboard/);
	assert.match(prompt, /execution prompt for every shot/);
	assert.match(prompt, /at most one current Scene context/);
	assert.match(prompt, /Do not overlap nodes/);
	assert.match(prompt, /Do not execute a paid provider/);
});
