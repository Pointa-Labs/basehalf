/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ghostty on macOS doubles a precise (trackpad) delta before scaling it.
 */
const PRECISE_DELTA_MULTIPLIER = 2;

/**
 * Ghostty's default `mouse-scroll-multiplier` for a notch of a physical wheel.
 */
const ROWS_PER_WHEEL_NOTCH = 3;

const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

export interface IBaseHalfTerminalWheelDelta {
	/**
	 * The vertical delta, negative upward, in `deltaMode` units.
	 */
	readonly deltaY: number;
	/**
	 * `WheelEvent.deltaMode`: 0 for pixels, 1 for lines, 2 for pages.
	 */
	readonly deltaMode: number;
	/**
	 * Whether the event is a notch of a physical mouse wheel.
	 */
	readonly discrete: boolean;
	/**
	 * For a discrete event, the notches it spans.
	 */
	readonly notches: number;
}

export interface IBaseHalfTerminalWheelMetrics {
	readonly cellHeight: number;
	readonly rows: number;
	/**
	 * `terminal.integrated.mouseWheelScrollSensitivity`.
	 */
	readonly sensitivity: number;
}

/**
 * Turns wheel events into terminal rows with Ghostty's semantics (D39,
 * docs/specs/agent-area-terminal.md): scroll accumulates in pixels, and every
 * whole cell height is one row. The remainder, with its sign, carries over to
 * the next event.
 */
export class BaseHalfTerminalWheelAccumulator {
	private pendingPixels = 0;

	/**
	 * Adds a wheel event and returns the whole rows it completes, negative
	 * upward.
	 */
	accept(delta: IBaseHalfTerminalWheelDelta, metrics: IBaseHalfTerminalWheelMetrics): number {
		if (delta.deltaY === 0 || metrics.cellHeight <= 0) {
			return 0;
		}
		this.pendingPixels += wheelPixels(delta, metrics);
		const rows = Math.trunc(this.pendingPixels / metrics.cellHeight);
		this.pendingPixels -= rows * metrics.cellHeight;
		return rows === 0 ? 0 : rows; // no -0
	}
}

function wheelPixels(delta: IBaseHalfTerminalWheelDelta, metrics: IBaseHalfTerminalWheelMetrics): number {
	if (delta.discrete) {
		return Math.sign(delta.deltaY) * Math.max(1, delta.notches) * ROWS_PER_WHEEL_NOTCH * metrics.cellHeight * metrics.sensitivity;
	}
	const unit = delta.deltaMode === WHEEL_DELTA_LINE ? metrics.cellHeight
		: delta.deltaMode === WHEEL_DELTA_PAGE ? metrics.rows * metrics.cellHeight
			: 1;
	return delta.deltaY * unit * PRECISE_DELTA_MULTIPLIER * metrics.sensitivity;
}

/**
 * Decides when a terminal clears the WebGL glyph atlas (D39): once the atlas
 * has added {@link BaseHalfTerminalAtlasBudget.PAGES} pages since this terminal
 * last cleared it, and at most once every
 * {@link BaseHalfTerminalAtlasBudget.MIN_INTERVAL_MS}. A clear that comes too
 * soon waits rather than being dropped.
 */
export class BaseHalfTerminalAtlasBudget {
	static readonly PAGES = 3;
	static readonly MIN_INTERVAL_MS = 2000;

	private pagesAdded = 0;
	private clearPending = false;
	private lastClearAt: number | undefined;

	/**
	 * Records a page the atlas added. Returns the delay in milliseconds after
	 * which the atlas should be cleared, or `undefined` when no clear is due.
	 * Pages added while a clear is pending do not start another count.
	 */
	pageAdded(now: number): number | undefined {
		if (this.clearPending || ++this.pagesAdded < BaseHalfTerminalAtlasBudget.PAGES) {
			return undefined;
		}
		this.clearPending = true;
		return this.lastClearAt === undefined ? 0 : Math.max(0, this.lastClearAt + BaseHalfTerminalAtlasBudget.MIN_INTERVAL_MS - now);
	}

	cleared(now: number): void {
		this.pagesAdded = 0;
		this.clearPending = false;
		this.lastClearAt = now;
	}
}
