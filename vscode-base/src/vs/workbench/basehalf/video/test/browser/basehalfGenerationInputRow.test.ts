/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfGenerationInputRow, IBaseHalfInputRowDelegate, IBaseHalfInputRowModel, IBaseHalfInputTile } from '../../browser/basehalfGenerationInputRow.js';

function tile(path: string, extra: Partial<IBaseHalfInputTile> = {}): IBaseHalfInputTile {
	return { path, kind: 'image', fileName: path.slice(path.lastIndexOf('/') + 1), dimmed: false, ...extra };
}

const START = tile('shots/start.png', { number: 1, label: '图片1', frame: 'start', file: URI.file('/work/shots/start.png') });
const END = tile('shots/end.png', { number: 2, label: '图片2', frame: 'end' });
const CLIP = tile('shots/clip.mp4', { kind: 'video', number: 1, label: '视频1', dimmed: true, note: 'Not used: Acme Motion 2 takes no videos in Frames.' });
const NOTE = tile('notes/scene.md', { kind: 'text', fileName: 'scene' });

/** What the row draws, in order. */
function drawn(row: BaseHalfGenerationInputRow): string[] {
	const parts: string[] = [];
	const visit = (parent: Element) => {
		for (const child of parent.children) {
			const element = child as HTMLElement;
			if (element.classList.contains('bh-input-tile')) {
				const bits = [element.classList.contains('empty') ? `empty ${element.dataset.frame}` : `tile ${element.dataset.path}`];
				for (const part of element.children) {
					const name = (part as HTMLElement).className.replace(/^bh-input-tile-/, '');
					if (name === 'number' || name === 'mark' || name === 'caption') {
						bits.push(`${name} ${part.textContent}`);
					} else if (name === 'remove' || name === 'name') {
						bits.push(name);
					}
				}
				if (element.classList.contains('dimmed')) {
					bits.push('dimmed');
				}
				parts.push(bits.join(' · '));
			} else if (element.classList.contains('bh-input-row-swap')) {
				parts.push((element as HTMLButtonElement).disabled ? 'swap disabled' : 'swap');
			} else if (element.classList.contains('bh-input-row-arrow')) {
				parts.push('arrow');
			} else if (element.classList.contains('bh-input-row-add')) {
				parts.push('add');
			} else if (element.classList.contains('bh-input-row-hint')) {
				parts.push(`hint ${element.textContent}`);
			} else {
				visit(element);
			}
		}
	};
	visit(row.element);
	return parts;
}

suite('BaseHalfGenerationInputRow (D68)', () => {
	const disposables = new DisposableStore();
	let calls: string[];
	let canvas = { left: 0, top: 0, width: 1200, height: 900 };
	let container: HTMLElement;
	let layer: HTMLElement;

	const delegate: IBaseHalfInputRowDelegate = {
		remove: path => calls.push(`remove ${path}`),
		insertName: label => calls.push(`name ${label}`),
		move: (path, before) => calls.push(`move ${path} before ${before ?? 'end'}`),
		swap: () => calls.push('swap'),
		openAddMenu: () => calls.push('add menu'),
		canvasBounds: () => canvas
	};

	function create(model: IBaseHalfInputRowModel): BaseHalfGenerationInputRow {
		const row = disposables.add(new BaseHalfGenerationInputRow(delegate, layer));
		container.append(row.element);
		row.update(model);
		return row;
	}

	/** Gives the row the layout its stylesheet gives it, whether or not the sheet has loaded. */
	function layOut(row: BaseHalfGenerationInputRow): void {
		const list = row.element.firstElementChild as HTMLElement;
		Object.assign(list.style, { position: 'relative', display: 'flex', gap: '6px', alignItems: 'center' });
		for (const child of list.children) {
			Object.assign((child as HTMLElement).style, { position: 'relative', width: '48px', height: '48px', flex: 'none', boxSizing: 'border-box' });
		}
	}

	function pointer(target: Element, type: string, x: number, y = 20): void {
		target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, button: 0, bubbles: true, cancelable: true }));
	}

	setup(() => {
		calls = [];
		canvas = { left: 0, top: 0, width: 1200, height: 900 };
		container = mainWindow.document.createElement('div');
		Object.assign(container.style, { position: 'absolute', left: '100px', top: '400px', width: '512px' });
		layer = mainWindow.document.createElement('div');
		Object.assign(layer.style, { position: 'absolute', inset: '0' });
		container.append(layer);
		mainWindow.document.body.append(container);
	});
	teardown(() => {
		disposables.clear();
		container.remove();
	});
	ensureNoDisposablesAreLeakedInTestSuite();

	test('draws the frames first, joined by the swap arrow, then the other inputs in order with their numbers, and the plus', () => {
		const row = create({ frames: [{ role: 'start', tile: START, addLabel: 'Add a Start Frame' }, { role: 'end', tile: END, addLabel: 'Add an End Frame' }], canSwap: true, tiles: [CLIP, NOTE], editable: true });
		assert.deepStrictEqual(drawn(row), [
			'tile shots/start.png · number 1 · mark Start · remove · name',
			'swap',
			'tile shots/end.png · number 2 · mark End · remove · name',
			'tile shots/clip.mp4 · number 1 · remove · name · dimmed',
			'tile notes/scene.md · caption scene · remove',
			'add'
		]);
	});

	test('an empty frame offers the plus\'s menu, and a row without inputs says what to add', () => {
		const row = create({ frames: [{ role: 'start', addLabel: 'Add a Start Frame' }, { role: 'end', addLabel: 'Add an End Frame' }], canSwap: false, tiles: [], editable: true });
		(row.element.querySelector('.bh-input-tile.empty') as HTMLButtonElement).click();
		row.update({ tiles: [], editable: true, hint: 'Add images as references' });
		assert.deepStrictEqual({ drawn: drawn(row), calls }, { drawn: ['add', 'hint Add images as references'], calls: ['add menu'] });
	});

	test('read only, the row has no plus, cross, @, or swap, and its tiles still show their numbers', () => {
		const row = create({ frames: [{ role: 'start', tile: START, addLabel: '' }, { role: 'end', tile: END, addLabel: '' }], canSwap: true, tiles: [CLIP], editable: false });
		assert.deepStrictEqual(drawn(row), [
			'tile shots/start.png · number 1 · mark Start',
			'arrow',
			'tile shots/end.png · number 2 · mark End',
			'tile shots/clip.mp4 · number 1 · dimmed'
		]);
	});

	test('the cross removes the connection and the @ puts the name into the prompt', () => {
		const row = create({ tiles: [START, CLIP], editable: true });
		(row.element.querySelector('.bh-input-tile-remove') as HTMLButtonElement).click();
		(row.element.querySelectorAll('.bh-input-tile-name')[1] as HTMLButtonElement).click();
		assert.deepStrictEqual(calls, ['remove shots/start.png', 'name 视频1']);
	});

	test('on a focused tile, Delete removes it, Enter names it, and Alt+arrows move it one place', () => {
		const a = tile('shots/a.png', { number: 1, label: '图片1' });
		const b = tile('shots/b.png', { number: 2, label: '图片2' });
		const row = create({ tiles: [a, b, CLIP], editable: true });
		const tiles = [...row.element.querySelectorAll('.bh-input-tile')] as HTMLElement[];
		const key = (target: HTMLElement, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
		key(tiles[1], { key: 'Enter' });
		key(tiles[1], { key: 'ArrowRight', altKey: true });
		key(tiles[1], { key: 'ArrowLeft', altKey: true });
		key(tiles[2], { key: 'ArrowRight', altKey: true });
		key(tiles[2], { key: 'Delete' });
		assert.deepStrictEqual(calls, [
			'name 图片2',
			'move shots/b.png before end',
			'move shots/b.png before shots/a.png',
			'remove shots/clip.mp4'
		]);
	});

	test('pointing at a tile shows its larger look above it, with its names and why it is dimmed; leaving hides it', () => {
		const row = create({ tiles: [START, CLIP], editable: true });
		layOut(row);
		const clip = row.element.querySelectorAll('.bh-input-tile')[1] as HTMLElement;
		pointer(clip, 'pointerenter', 0);
		const look = layer.querySelector('.bh-input-look') as HTMLElement;
		const shown = { text: [...look.children].map(child => child.textContent), side: look.dataset.side };
		pointer(clip, 'pointerleave', 0);
		assert.deepStrictEqual({ shown, after: layer.querySelector('.bh-input-look') }, {
			shown: { text: ['视频1clip.mp4', 'Not used: Acme Motion 2 takes no videos in Frames.'], side: 'above' },
			after: null
		});
	});

	test('the look opens below the row when there is no room above it inside the canvas', () => {
		canvas = { left: 0, top: 380, width: 1200, height: 900 };
		const row = create({ tiles: [START], editable: true });
		layOut(row);
		pointer(row.element.querySelector('.bh-input-tile')!, 'pointerenter', 0);
		assert.strictEqual((layer.querySelector('.bh-input-look') as HTMLElement).dataset.side, 'below');
	});

	test('a drag moves a tile among the other inputs; a press that hardly moves is a click; a dragged frame swaps the frames', () => {
		const row = create({ frames: [{ role: 'start', tile: START, addLabel: '' }, { role: 'end', tile: END, addLabel: '' }], canSwap: true, tiles: [CLIP, NOTE, tile('shots/c.png', { number: 3, label: '图片3' })], editable: true });
		layOut(row);
		const tiles = [...row.element.querySelectorAll('.bh-input-tile')] as HTMLElement[];
		const left = (element: HTMLElement) => element.getBoundingClientRect().left;
		// The last tile dragged before the first of the other inputs.
		const last = tiles[4];
		pointer(last, 'pointerdown', left(last) + 24);
		pointer(last, 'pointermove', left(tiles[2]) + 4);
		pointer(last, 'pointerup', left(tiles[2]) + 4);
		// A press that moves 2 px.
		pointer(tiles[3], 'pointerdown', left(tiles[3]) + 24);
		pointer(tiles[3], 'pointermove', left(tiles[3]) + 26);
		pointer(tiles[3], 'pointerup', left(tiles[3]) + 26);
		// The end frame dragged past the start frame.
		pointer(tiles[1], 'pointerdown', left(tiles[1]) + 24);
		pointer(tiles[1], 'pointermove', left(tiles[0]) + 4);
		pointer(tiles[1], 'pointerup', left(tiles[0]) + 4);
		assert.deepStrictEqual(calls, ['move shots/c.png before shots/clip.mp4', 'swap']);
	});
});
