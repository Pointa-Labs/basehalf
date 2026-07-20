/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { parseBaseHalfCanvasTemplate } from '../../common/basehalfCanvasTemplate.js';

suite('BaseHalfCanvasTemplate', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const nonCanonicalContributionIds = [
		'Studio.writer.create-document',
		' studio.writer.create-document',
		'studio.writer.create-document ',
		'1studio.writer.create-document',
		'studio.2writer.create-document',
		'studio.writer.create_document',
		`studio.writer.${'a'.repeat(115)}`
	];

	test('accepts host primitives without carrying run state or credentials', () => {
		const template = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }],
			nodes: [{
				path: 'frame.bhnode',
				kind: 'image',
				title: 'Frame',
				role: 'storyboard',
				recipe: {
					recipeId: 'pointa.basehalf-ai-video.storyboard-frame',
					parameters: { ratio: '9:16' },
					inputBindings: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }]
				}
			}],
			cards: [
				{ path: 'brief.md', x: 0, y: 0, width: 300, height: 220 },
				{ path: 'frame.bhnode', x: 380, y: 0, width: 300, height: 220 }
			],
			references: [{ from: 'brief.md', to: 'frame.bhnode', fromAnchor: 'east', toAnchor: 'west' }]
		}));

		assert.strictEqual(template.nodes[0].recipe?.inputBindings[0].sourcePath, 'brief.md');
		assert.deepStrictEqual(template.references[0], {
			from: 'brief.md',
			to: 'frame.bhnode',
			fromAnchor: 'east',
			toAnchor: 'west'
		});
		assert.strictEqual(Object.hasOwn(template.nodes[0], 'runs'), false);
		assert.strictEqual(Object.hasOwn(template.nodes[0].recipe!, 'modelServiceId'), false);
	});

	test('rejects traversal, reserved metadata paths, missing endpoints, and duplicate references', () => {
		const base = {
			version: 1,
			files: [{ path: 'brief.md', contents: 'Brief' }],
			nodes: [],
			cards: [],
			references: []
		};
		for (const path of [
			'../brief.md', '.bh/mirror/brief.md', '.BH/mirror/brief.md', '/brief.md', 'folder\\brief.md',
			'folder/CON.txt', 'folder/trailing.', 'folder/control\u0001.md', 'folder/cafe\u0301.md'
		]) {
			assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
				...base,
				files: [{ path, contents: 'Brief' }]
			})), /path|reserved|unsafe/i);
		}
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			references: [{ from: 'brief.md', to: 'missing.md', fromAnchor: 'east', toAnchor: 'west' }]
		})), /created resources/);
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			files: [{ path: 'brief.md', contents: 'Brief' }, { path: 'next.md', contents: 'Next' }],
			references: [
				{ from: 'brief.md', to: 'next.md', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'brief.md', to: 'next.md', fromAnchor: 'south', toAnchor: 'north' }
			]
		})), /must not contain duplicates/);
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			files: [{ path: 'forged.bhnode', contents: '{}' }]
		})), /reserved .bhnode extension/);
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			files: [{ path: 'Brief.md', contents: 'One' }, { path: 'brief.md', contents: 'Two' }]
		})), /must not contain duplicates/);
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			files: [{ path: 'brief.md', contents: 'One' }, { path: 'brief.md/child.md', contents: 'Two' }]
		})), /cannot create a file inside another created file/);
	});

	test('accepts contribution identifiers with additional owned namespace segments', () => {
		const template = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [],
			nodes: [{
				path: 'frame.bhnode',
				kind: 'image',
				title: 'Frame',
				role: 'frame',
				recipe: {
					recipeId: 'studio.workflow.image.generate-frame',
					parameters: {},
					inputBindings: []
				}
			}],
			cards: [],
			references: []
		}));
		assert.strictEqual(template.nodes[0].recipe?.recipeId, 'studio.workflow.image.generate-frame');
	});

	test('accepts only canonical contribution identifiers', () => {
		for (const recipeId of nonCanonicalContributionIds) {
			assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
				version: 1,
				files: [],
				nodes: [{
					path: 'result.bhnode',
					kind: 'file',
					title: 'Result',
					role: 'result',
					recipe: { recipeId, parameters: {}, inputBindings: [] }
				}],
				cards: [],
				references: []
			})), /not a valid contribution identifier/);
		}
	});

	test('keeps editable text and code as ordinary project files instead of node documents', () => {
		for (const kind of ['text', 'code']) {
			assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
				version: 1,
				files: [],
				nodes: [{ path: `${kind}.bhnode`, kind, title: kind, role: 'content' }],
				cards: [],
				references: []
			})), /supported node content kind/);
		}
	});

	test('requires node bindings and cards to reference resources created by the template', () => {
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [],
			nodes: [{
				path: 'clip.bhnode',
				kind: 'video',
				title: 'Clip',
				role: 'shot',
				recipe: {
					recipeId: 'pointa.basehalf-ai-video.shot-preview',
					parameters: {},
					inputBindings: [{ sourcePath: 'missing.md', slot: 'prompt', order: 0 }]
				}
			}],
			cards: [],
			references: []
		})), /binds missing source/);

		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: 'Brief' }],
			nodes: [],
			cards: [{ path: 'missing.md', x: 0, y: 0, width: 300, height: 220 }],
			references: []
		})), /matching file or node/);
	});

	test('allows direct context to remain unassigned while requiring every binding to have a reference', () => {
		const incomingReference = { from: 'brief.md', to: 'clip.bhnode', fromAnchor: 'east', toAnchor: 'west' };
		const executableWithUnassignedContext = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: 'Brief' }],
			nodes: [{
				path: 'clip.bhnode',
				kind: 'video',
				title: 'Clip',
				role: 'shot',
				recipe: {
					recipeId: 'studio.workflow.video.generate-clip',
					parameters: {},
					inputBindings: []
				}
			}],
			cards: [],
			references: [incomingReference]
		}));
		assert.deepStrictEqual(executableWithUnassignedContext.references, [incomingReference]);
		assert.deepStrictEqual(executableWithUnassignedContext.nodes[0].recipe?.inputBindings, []);

		const contentOnly = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: 'Brief' }],
			nodes: [{
				path: 'clip.bhnode',
				kind: 'video',
				title: 'Clip',
				role: 'shot'
			}],
			cards: [],
			references: [incomingReference]
		}));
		assert.deepStrictEqual(contentOnly.references, [incomingReference]);
	});

	test('counts parameter object keys and scalar values with the public SDK complexity budget', () => {
		const source = (count: number) => JSON.stringify({
			version: 1,
			files: [],
			nodes: [{
				path: 'result.bhnode',
				kind: 'file',
				title: 'Result',
				role: 'result',
				recipe: {
					recipeId: 'studio.writer.create-document',
					parameters: Object.fromEntries(Array.from({ length: count }, (_, index) => [`parameter-${index}`, index])),
					inputBindings: []
				}
			}],
			cards: [],
			references: []
		});

		assert.doesNotThrow(() => parseBaseHalfCanvasTemplate(source(64)));
		assert.throws(() => parseBaseHalfCanvasTemplate(source(65)), /parameter complexity limit/);
	});
});
