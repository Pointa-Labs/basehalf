/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { materializeBaseHalfCanvasTemplateUpstream, parseBaseHalfCanvasTemplate } from '../../common/basehalfCanvasTemplate.js';

suite('BaseHalfCanvasTemplate', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('creates empty nodes with a title and, for a Video node, a prompt, and nothing that runs', () => {
		const template = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }],
			nodes: [
				{ path: 'shot.bhnode', kind: 'video', title: 'Shot 1', prompt: 'A quiet station at night.' },
				{ path: 'frame.bhnode', kind: 'image', title: 'Frame' }
			],
			cards: [
				{ path: 'brief.md', x: 0, y: 0, width: 300, height: 220 },
				{ path: 'shot.bhnode', x: 380, y: 0, width: 300, height: 220 }
			],
			references: [{ from: 'brief.md', to: 'shot.bhnode', fromAnchor: 'east', toAnchor: 'west' }]
		}));

		assert.deepStrictEqual(template.nodes, [
			{ path: 'shot.bhnode', kind: 'video', title: 'Shot 1', prompt: 'A quiet station at night.' },
			{ path: 'frame.bhnode', kind: 'image', title: 'Frame' }
		]);
		assert.deepStrictEqual(template.references[0], {
			from: 'brief.md',
			to: 'shot.bhnode',
			fromAnchor: 'east',
			toAnchor: 'west'
		});
	});

	test('refuses the node fields of version 4: role, recipe, and runs', () => {
		for (const [field, value] of [['role', 'shot'], ['recipe', { recipeId: 'pointa.basehalf-ai-video.generate-video', parameters: {}, inputBindings: [] }], ['runs', []]] as const) {
			assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
				version: 1,
				files: [],
				nodes: [{ path: 'shot.bhnode', kind: 'video', title: 'Shot 1', [field]: value }],
				cards: [],
				references: []
			})), new RegExp(`unsupported property '${field}'`));
		}
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [],
			nodes: [{ path: 'frame.bhnode', kind: 'image', title: 'Frame', prompt: 'A frame.' }],
			cards: [],
			references: []
		})), /prompt is allowed only for a Video node/);
	});

	test('bounds an optional host-owned node prompt', () => {
		const source = (prompt: string) => JSON.stringify({
			version: 1,
			files: [],
			nodes: [{ path: 'clip.bhnode', kind: 'video', title: 'Clip', prompt }],
			cards: [],
			references: []
		});
		assert.strictEqual(parseBaseHalfCanvasTemplate(source('')).nodes[0].prompt, '');
		assert.doesNotThrow(() => parseBaseHalfCanvasTemplate(source('x'.repeat(64 * 1024))));
		assert.throws(() => parseBaseHalfCanvasTemplate(source('x'.repeat(64 * 1024 + 1))), /prompt.*no longer than/);
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

	test('keeps editable text and code as ordinary project files instead of node documents', () => {
		for (const kind of ['text', 'code']) {
			assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
				version: 1,
				files: [],
				nodes: [{ path: `${kind}.bhnode`, kind, title: kind }],
				cards: [],
				references: []
			})), /supported node content kind/);
		}
	});

	test('requires cards to reference resources created by the template', () => {
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: 'Brief' }],
			nodes: [],
			cards: [{ path: 'missing.md', x: 0, y: 0, width: 300, height: 220 }],
			references: []
		})), /matching file or node/);
	});

	test('rejects template frontmatter upstream keys and targets that cannot be downstream', () => {
		const source = (brief: string, references: readonly { from: string; to: string }[] = []) => JSON.stringify({
			version: 1,
			files: [
				{ path: 'brief.md', contents: brief },
				{ path: 'outputs/run.md', contents: '# Run\n' },
				{ path: 'notes.txt', contents: '---\nupstream: x\n---\n' }
			],
			nodes: [],
			cards: [],
			references: references.map(reference => ({ ...reference, fromAnchor: 'east', toAnchor: 'west' }))
		});
		for (const brief of [
			'---\nupstream:\n  - other.md\n---\n# Brief\n',
			'---\nupstream:\n---\n',
			'\ufeff---\r\ntitle: Brief\r\nupstream: []\r\n---\r\n',
			'---\nupstream: a\nupstream: b\n---\n',
			'+++\nupstream: x\n+++\n'
		]) {
			assert.throws(() => parseBaseHalfCanvasTemplate(source(brief)), /cannot declare an 'upstream' key/, brief);
		}
		assert.doesNotThrow(() => parseBaseHalfCanvasTemplate(source('---\ntitle: Brief\n---\n# Brief\n')));
		assert.throws(
			() => parseBaseHalfCanvasTemplate(source('# Brief\n', [{ from: 'brief.md', to: 'outputs/run.md' }])),
			/reserved outputs tree/
		);
		assert.throws(
			() => parseBaseHalfCanvasTemplate(source('+++\ntitle = "Brief"\n+++\n', [{ from: 'notes.txt', to: 'brief.md' }])),
			/cannot receive its upstream list/
		);
	});

	test('materializes references into each target\'s own store, rebased under the project folder', () => {
		const template = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [
				{ path: 'brief.md', contents: '# Brief\n' },
				{ path: 'shots/script.md', contents: '---\r\ntitle: Script # keep\r\n---\r\nBody\r\n' },
				{ path: 'shots/shot.json', contents: '{}\n' }
			],
			nodes: [
				{ path: 'shots/frame.bhnode', kind: 'image', title: 'Frame' },
				{ path: 'shots/audio.bhnode', kind: 'audio', title: 'Audio' }
			],
			cards: [],
			references: [
				{ from: 'brief.md', to: 'shots/script.md', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'shots/script.md', to: 'shots/frame.bhnode', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'brief.md', to: 'shots/frame.bhnode', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'shots/frame.bhnode', to: 'shots/audio.bhnode', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'brief.md', to: 'shots/shot.json', fromAnchor: 'east', toAnchor: 'west' }
			]
		}));
		const upstream = materializeBaseHalfCanvasTemplateUpstream(template, 'Projects/My Film');
		assert.deepStrictEqual({
			files: Object.fromEntries(upstream.files),
			nodes: Object.fromEntries(upstream.nodes),
			sidecars: upstream.sidecars
		}, {
			files: {
				'brief.md': '# Brief\n',
				'shots/script.md': '---\r\ntitle: Script # keep\r\nupstream:\r\n  - Projects/My Film/brief.md\r\n---\r\nBody\r\n',
				'shots/shot.json': '{}\n'
			},
			nodes: {
				'shots/frame.bhnode': ['Projects/My Film/shots/script.md', 'Projects/My Film/brief.md'],
				'shots/audio.bhnode': ['Projects/My Film/shots/frame.bhnode']
			},
			sidecars: [{ path: 'Projects/My Film/shots/shot.json', entries: ['Projects/My Film/brief.md'] }]
		});
		assert.strictEqual(
			materializeBaseHalfCanvasTemplateUpstream(template, '').files.get('shots/script.md'),
			'---\r\ntitle: Script # keep\r\nupstream:\r\n  - brief.md\r\n---\r\nBody\r\n'
		);
	});
});
