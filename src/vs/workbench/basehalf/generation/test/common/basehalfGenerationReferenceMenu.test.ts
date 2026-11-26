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
		{ path: 'shots/caocao.png', kind: 'image', title: '曹操.png', connected: true },
		{ path: 'shots/dufu.png', kind: 'image', title: '杜甫.png', connected: true }
	],
	canvas: [
		{
			kind: 'image', items: [
				{ path: 'shots/caocao.png', kind: 'image', title: '曹操.png', connected: true },
				{ path: 'shots/dufu.png', kind: 'image', title: '杜甫.png', connected: true },
				{ path: 'shots/liubang.png', kind: 'image', title: '刘邦.png' }
			]
		},
		{ kind: 'video', items: [{ path: 'shots/caocao.mp4', kind: 'video', title: '曹操.mp4' }], disabled: 'Acme Image 1 takes no videos.' },
		{ kind: 'audio', items: [] }
	]
};

/** The rows in short: headers, items with their marks, kinds with their counts, and dimmed ones with why. */
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

suite('BaseHalf generation reference menu (D68, D74)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('lists the connected inputs, then the kinds of the canvas with how many cards each has', () => {
		assert.deepStrictEqual(brief(baseHalfReferenceMenuRows(MODEL, '')), [
			'# Connected',
			'曹操.png',
			'杜甫.png',
			'# On This Canvas',
			'Images › 3',
			'Videos › 1 [Acme Image 1 takes no videos.]',
			'Audio › 0'
		]);
	});

	test('the list of a kind holds every card of it, the connected ones marked so, and a refused kind dims the others', () => {
		assert.deepStrictEqual({
			images: brief(baseHalfReferenceMenuKindRows(MODEL, 'image')),
			videos: brief(baseHalfReferenceMenuKindRows(MODEL, 'video')),
			audio: brief(baseHalfReferenceMenuKindRows(MODEL, 'audio'))
		}, {
			images: ['曹操.png = Connected', '杜甫.png = Connected', '刘邦.png'],
			videos: ['曹操.mp4 [Acme Image 1 takes no videos.]'],
			audio: ['(No audio on this canvas.)']
		});
	});

	test('a search shows what matches by name, a connected card once', () => {
		assert.deepStrictEqual({
			name: brief(baseHalfReferenceMenuRows(MODEL, '曹')),
			extension: brief(baseHalfReferenceMenuRows(MODEL, '杜甫.p')),
			none: brief(baseHalfReferenceMenuRows(MODEL, 'zebra'))
		}, {
			name: ['# Connected', '曹操.png', '# Videos', '曹操.mp4 [Acme Image 1 takes no videos.]'],
			extension: ['# Connected', '杜甫.png'],
			none: ['(Nothing here has that name.)']
		});
	});

	test('with nothing connected and nothing on the canvas, it says what to connect', () => {
		assert.deepStrictEqual(brief(baseHalfReferenceMenuRows({ connected: [], canvas: [{ kind: 'image', items: [] }, { kind: 'video', items: [] }, { kind: 'audio', items: [] }, { kind: 'text', items: [] }] }, '')), [
			'(Connect an image, a video, audio, or a note, or add one to this canvas.)'
		]);
	});

	test('notes are listed with the inputs: a connected one under Connected, and in Notes a connected one says so; a refused kind never dims a connected note (D71)', () => {
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
			menu: ['# Connected', '曹操.png', 'scene', '杜甫.png', '# On This Canvas', 'Images › 3', 'Videos › 1 [Acme Image 1 takes no videos.]', 'Audio › 0', 'Notes › 2 [Not here.]'],
			notes: ['scene = Connected', 'plan [Not here.]'],
			search: ['# Notes', 'plan [Not here.]'],
			none: ['(No notes on this canvas.)']
		});
	});
});
