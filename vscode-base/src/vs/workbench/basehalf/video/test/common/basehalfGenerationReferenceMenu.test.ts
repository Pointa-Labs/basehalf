/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfReferenceMenuKindRows,
	baseHalfReferenceMenuRows,
	BaseHalfReferenceMenuRow,
	IBaseHalfReferenceMenuModel
} from '../../common/basehalfGenerationReferenceMenu.js';

const MODEL: IBaseHalfReferenceMenuModel = {
	connected: [
		{ path: 'shots/caocao.png', kind: 'image', title: '曹操.png', label: '图片1' },
		{ path: 'shots/dufu.png', kind: 'image', title: '杜甫.png', label: '图片2' }
	],
	canvas: [
		{
			kind: 'image', items: [
				{ path: 'shots/caocao.png', kind: 'image', title: '曹操.png', label: '图片1' },
				{ path: 'shots/dufu.png', kind: 'image', title: '杜甫.png', label: '图片2' },
				{ path: 'shots/liubang.png', kind: 'image', title: '刘邦.png' }
			]
		},
		{ kind: 'video', items: [{ path: 'shots/caocao.mp4', kind: 'video', title: '曹操.mp4' }], disabled: 'Acme Image 1 takes no videos.' },
		{ kind: 'audio', items: [] }
	]
};

/** The rows in short: headers, items with their names, kinds with their counts, and dimmed ones with why. */
function brief(rows: readonly BaseHalfReferenceMenuRow[]): string[] {
	return rows.map(row => {
		switch (row.type) {
			case 'header': return `# ${row.text}`;
			case 'empty': return `(${row.text})`;
			case 'kind': return `${row.text} › ${row.count}${row.disabled ? ` [${row.disabled}]` : ''}`;
			case 'item': return `${row.item.title}${row.mark ? ` = ${row.mark}` : ''}${row.item.disabled ? ` [${row.item.disabled}]` : ''}`;
		}
	});
}

suite('BaseHalf generation reference menu (D68)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('lists the connected inputs, then the kinds of the canvas with how many cards each has', () => {
		assert.deepStrictEqual(brief(baseHalfReferenceMenuRows(MODEL, '')), [
			'# Connected',
			'曹操.png = 图片1',
			'杜甫.png = 图片2',
			'# On This Canvas',
			'Images › 3',
			'Videos › 1 [Acme Image 1 takes no videos.]',
			'Audio › 0'
		]);
	});

	test('the list of a kind holds every card of it, the connected ones with their names, and a refused kind dims the others', () => {
		assert.deepStrictEqual({
			images: brief(baseHalfReferenceMenuKindRows(MODEL, 'image')),
			videos: brief(baseHalfReferenceMenuKindRows(MODEL, 'video')),
			audio: brief(baseHalfReferenceMenuKindRows(MODEL, 'audio'))
		}, {
			images: ['曹操.png = 图片1', '杜甫.png = 图片2', '刘邦.png'],
			videos: ['曹操.mp4 [Acme Image 1 takes no videos.]'],
			audio: ['(No audio on this canvas.)']
		});
	});

	test('a search shows what matches, by name or by the name in the prompt, a connected card once', () => {
		assert.deepStrictEqual({
			name: brief(baseHalfReferenceMenuRows(MODEL, '曹')),
			label: brief(baseHalfReferenceMenuRows(MODEL, '图片 2')),
			none: brief(baseHalfReferenceMenuRows(MODEL, 'zebra'))
		}, {
			name: ['# Connected', '曹操.png = 图片1', '# Videos', '曹操.mp4 [Acme Image 1 takes no videos.]'],
			label: ['# Connected', '杜甫.png = 图片2'],
			none: ['(Nothing here has that name.)']
		});
	});

	test('with nothing connected and nothing on the canvas, it says what to connect', () => {
		assert.deepStrictEqual(brief(baseHalfReferenceMenuRows({ connected: [], canvas: [{ kind: 'image', items: [] }, { kind: 'video', items: [] }, { kind: 'audio', items: [] }, { kind: 'text', items: [] }] }, '')), [
			'(Connect an image, a video, audio, or a note, or add one to this canvas.)'
		]);
	});

	test('notes are listed with the inputs, without a name: a connected one under Connected, and in Notes a connected one says so; a refused kind never dims a connected note (D71)', () => {
		const withNotes: IBaseHalfReferenceMenuModel = {
			connected: [
				MODEL.connected[0],
				{ path: 'notes/scene.md', kind: 'text', title: 'scene', connected: true },
				MODEL.connected[1]
			],
			canvas: [
				...MODEL.canvas,
				{
					kind: 'text', items: [
						{ path: 'notes/scene.md', kind: 'text', title: 'scene', connected: true },
						{ path: 'notes/plan.md', kind: 'text', title: 'plan' }
					], disabled: 'Not here.'
				}
			]
		};
		assert.deepStrictEqual({
			menu: brief(baseHalfReferenceMenuRows(withNotes, '')),
			notes: brief(baseHalfReferenceMenuKindRows(withNotes, 'text')),
			search: brief(baseHalfReferenceMenuRows(withNotes, 'pla')),
			none: brief(baseHalfReferenceMenuKindRows({ connected: [], canvas: [{ kind: 'text', items: [] }] }, 'text'))
		}, {
			menu: ['# Connected', '曹操.png = 图片1', 'scene', '杜甫.png = 图片2', '# On This Canvas', 'Images › 3', 'Videos › 1 [Acme Image 1 takes no videos.]', 'Audio › 0', 'Notes › 2 [Not here.]'],
			notes: ['scene = Connected', 'plan [Not here.]'],
			search: ['# Notes', 'plan [Not here.]'],
			none: ['(No notes on this canvas.)']
		});
	});
});
