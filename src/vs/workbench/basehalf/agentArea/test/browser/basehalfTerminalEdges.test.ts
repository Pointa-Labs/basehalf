/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { importAMDNodeModule } from '../../../../../amdX.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { XtermTerminal } from '../../../../contrib/terminal/browser/xterm/xtermTerminal.js';
import { baseHalfInstallTerminalEdges, baseHalfXtermColors } from '../../browser/basehalfTerminalEdges.js';

type Terminal = XtermTerminal['raw'];
type TerminalConstructor = new (options: { cols: number; rows: number; allowProposedApi?: boolean; theme?: Record<string, string> }) => Terminal;

const COLS = 20;
const ROWS = 6;
const theme = { background: '#101010', foreground: '#e0e0e0', red: '#aa0000' };

suite('BaseHalfTerminalEdges', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let TerminalCtor: TerminalConstructor;
	let host: HTMLElement;
	let surface: HTMLElement;

	suiteSetup(async () => {
		TerminalCtor = (await importAMDNodeModule<{ Terminal: TerminalConstructor }>('@xterm/xterm', 'lib/xterm.js')).Terminal;
	});

	// A pane with room around the grid on every side, as an Agent Area pane has.
	setup(() => {
		host = mainWindow.document.createElement('div');
		host.style.position = 'relative';
		host.style.width = '400px';
		host.style.height = '300px';
		surface = mainWindow.document.createElement('div');
		surface.style.position = 'absolute';
		surface.style.inset = '6px 10px 4px 8px';
		host.appendChild(surface);
		mainWindow.document.body.appendChild(host);
	});

	teardown(() => host.remove());

	function openTerminal(store: DisposableStore): Terminal {
		const raw = store.add(new TerminalCtor({ cols: COLS, rows: ROWS, allowProposedApi: true, theme }));
		raw.open(surface);
		store.add(baseHalfInstallTerminalEdges(host, raw, () => assert.fail('the xterm.js internals that the edges read are missing')));
		return raw;
	}

	/**
	 * Writes `data` and waits until the terminal has drawn the frame that shows
	 * it: the first render after the write was parsed, not the one that opening
	 * the terminal scheduled.
	 */
	async function frame(raw: Terminal, data: string): Promise<void> {
		await new Promise<void>(resolve => raw.write(data, resolve));
		await new Promise<void>(resolve => {
			const listener = raw.onRender(() => {
				listener.dispose();
				resolve();
			});
		});
	}

	/** The colors of a side, one per row or per column: 0 left, 1 right, 2 above, 3 under the grid. */
	function side(index: number): string[] {
		const canvas = host.querySelectorAll<HTMLCanvasElement>('.basehalf-agent-session-edges > canvas')[index];
		const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
		const colors: string[] = [];
		for (let i = 0; i < data.length; i += 4) {
			colors.push(`#${[data[i], data[i + 1], data[i + 2]].map(channel => channel.toString(16).padStart(2, '0')).join('')}`);
		}
		return colors;
	}

	/** Which of the sides above and under the grid, and of the corners, are shown. */
	function shown(): { above: boolean; under: boolean; corners: boolean[] } {
		const layer = host.querySelector('.basehalf-agent-session-edges')!;
		const canvases = layer.querySelectorAll<HTMLElement>(':scope > canvas');
		const corners = [...layer.querySelectorAll<HTMLElement>(':scope > .basehalf-agent-session-edge-corner')];
		return { above: canvases[2].style.display !== 'none', under: canvases[3].style.display !== 'none', corners: corners.map(corner => corner.style.display !== 'none') };
	}

	const background = '#101010';
	const paint = '\x1b[48;2;200;100;50m';
	const painted = '#c86432';
	const fill = `\x1b[?1049h\x1b[H${paint}${' '.repeat(COLS * ROWS)}\x1b[0m`;

	test('reads the element of the grid and the colors that the terminal draws with, from the xterm.js internals', () => {
		const store = disposables.add(new DisposableStore());
		const raw = store.add(new TerminalCtor({ cols: COLS, rows: ROWS, theme }));
		raw.open(surface);
		const colors = baseHalfXtermColors(raw);
		const screenElement = (raw as Terminal & { _core?: { screenElement?: HTMLElement } })._core?.screenElement;

		assert.deepStrictEqual({ screen: screenElement?.classList.contains('xterm-screen'), colors: colors && { background: colors.background, foreground: colors.foreground, red: colors.paletteColor(1), cube: colors.paletteColor(196) } }, {
			screen: true,
			colors: {
				background: 0x101010,
				foreground: 0xe0e0e0,
				red: 0xaa0000,
				cube: 0xff0000
			}
		});
	});

	test('colors the edge at the right of a row whose last cell has a background, and no other row', async () => {
		const store = disposables.add(new DisposableStore());
		const raw = openTerminal(store);

		await frame(raw, `\x1b[3;${COLS}H${paint} \x1b[0m`);

		assert.deepStrictEqual({ left: side(0), right: side(1), ...shown() }, {
			left: Array(ROWS).fill(background),
			right: [background, background, painted, background, background, background],
			above: false,
			under: false,
			corners: [false, false, false, false]
		});
	});

	test('colors the four edges and the corners of a screen painted in one color, between the grid and the pane\'s border', async () => {
		const store = disposables.add(new DisposableStore());
		const raw = openTerminal(store);

		await frame(raw, fill);

		const layer = host.querySelector('.basehalf-agent-session-edges')!;
		const [, right, , under] = [...layer.querySelectorAll<HTMLElement>(':scope > canvas')].map(canvas => canvas.getBoundingClientRect());
		const corners = [...layer.querySelectorAll<HTMLElement>(':scope > .basehalf-agent-session-edge-corner')].map(corner => mainWindow.getComputedStyle(corner).backgroundColor);
		const hostBox = host.getBoundingClientRect();
		const grid = raw.element!.querySelector('.xterm-screen')!.getBoundingClientRect();
		assert.deepStrictEqual({
			sides: [side(0), side(1), side(2), side(3)].map(colors => [...new Set(colors)]),
			...shown(),
			corners,
			rightReaches: [right.left, right.right],
			underReaches: [under.top, under.bottom]
		}, {
			sides: [[painted], [painted], [painted], [painted]],
			above: true,
			under: true,
			corners: Array(4).fill('rgb(200, 100, 50)'),
			// Each side reaches 1 px under the grid, which covers it.
			rightReaches: [grid.right - 1, hostBox.right],
			underReaches: [grid.bottom - 1, hostBox.bottom]
		});
	});

	test('leaves the edge under the grid in the default background when the last row has a cell in it, or a powerline glyph', async () => {
		const store = disposables.add(new DisposableStore());
		const raw = openTerminal(store);
		await frame(raw, fill);

		await frame(raw, `\x1b[${ROWS};5H\x1b[0m `);
		const aDefaultCell = shown();
		await frame(raw, `\x1b[${ROWS};5H${paint}\x1b[0m`);
		const aPowerlineGlyph = shown();
		await frame(raw, `\x1b[${ROWS};5H${paint} \x1b[0m`);
		const paintedAgain = shown();

		assert.deepStrictEqual({ aDefaultCell, aPowerlineGlyph, paintedAgain }, {
			aDefaultCell: { above: true, under: false, corners: [true, true, false, false] },
			aPowerlineGlyph: { above: true, under: false, corners: [true, true, false, false] },
			paintedAgain: { above: true, under: true, corners: [true, true, true, true] }
		});
	});

	test('starts when the terminal opens after it was given its edges, as a terminal made in the background does', async () => {
		const store = disposables.add(new DisposableStore());
		const raw = store.add(new TerminalCtor({ cols: COLS, rows: ROWS, allowProposedApi: true, theme }));
		store.add(baseHalfInstallTerminalEdges(host, raw, () => assert.fail('the xterm.js internals that the edges read are missing')));
		raw.open(surface);

		await frame(raw, fill);

		assert.deepStrictEqual([side(1), side(3)].map(colors => [...new Set(colors)]), [[painted], [painted]]);
	});

	test('takes the default background that a program sets (OSC 11)', async () => {
		const store = disposables.add(new DisposableStore());
		const raw = openTerminal(store);
		await frame(raw, 'x');

		await frame(raw, '\x1b]11;#334455\x1b\\');

		const layer = host.querySelector<HTMLElement>('.basehalf-agent-session-edges')!;
		assert.deepStrictEqual({ layer: mainWindow.getComputedStyle(layer).backgroundColor, right: [...new Set(side(1))] }, {
			layer: 'rgb(51, 68, 85)',
			right: ['#334455']
		});
	});
});
