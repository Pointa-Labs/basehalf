/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_CANVAS_TEMPLATE_MAX_BYTES, BaseHalfCanvasTemplateRegistryService } from '../../common/basehalfCanvasTemplateRegistry.js';

suite('BaseHalfCanvasTemplateRegistry', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('holds a template as its text (D75, D76)', () => {
		const templates = store.add(new BaseHalfCanvasTemplateRegistryService());
		const source = JSON.stringify({ version: 1, files: [], drafts: [], cards: [], references: [] });
		store.add(templates.registerTemplate({ namespace: 'pointa.basehalf-ai-video', id: 'pointa.basehalf-ai-video.starter-workflow', label: ' Video Starter Workflow ', source }));

		const own = templates.getTemplate('pointa.basehalf-ai-video.starter-workflow')!;
		assert.deepStrictEqual([own.label, own.namespace, own.source], ['Video Starter Workflow', 'pointa.basehalf-ai-video', source]);
	});

	test('gives a template its namespace, a label, one id, and a bounded size', () => {
		const templates = store.add(new BaseHalfCanvasTemplateRegistryService());
		const template = { namespace: 'pointa.basehalf-ai-video', id: 'pointa.basehalf-ai-video.starter-workflow', label: 'Video Starter Workflow', source: '{}' };
		store.add(templates.registerTemplate(template));
		assert.throws(() => templates.registerTemplate(template), /already registered/);
		assert.throws(() => templates.registerTemplate({ ...template, id: 'other.namespace.starter' }), /must be prefixed/);
		assert.throws(() => templates.registerTemplate({ ...template, id: 'pointa.basehalf-ai-video.second', label: ' ' }), /1-80 characters/);
		assert.throws(() => templates.registerTemplate({ ...template, id: 'pointa.basehalf-ai-video.large', source: 'x'.repeat(BASEHALF_CANVAS_TEMPLATE_MAX_BYTES + 1) }), /larger than a template may be/);
		assert.deepStrictEqual(templates.getTemplates().map(descriptor => descriptor.id), ['pointa.basehalf-ai-video.starter-workflow']);
	});
});
