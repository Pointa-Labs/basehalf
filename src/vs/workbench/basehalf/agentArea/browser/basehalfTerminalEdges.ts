/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfTerminalEdges.css';
import * as dom from '../../../../base/browser/dom.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import type { XtermTerminal } from '../../../contrib/terminal/browser/xterm/xtermTerminal.js';
import { baseHalfCellBackground, baseHalfRowColorsItsEdge, IBaseHalfTerminalColors } from '../common/basehalfTerminalEdges.js';

type RawXtermTerminal = XtermTerminal['raw'];

interface IXtermColor {
	readonly rgba: number;
}

/**
 * The xterm.js internals that the edges read: the element of the grid, and
 * the colors the terminal draws with now, which follow the theme and what a
 * program set (OSC 4, 10, and 11). Both exist once the terminal is open.
 * `basehalfTerminalEdges.test.ts` pins them against the bundled xterm.js.
 */
interface IRawXtermWithEdgeInternals extends RawXtermTerminal {
	readonly _core?: {
		readonly screenElement?: HTMLElement;
		readonly _themeService?: {
			readonly colors?: {
				readonly background?: IXtermColor;
				readonly foreground?: IXtermColor;
				readonly ansi?: readonly IXtermColor[];
			};
		};
	};
}

/** The colors `raw` draws with now, or `undefined` when xterm.js no longer has the internals. */
export function baseHalfXtermColors(raw: RawXtermTerminal): IBaseHalfTerminalColors | undefined {
	const colors = (raw as IRawXtermWithEdgeInternals)._core?._themeService?.colors;
	const ansi = colors?.ansi;
	if (!colors?.background || !colors.foreground || !ansi) {
		return undefined;
	}
	return {
		background: colors.background.rgba >>> 8,
		foreground: colors.foreground.rgba >>> 8,
		paletteColor: index => {
			const color = ansi[index];
			return color ? color.rgba >>> 8 : undefined;
		}
	};
}

function cssColor(color: number): string {
	return `#${color.toString(16).padStart(6, '0')}`;
}

/** How far a side reaches under the grid, which covers it, so that no seam shows at a fractional position. */
const OVERLAP = 1;

/** One side of the edges: a canvas of one pixel per row or per column, which CSS stretches over the side. */
class BaseHalfTerminalEdgeStrip {
	readonly canvas: HTMLCanvasElement;
	colors = new Uint32Array(0);
	private readonly context: CanvasRenderingContext2D | null;
	private image: ImageData | undefined;
	private changed = false;

	constructor(parent: HTMLElement, private readonly alongRows: boolean) {
		this.canvas = dom.append(parent, dom.$<HTMLCanvasElement>('canvas.basehalf-agent-session-edge'));
		this.context = this.canvas.getContext('2d');
	}

	resize(length: number): void {
		this.colors = new Uint32Array(length);
		this.canvas.width = this.alongRows ? 1 : Math.max(1, length);
		this.canvas.height = this.alongRows ? Math.max(1, length) : 1;
		this.image = length > 0 ? this.context?.createImageData(this.canvas.width, this.canvas.height) : undefined;
		this.changed = true;
	}

	set(index: number, color: number): void {
		if (this.colors[index] !== color) {
			this.colors[index] = color;
			this.changed = true;
		}
	}

	paint(): void {
		if (!this.changed || !this.image || !this.context) {
			return;
		}
		this.changed = false;
		const data = this.image.data;
		for (let index = 0; index < this.colors.length; index++) {
			const color = this.colors[index];
			data[index * 4] = (color >> 16) & 0xff;
			data[index * 4 + 1] = (color >> 8) & 0xff;
			data[index * 4 + 2] = color & 0xff;
			data[index * 4 + 3] = 0xff;
		}
		this.context.putImageData(this.image, 0, 0);
	}
}

/** The grid's sides within the pane, and the pane's size, in CSS pixels. */
interface IGridBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly width: number;
	readonly height: number;
}

interface IEdgeBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
	readonly shown: boolean;
}

function place(element: HTMLElement, box: IEdgeBox): void {
	const visible = box.shown && box.width > 0 && box.height > 0;
	element.style.display = visible ? '' : 'none';
	if (visible) {
		element.style.left = `${box.left}px`;
		element.style.top = `${box.top}px`;
		element.style.width = `${box.width}px`;
		element.style.height = `${box.height}px`;
	}
}

/**
 * Paints the part of an Agent Area pane outside the terminal's grid with the
 * background of the nearest cell (D86): beside each row, its first and its
 * last cell; above and under the grid, the first and the last row, where
 * {@link baseHalfRowColorsItsEdge} allows it. It lies under the pane's
 * surface, whose own backgrounds are transparent, and follows each frame that
 * the terminal draws.
 */
export class BaseHalfTerminalEdges extends Disposable {
	private readonly layer: HTMLElement;
	private readonly left: BaseHalfTerminalEdgeStrip;
	private readonly right: BaseHalfTerminalEdgeStrip;
	private readonly top: BaseHalfTerminalEdgeStrip;
	private readonly bottom: BaseHalfTerminalEdgeStrip;
	/** Top left, top right, bottom left, and bottom right. */
	private readonly corners: readonly HTMLElement[];
	private readonly cornerColors: number[] = [-1, -1, -1, -1];
	private readonly resizeObserver: dom.DisposableResizeObserver;
	private readonly screenObservation = this._register(new MutableDisposable());
	private codes = new Uint32Array(0);
	private screen: HTMLElement | undefined;
	private background: number | undefined;
	private topColorsEdge = false;
	private bottomColorsEdge = false;
	/** The grid within the pane, measured after a change of size only, never while a frame is drawn. */
	private grid: IGridBox | undefined;
	private placed: { readonly grid: IGridBox; readonly above: boolean; readonly under: boolean } | undefined;
	private warned = false;

	/**
	 * @param warn Called once when the terminal is open and the xterm.js
	 * internals that the edges read are missing; the pane then keeps the
	 * theme's terminal background around the grid.
	 */
	constructor(
		private readonly host: HTMLElement,
		private readonly raw: RawXtermTerminal,
		private readonly warn: () => void
	) {
		super();
		this.layer = dom.$('.basehalf-agent-session-edges');
		this.layer.setAttribute('aria-hidden', 'true');
		host.prepend(this.layer);
		this._register(toDisposable(() => this.layer.remove()));
		this.left = new BaseHalfTerminalEdgeStrip(this.layer, true);
		this.right = new BaseHalfTerminalEdgeStrip(this.layer, true);
		this.top = new BaseHalfTerminalEdgeStrip(this.layer, false);
		this.bottom = new BaseHalfTerminalEdgeStrip(this.layer, false);
		this.corners = [0, 1, 2, 3].map(() => dom.append(this.layer, dom.$('.basehalf-agent-session-edge-corner')));

		this.resizeObserver = this._register(new dom.DisposableResizeObserver('basehalfTerminalEdges', () => {
			this.grid = undefined;
			this.update(0, this.raw.rows - 1);
		}, dom.getWindow(host)));
		this._register(this.resizeObserver.observe(host));
		this._register(raw.onRender(({ start, end }) => this.update(start, end)));
		this.update(0, raw.rows - 1);
	}

	/**
	 * Reads the cells at the sides of rows `start` to `end`, and the first and
	 * the last row when they are among them, and paints what changed.
	 */
	private update(start: number, end: number): void {
		// xterm.js has its grid's element, and its colors, only once the terminal is open.
		if (!this.raw.element) {
			return;
		}
		const screen = (this.raw as IRawXtermWithEdgeInternals)._core?.screenElement;
		const colors = baseHalfXtermColors(this.raw);
		if (!screen || !colors) {
			if (!this.warned) {
				this.warned = true;
				this.warn();
			}
			return;
		}
		if (screen !== this.screen) {
			this.screen = screen;
			this.screenObservation.value = this.resizeObserver.observe(screen);
		}

		const { cols, rows } = this.raw;
		if (this.left.colors.length !== rows || this.top.colors.length !== cols) {
			this.left.resize(rows);
			this.right.resize(rows);
			this.top.resize(cols);
			this.bottom.resize(cols);
			this.codes = new Uint32Array(cols);
			this.grid = undefined;
			start = 0;
			end = rows - 1;
		}
		if (colors.background !== this.background) {
			this.background = colors.background;
			this.layer.style.backgroundColor = cssColor(colors.background);
		}

		const buffer = this.raw.buffer.active;
		const cell = buffer.getNullCell();
		for (let y = Math.max(0, start); y <= Math.min(end, rows - 1); y++) {
			const line = buffer.getLine(buffer.viewportY + y);
			this.left.set(y, line?.getCell(0, cell) ? baseHalfCellBackground(cell, colors) : colors.background);
			this.right.set(y, line?.getCell(cols - 1, cell) ? baseHalfCellBackground(cell, colors) : colors.background);
		}
		if (start <= 0) {
			this.topColorsEdge = this.readRow(0, this.top, colors);
		}
		if (end >= rows - 1) {
			this.bottomColorsEdge = this.readRow(rows - 1, this.bottom, colors);
		}

		this.left.paint();
		this.right.paint();
		this.top.paint();
		this.bottom.paint();
		this.paintCorner(0, this.top.colors[0]);
		this.paintCorner(1, this.top.colors[cols - 1]);
		this.paintCorner(2, this.bottom.colors[0]);
		this.paintCorner(3, this.bottom.colors[cols - 1]);
		this.layout(screen);
	}

	private readRow(y: number, strip: BaseHalfTerminalEdgeStrip, colors: IBaseHalfTerminalColors): boolean {
		const buffer = this.raw.buffer.active;
		const line = buffer.getLine(buffer.viewportY + y);
		const cell = buffer.getNullCell();
		for (let x = 0; x < strip.colors.length; x++) {
			const loaded = line?.getCell(x, cell);
			strip.set(x, loaded ? baseHalfCellBackground(cell, colors) : colors.background);
			this.codes[x] = loaded ? cell.getCode() : 0;
		}
		return baseHalfRowColorsItsEdge(strip.colors, this.codes, colors.background);
	}

	private paintCorner(index: number, color: number | undefined): void {
		if (color !== undefined && this.cornerColors[index] !== color) {
			this.cornerColors[index] = color;
			this.corners[index].style.backgroundColor = cssColor(color);
		}
	}

	/**
	 * Places each side between the grid and the pane's border, and shows the
	 * sides above and under the grid only where their row colors them.
	 */
	private layout(screen: HTMLElement): void {
		if (!this.grid) {
			const hostBox = this.host.getBoundingClientRect();
			const gridBox = screen.getBoundingClientRect();
			this.grid = {
				left: gridBox.left - hostBox.left,
				top: gridBox.top - hostBox.top,
				right: gridBox.right - hostBox.left,
				bottom: gridBox.bottom - hostBox.top,
				width: hostBox.width,
				height: hostBox.height
			};
		}
		const grid = this.grid;
		const above = this.topColorsEdge;
		const under = this.bottomColorsEdge;
		if (this.placed?.grid === grid && this.placed.above === above && this.placed.under === under) {
			return;
		}
		this.placed = { grid, above, under };
		const { left, top, right, bottom, width, height } = grid;
		place(this.left.canvas, { left: 0, top, width: left + OVERLAP, height: bottom - top, shown: true });
		place(this.right.canvas, { left: right - OVERLAP, top, width: width - right + OVERLAP, height: bottom - top, shown: true });
		place(this.top.canvas, { left, top: 0, width: right - left, height: top + OVERLAP, shown: above });
		place(this.bottom.canvas, { left, top: bottom - OVERLAP, width: right - left, height: height - bottom + OVERLAP, shown: under });
		const [topLeft, topRight, bottomLeft, bottomRight] = this.corners;
		place(topLeft, { left: 0, top: 0, width: left, height: top, shown: above });
		place(topRight, { left: right, top: 0, width: width - right, height: top, shown: above });
		place(bottomLeft, { left: 0, top: bottom, width: left, height: height - bottom, shown: under });
		place(bottomRight, { left: right, top: bottom, width: width - right, height: height - bottom, shown: under });
	}
}

/**
 * Gives an Agent Area pane edges that take the background of the nearest
 * cell (D86), from the time its terminal opens, also when it opens later.
 * Without the xterm.js internals that they read, the pane keeps the theme's
 * terminal background around the grid, and `warn` is called once.
 */
export function baseHalfInstallTerminalEdges(host: HTMLElement, raw: RawXtermTerminal, warn: () => void): IDisposable {
	return new BaseHalfTerminalEdges(host, raw, warn);
}
