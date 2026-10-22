/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { materializeBaseHalfCanvasTemplateUpstream, parseBaseHalfCanvasTemplate } from '../../common/basehalfCanvasTemplate.js';

suite('BaseHalfCanvasTemplate', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('declares drafts by path and prompt; the extension gives their kind, and nothing runs', () => {
		const template = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }, { path: 'frames/plan.md', contents: '# Frames\n' }],
			drafts: [
				{ path: 'shot.mp4', prompt: 'A quiet station at night.' },
				{ path: 'frames/frame.PNG' }
			],
			cards: [
				{ path: 'brief.md', x: 0, y: 0, width: 300, height: 220 },
				{ path: 'shot.mp4', x: 380, y: 0, width: 720, height: 405 }
			],
			references: [{ from: 'brief.md', to: 'shot.mp4', fromAnchor: 'east', toAnchor: 'west' }]
		}));

		assert.deepStrictEqual(template.drafts, [
			{ path: 'shot.mp4', kind: 'video', prompt: 'A quiet station at night.' },
			{ path: 'frames/frame.PNG', kind: 'image', prompt: '' }
		]);
		assert.deepStrictEqual(template.references[0], {
			from: 'brief.md',
			to: 'shot.mp4',
			fromAnchor: 'east',
			toAnchor: 'west'
		});
	});

	test('refuses the nodes list of earlier builds, a draft without an image or video extension, and every draft field but path and prompt (D63)', () => {
		const source = (fields: Record<string, unknown>) => JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }],
			drafts: [],
			cards: [],
			references: [],
			...fields
		});
		const refusals = [
			source({ nodes: [{ path: 'shot.bhnode', kind: 'video', title: 'Shot 1' }] }),
			source({ drafts: [{ path: 'notes.md' }] }),
			source({ drafts: [{ path: 'shot.mp4', kind: 'video' }] }),
			source({ drafts: [{ path: 'shot.mp4', title: 'Shot 1' }] }),
			source({ drafts: [{ path: 'shot.mp4', generation: { provider: 'acme' } }] }),
			source({ drafts: [{ path: 'shot.mp4', task: {} }] })
		].map(text => {
			try {
				parseBaseHalfCanvasTemplate(text);
				return 'accepted';
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		});
		assert.deepStrictEqual(refusals.map(message => /unsupported property 'nodes'|image or a video file|unsupported property '(kind|title|generation|task)'/.test(message)), refusals.map(() => true), refusals.join('\n'));
	});

	test('bounds a draft\'s prompt', () => {
		const source = (prompt: string) => JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }],
			drafts: [{ path: 'clip.mp4', prompt }],
			cards: [],
			references: []
		});
		assert.strictEqual(parseBaseHalfCanvasTemplate(source('')).drafts[0].prompt, '');
		assert.doesNotThrow(() => parseBaseHalfCanvasTemplate(source('x'.repeat(64 * 1024))));
		assert.throws(() => parseBaseHalfCanvasTemplate(source('x'.repeat(64 * 1024 + 1))), /prompt.*no longer than/);
	});

	test('keeps a draft only in a folder that holds a file of the template, which git keeps', () => {
		const source = (drafts: readonly { path: string }[]) => JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: '# Brief\n' }, { path: 'shots/one/plan.md', contents: '# Plan\n' }],
			drafts,
			cards: [],
			references: []
		});
		assert.doesNotThrow(() => parseBaseHalfCanvasTemplate(source([{ path: 'shot.mp4' }, { path: 'shots/one/clip.mp4' }])));
		assert.throws(() => parseBaseHalfCanvasTemplate(source([{ path: 'shots/two/clip.mp4' }])), /holds no file of the template/);
		// A folder with a folder in it but no file of its own is not kept either.
		assert.throws(() => parseBaseHalfCanvasTemplate(source([{ path: 'shots/clip.mp4' }])), /holds no file of the template/);
	});

	test('rejects traversal, reserved metadata paths, missing endpoints, and duplicate references', () => {
		const base = {
			version: 1,
			files: [{ path: 'brief.md', contents: 'Brief' }],
			drafts: [],
			cards: [],
			references: []
		};
		for (const path of [
			'../brief.md', '.bh/mirror/brief.md', '.BH/mirror/brief.md', '/brief.md', 'folder\\brief.md',
			'folder/CON.txt', 'folder/trailing.', 'folder/control\u0001.md', 'folder/café.md'
		]) {
			assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
				...base,
				files: [{ path, contents: 'Brief' }]
			})), /path|reserved|unsafe/i);
		}
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			drafts: [{ path: '.bh/mirror/clip.mp4' }]
		})), /path|reserved|unsafe|metadata/i);
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
			files: [{ path: 'Brief.md', contents: 'One' }, { path: 'brief.md', contents: 'Two' }]
		})), /must not contain duplicates/);
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			drafts: [{ path: 'Brief.md.mp4' }, { path: 'brief.md.MP4' }]
		})), /must not contain duplicates/);
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			...base,
			files: [{ path: 'brief.md', contents: 'One' }, { path: 'brief.md/child.md', contents: 'Two' }]
		})), /cannot create a file inside another created file/);
	});

	test('requires cards to reference files or drafts created by the template', () => {
		assert.throws(() => parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [{ path: 'brief.md', contents: 'Brief' }],
			drafts: [],
			cards: [{ path: 'missing.md', x: 0, y: 0, width: 300, height: 220 }],
			references: []
		})), /matching file or draft/);
	});

	test('rejects template frontmatter upstream keys and targets that cannot be downstream; outputs/ is an ordinary folder', () => {
		const source = (brief: string, references: readonly { from: string; to: string }[] = []) => JSON.stringify({
			version: 1,
			files: [
				{ path: 'brief.md', contents: brief },
				{ path: 'outputs/run.md', contents: '# Run\n' },
				{ path: 'notes.txt', contents: '---\nupstream: x\n---\n' }
			],
			drafts: [],
			cards: [],
			references: references.map(reference => ({ ...reference, fromAnchor: 'east', toAnchor: 'west' }))
		});
		for (const brief of [
			'---\nupstream:\n  - other.md\n---\n# Brief\n',
			'---\nupstream:\n---\n',
			'﻿---\r\ntitle: Brief\r\nupstream: []\r\n---\r\n',
			'---\nupstream: a\nupstream: b\n---\n',
			'+++\nupstream: x\n+++\n'
		]) {
			assert.throws(() => parseBaseHalfCanvasTemplate(source(brief)), /cannot declare an 'upstream' key/, brief);
		}
		assert.doesNotThrow(() => parseBaseHalfCanvasTemplate(source('---\ntitle: Brief\n---\n# Brief\n')));
		// The reserved outputs tree is gone (D63).
		assert.doesNotThrow(() => parseBaseHalfCanvasTemplate(source('# Brief\n', [{ from: 'brief.md', to: 'outputs/run.md' }])));
		assert.throws(
			() => parseBaseHalfCanvasTemplate(source('+++\ntitle = "Brief"\n+++\n', [{ from: 'notes.txt', to: 'brief.md' }])),
			/cannot receive its upstream list/
		);
	});

	test('materializes references into each target\'s own store, rebased under the project folder: a draft\'s for the card store', () => {
		const template = parseBaseHalfCanvasTemplate(JSON.stringify({
			version: 1,
			files: [
				{ path: 'brief.md', contents: '# Brief\n' },
				{ path: 'shots/script.md', contents: '---\r\ntitle: Script # keep\r\n---\r\nBody\r\n' },
				{ path: 'shots/shot.json', contents: '{}\n' }
			],
			drafts: [
				{ path: 'shots/frame.png' },
				{ path: 'shots/clip.mp4', prompt: 'Image 1 comes alive.' }
			],
			cards: [],
			references: [
				{ from: 'brief.md', to: 'shots/script.md', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'shots/script.md', to: 'shots/frame.png', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'brief.md', to: 'shots/frame.png', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'shots/frame.png', to: 'shots/clip.mp4', fromAnchor: 'east', toAnchor: 'west' },
				{ from: 'brief.md', to: 'shots/shot.json', fromAnchor: 'east', toAnchor: 'west' }
			]
		}));
		const upstream = materializeBaseHalfCanvasTemplateUpstream(template, 'Projects/My Film');
		assert.deepStrictEqual({
			files: Object.fromEntries(upstream.files),
			drafts: Object.fromEntries(upstream.drafts),
			sidecars: upstream.sidecars
		}, {
			files: {
				'brief.md': '# Brief\n',
				'shots/script.md': '---\r\ntitle: Script # keep\r\nupstream:\r\n  - Projects/My Film/brief.md\r\n---\r\nBody\r\n',
				'shots/shot.json': '{}\n'
			},
			drafts: {
				'shots/frame.png': ['Projects/My Film/shots/script.md', 'Projects/My Film/brief.md'],
				'shots/clip.mp4': ['Projects/My Film/shots/frame.png']
			},
			sidecars: [{ path: 'Projects/My Film/shots/shot.json', entries: ['Projects/My Film/brief.md'] }]
		});
		assert.strictEqual(
			materializeBaseHalfCanvasTemplateUpstream(template, '').files.get('shots/script.md'),
			'---\r\ntitle: Script # keep\r\nupstream:\r\n  - brief.md\r\n---\r\nBody\r\n'
		);
	});
});
