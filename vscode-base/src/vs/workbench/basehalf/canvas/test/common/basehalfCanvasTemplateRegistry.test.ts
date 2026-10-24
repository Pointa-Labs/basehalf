/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { BASEHALF_CANVAS_TEMPLATE_MAX_BYTES, BaseHalfCanvasTemplateRegistryService, readBaseHalfCanvasTemplateSource } from '../../common/basehalfCanvasTemplateRegistry.js';

suite('BaseHalfCanvasTemplateRegistry', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('holds BaseHalf\'s own template as its text, and reads an extension\'s from its file (D75)', async () => {
		const templates = store.add(new BaseHalfCanvasTemplateRegistryService());
		const source = JSON.stringify({ version: 1, files: [], drafts: [], cards: [], references: [] });
		store.add(templates.registerBuiltInTemplate({ namespace: 'pointa.basehalf-ai-video', id: 'pointa.basehalf-ai-video.starter-workflow', label: ' Video Starter Workflow ', source }));
		store.add(templates.registerTemplate('studio.storyboard', URI.file('/extensions/storyboard'), { id: 'studio.storyboard.board', label: 'Board', resource: 'templates/board.json' }));

		const own = templates.getTemplate('pointa.basehalf-ai-video.starter-workflow')!;
		assert.deepStrictEqual([own.label, own.extensionId, own.source], ['Video Starter Workflow', 'pointa.basehalf-ai-video', source]);
		const read: URI[] = [];
		const fileService = {
			readFile: async (resource: URI, options?: { limits?: { size?: number } }) => {
				read.push(resource);
				assert.strictEqual(options?.limits?.size, BASEHALF_CANVAS_TEMPLATE_MAX_BYTES);
				return { value: VSBuffer.fromString('{"version":1}') };
			}
		} as unknown as IFileService;
		assert.strictEqual(await readBaseHalfCanvasTemplateSource(fileService, own), source);
		assert.strictEqual(await readBaseHalfCanvasTemplateSource(fileService, templates.getTemplate('studio.storyboard.board')!), '{"version":1}');
		assert.deepStrictEqual(read.map(resource => resource.path), ['/extensions/storyboard/templates/board.json']);
	});

	test('gives BaseHalf\'s own template the same rules as an extension\'s: its namespace, a label, one id, and a bounded size', () => {
		const templates = store.add(new BaseHalfCanvasTemplateRegistryService());
		const template = { namespace: 'pointa.basehalf-ai-video', id: 'pointa.basehalf-ai-video.starter-workflow', label: 'Video Starter Workflow', source: '{}' };
		store.add(templates.registerBuiltInTemplate(template));
		assert.throws(() => templates.registerBuiltInTemplate(template), /already registered/);
		assert.throws(() => templates.registerBuiltInTemplate({ ...template, id: 'other.namespace.starter' }), /must be prefixed/);
		assert.throws(() => templates.registerBuiltInTemplate({ ...template, id: 'pointa.basehalf-ai-video.second', label: ' ' }), /1-80 characters/);
		assert.throws(() => templates.registerBuiltInTemplate({ ...template, id: 'pointa.basehalf-ai-video.large', source: 'x'.repeat(BASEHALF_CANVAS_TEMPLATE_MAX_BYTES + 1) }), /larger than a template may be/);
		assert.deepStrictEqual(templates.getTemplates().map(descriptor => descriptor.id), ['pointa.basehalf-ai-video.starter-workflow']);
	});
});
