/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAIProject } from '../src/model.ts';
import { renderProjectTextPrevisualization, renderShotTextPrevisualization } from '../src/preview.ts';

test('renders shots in workflow order with execution prompts and sound', () => {
	const project = createAIProject('Night Bus');
	const shot = project.shots[0];
	shot.storyboard = 'A letter slides beneath a bus-stop bench.';
	shot.prompt = 'Low medium shot. A letter slides beneath the bench in rain.';
	shot.audio = 'Rain, distant tires, paper scraping concrete.';
	const preview = renderProjectTextPrevisualization(project);
	assert.match(preview, /Text previsualization: Night Bus/);
	assert.match(preview, /A letter slides beneath a bus-stop bench/);
	assert.match(preview, /paper scraping concrete/i);
	assert.match(preview, /Low medium shot/);
});

test('renders connected continuity context for one shot', () => {
	const project = createAIProject('Night Bus');
	const shot = project.shots[0];
	const preview = renderShotTextPrevisualization(project, shot, {
		characters: [{ id: 'mira', name: 'Mira', description: 'Red raincoat.', referenceFiles: [] }],
		scenes: [{ id: 'stop', name: 'Bus stop', description: 'Wet concrete.', continuity: 'Bench stays frame right.' }],
		styles: project.styles
	});
	assert.match(preview, /Mira: Red raincoat/);
	assert.match(preview, /Bench stays frame right/);
});
