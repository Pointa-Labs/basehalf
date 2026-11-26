/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfGenerationAddButtons } from '../../browser/basehalfGenerationAddButtons.js';
import { BaseHalfGenerationInputRow, IBaseHalfInputRowDelegate, IBaseHalfInputRowModel, IBaseHalfInputTile } from '../../browser/basehalfGenerationInputRow.js';

function tile(path: string, extra: Partial<IBaseHalfInputTile> = {}): IBaseHalfInputTile {
	return { path, kind: 'image', fileName: path.slice(path.lastIndexOf('/') + 1), dimmed: false, ...extra };
}

const START = tile('shots/start.png', { frame: 'start', file: URI.file('/work/shots/start.png') });
const END = tile('shots/end.png', { frame: 'end' });
const CLIP = tile('shots/clip.mp4', { kind: 'video', dimmed: true, note: 'Not used: Acme Motion 2 takes no videos in Frames.' });
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
			} else if (element.classList.contains('bh-add-input')) {
				parts.push(`${element.dataset.key}${element.getAttribute('aria-pressed') === 'true' ? ' (highlighted)' : ''}`);
			} else if (element.classList.contains('bh-add-inputs-status')) {
				if (element.textContent) {
					parts.push(`status ${element.textContent}`);
				}
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
	const hovers = new WeakMap<HTMLElement, string>();

	const delegate: IBaseHalfInputRowDelegate = {
		remove: path => calls.push(`remove ${path}`),
		insertMention: path => calls.push(`mention ${path}`),
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

	test('draws the frames first, joined by the swap arrow, then the other inputs in order, none with a number, and no button that adds an input: those are the footer\'s (D71, D106)', () => {
		const row = create({ frames: [{ role: 'start', tile: START, addLabel: 'Add a Start Frame' }, { role: 'end', tile: END, addLabel: 'Add an End Frame' }], canSwap: true, tiles: [CLIP, NOTE], editable: true });
		assert.deepStrictEqual(drawn(row), [
			'tile shots/start.png · mark Start · remove · name',
			'swap',
			'tile shots/end.png · mark End · remove · name',
			'tile shots/clip.mp4 · remove · name · dimmed',
			'tile notes/scene.md · caption scene · remove · name'
		]);
	});

	test('an empty frame offers the plus\'s menu, and a row without inputs says what to add', () => {
		const row = create({ frames: [{ role: 'start', addLabel: 'Add a Start Frame' }, { role: 'end', addLabel: 'Add an End Frame' }], canSwap: false, tiles: [], editable: true });
		(row.element.querySelector('.bh-input-tile.empty') as HTMLButtonElement).click();
		row.update({ tiles: [], editable: true, hint: 'Add images as references' });
		assert.deepStrictEqual({ drawn: drawn(row), calls }, { drawn: ['hint Add images as references'], calls: ['add menu'] });
	});

	test('drawing the row again keeps the pictures of the inputs that stay, so nothing blinks; an input that leaves and comes back gets its picture back', () => {
		const image = tile('shots/a.png', { file: URI.file('/work/shots/a.png') });
		const clip = tile('shots/clip.mp4', { kind: 'video', file: URI.file('/work/shots/clip.mp4') });
		const other = tile('shots/b.png', { file: URI.file('/work/shots/b.png') });
		const row = create({ tiles: [image, clip, other], editable: true });
		const media = () => new Map([...row.element.querySelectorAll<HTMLElement>('.bh-input-tile')].map(element => [element.dataset.path, element.querySelector('img, video')]));
		const before = media();
		// The plus waits for a click, and b.png's connection is removed.
		row.update({ tiles: [image, clip], editable: true, picking: true });
		const after = media();
		// Connected again, as by a second click of Pick on Canvas or by undo.
		row.update({ tiles: [image, clip, other], editable: true });
		const back = media();
		assert.deepStrictEqual({
			image: after.get('shots/a.png') === before.get('shots/a.png'),
			clip: after.get('shots/clip.mp4') === before.get('shots/clip.mp4'),
			clipLoads: after.get('shots/clip.mp4')?.getAttribute('src')?.endsWith('#t=0.1'),
			left: after.has('shots/b.png'),
			back: back.get('shots/b.png') === before.get('shots/b.png')
		}, { image: true, clip: true, clipLoads: true, left: false, back: true });
	});

	test('a tile loads its file at its version, and a new version of the file, as after an edit, draws its picture anew', () => {
		const file = URI.file('/work/shots/a.png');
		const row = create({ tiles: [tile('shots/a.png', { file, fileVersion: '1-10' })], editable: true });
		const picture = () => row.element.querySelector<HTMLImageElement>('.bh-input-tile img');
		const first = picture();
		row.update({ tiles: [tile('shots/a.png', { file, fileVersion: '2-20' })], editable: true });
		const second = picture();
		const version = (image: HTMLImageElement | null) => new URL(image?.getAttribute('src') ?? 'about:blank').searchParams.get('basehalfCanvasVersion');
		assert.deepStrictEqual({ first: version(first), second: version(second), drawnAnew: first !== second }, { first: '1-10', second: '2-20', drawnAnew: true });
	});

	test('a video and a sound show their length once their file tells it, and keep it when the row is drawn again (D70)', () => {
		const clip = tile('shots/clip.mp4', { kind: 'video', file: URI.file('/work/shots/clip.mp4') });
		const sound = tile('sounds/rain.mp3', { kind: 'audio', file: URI.file('/work/sounds/rain.mp3') });
		const draft = tile('shots/next.mp4', { kind: 'video' });
		const row = create({ tiles: [clip, sound, draft], editable: true });
		const lengths = () => [...row.element.querySelectorAll<HTMLElement>('.bh-input-tile')].map(element => {
			const label = element.querySelector<HTMLElement>('.bh-input-tile-length');
			return `${element.dataset.path}: ${label ? label.hidden ? 'waits' : label.textContent : 'none'} (${element.getAttribute('aria-label')})`;
		});
		const tell = (media: HTMLMediaElement | null, seconds: number) => {
			Object.defineProperty(media, 'duration', { value: seconds, configurable: true });
			media?.dispatchEvent(new Event('loadedmetadata'));
		};
		const before = lengths();
		tell(row.element.querySelector('video'), 6.84);
		tell(row.element.querySelector('audio'), 12);
		const told = lengths();
		row.update({ tiles: [sound], editable: true });
		row.update({ tiles: [clip, sound, draft], editable: true });
		assert.deepStrictEqual({ before, told, back: lengths() }, {
			before: [
				'shots/clip.mp4: waits (clip.mp4)',
				'sounds/rain.mp3: waits (rain.mp3)',
				// A draft has no file to tell it.
				'shots/next.mp4: none (next.mp4)'
			],
			told: [
				'shots/clip.mp4: 6.8s (clip.mp4, 6.8 seconds)',
				'sounds/rain.mp3: 12.0s (rain.mp3, 12.0 seconds)',
				'shots/next.mp4: none (next.mp4)'
			],
			// The clip left and came back, as by undo: its picture and its length show at once.
			back: [
				'shots/clip.mp4: 6.8s (clip.mp4, 6.8 seconds)',
				'sounds/rain.mp3: 12.0s (rain.mp3, 12.0 seconds)',
				'shots/next.mp4: none (next.mp4)'
			]
		});
	});

	test('Pick on Canvas and Import File… are two buttons named by their tooltips; Pick on Canvas is highlighted while picking and tells what a click does, while the row\'s hint gives way (D71, D106)', () => {
		const buttons = disposables.add(new BaseHalfGenerationAddButtons({
			togglePick: () => calls.push('pick'),
			importFile: () => calls.push('import'),
			setupHover: (element, content) => {
				hovers.set(element, content);
				return Disposable.None;
			}
		}));
		container.append(buttons.element);
		const button = (key: string) => buttons.element.querySelector<HTMLButtonElement>(`.bh-add-input[data-key="${key}"]`)!;
		const names = ['pick', 'import'].map(key => [button(key).getAttribute('aria-label'), hovers.get(button(key))]);
		button('pick').click();
		button('import').click();
		// The panel draws the row and the buttons for the draft that picks.
		const row = create({ tiles: [], editable: true, hint: 'Add images or audio as references', picking: true });
		buttons.update(true);
		const picking = { row: drawn(row), pressed: button('pick').getAttribute('aria-pressed'), status: buttons.element.querySelector('.bh-add-inputs-status')!.textContent };
		buttons.update(false);
		row.update({ tiles: [START], editable: false });
		assert.deepStrictEqual({ names, calls, picking, ended: button('pick').getAttribute('aria-pressed'), readOnly: drawn(row) }, {
			names: [['Pick on Canvas', 'Pick on Canvas'], ['Import File…', 'Import File…']],
			calls: ['pick', 'import'],
			picking: { row: [], pressed: 'true', status: 'Click cards on the canvas. Escape or Done ends.' },
			ended: 'false',
			readOnly: ['tile shots/start.png · mark Start']
		});
	});

	test('the row is not drawn again for the same inputs, whatever was read of their files\' addresses, and the look at a tile stays while its tile does (D71)', () => {
		// The layout of the stylesheet, for the tiles drawn again too.
		const style = mainWindow.document.createElement('style');
		style.textContent = '.bh-input-row-list { position: relative; display: flex; gap: 6px; align-items: center; } .bh-input-row-list > * { position: relative; width: 48px; height: 48px; flex: none; box-sizing: border-box; }';
		container.append(style);
		const image = () => tile('shots/a.png', { file: URI.file('/work/shots/a.png') });
		const other = tile('shots/b.png', { file: URI.file('/work/shots/b.png') });
		const row = create({ tiles: [image(), other], editable: true });
		const tileOf = (path: string) => row.element.querySelector<HTMLElement>(`.bh-input-tile[data-path="${path}"]`)!;
		const looks = () => [...layer.querySelectorAll('.bh-input-look')];
		const first = tileOf('shots/a.png');
		first.dispatchEvent(new PointerEvent('pointerenter', { pointerId: 7 }));
		const [look] = looks();
		// The check reads a file's path, and a save reads the inputs again: new addresses, one with its path cached.
		const again = image();
		void again.file!.fsPath;
		row.update({ tiles: [again, { ...other, file: URI.file('/work/shots/b.png') }], editable: true });
		const unchanged = { tile: tileOf('shots/a.png') === first, look: looks()[0] === look };
		// The keyboard leaves the row, as when the @ gives the prompt the keyboard: the look the pointer shows stays.
		const outside = mainWindow.document.createElement('input');
		container.append(outside);
		first.focus();
		outside.focus();
		const afterFocus = looks()[0] === look;
		// A connection removed after a.png: the row is drawn again, and a.png's tile and look stay where they were.
		row.update({ tiles: [again], editable: true });
		const kept = looks().length === 1 && looks()[0] === look;
		// An input put before a.png moves its tile: the look goes.
		row.update({ tiles: [other, again], editable: true });
		assert.deepStrictEqual({ unchanged, afterFocus, kept, moved: looks().length }, {
			unchanged: { tile: true, look: true },
			afterFocus: true,
			kept: true,
			moved: 0
		});
	});

	test('read only, the row has no buttons, cross, @, or swap, and no tile has a number (D71)', () => {
		const row = create({ frames: [{ role: 'start', tile: START, addLabel: '' }, { role: 'end', tile: END, addLabel: '' }], canSwap: true, tiles: [CLIP], editable: false });
		assert.deepStrictEqual(drawn(row), [
			'tile shots/start.png · mark Start',
			'arrow',
			'tile shots/end.png · mark End',
			'tile shots/clip.mp4 · dimmed'
		]);
	});

	test('the cross removes the connection and the @ puts its mention into the prompt, a note\'s too (D74)', () => {
		const row = create({ tiles: [START, CLIP, NOTE], editable: true });
		(row.element.querySelector('.bh-input-tile-remove') as HTMLButtonElement).click();
		(row.element.querySelectorAll('.bh-input-tile-name')[1] as HTMLButtonElement).click();
		(row.element.querySelectorAll('.bh-input-tile-name')[2] as HTMLButtonElement).click();
		assert.deepStrictEqual(calls, ['remove shots/start.png', 'mention shots/clip.mp4', 'mention notes/scene.md']);
	});

	test('on a focused tile, Delete removes it, Enter mentions it, and Alt+arrows move it one place', () => {
		const a = tile('shots/a.png', {});
		const b = tile('shots/b.png', {});
		const row = create({ tiles: [a, b, CLIP], editable: true });
		const tiles = [...row.element.querySelectorAll('.bh-input-tile')] as HTMLElement[];
		const key = (target: HTMLElement, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
		key(tiles[1], { key: 'Enter' });
		key(tiles[1], { key: 'ArrowRight', altKey: true });
		key(tiles[1], { key: 'ArrowLeft', altKey: true });
		key(tiles[2], { key: 'ArrowRight', altKey: true });
		key(tiles[2], { key: 'Delete' });
		assert.deepStrictEqual(calls, [
			'mention shots/b.png',
			'move shots/b.png before end',
			'move shots/b.png before shots/a.png',
			'remove shots/clip.mp4'
		]);
	});

	test('pointing at a tile shows its larger look above it, with its file\'s name and why it is dimmed; leaving hides it', () => {
		const row = create({ tiles: [START, CLIP], editable: true });
		layOut(row);
		const clip = row.element.querySelectorAll('.bh-input-tile')[1] as HTMLElement;
		pointer(clip, 'pointerenter', 0);
		const look = layer.querySelector('.bh-input-look') as HTMLElement;
		const shown = { text: [...look.children].map(child => child.textContent), side: look.dataset.side };
		pointer(clip, 'pointerleave', 0);
		assert.deepStrictEqual({ shown, after: layer.querySelector('.bh-input-look') }, {
			shown: { text: ['clip.mp4', 'Not used: Acme Motion 2 takes no videos in Frames.'], side: 'above' },
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
		const row = create({ frames: [{ role: 'start', tile: START, addLabel: '' }, { role: 'end', tile: END, addLabel: '' }], canSwap: true, tiles: [CLIP, NOTE, tile('shots/c.png', {})], editable: true });
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
