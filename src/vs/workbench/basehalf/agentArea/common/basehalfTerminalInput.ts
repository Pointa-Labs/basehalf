/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ghostty's default `mouse-scroll-multiplier` for a notch of a physical wheel.
 */
const ROWS_PER_WHEEL_NOTCH = 3;

/**
 * What a sum of fractions of a row may fall short of a whole row through
 * rounding.
 */
const ROW_ROUNDING_MARGIN = 1e-9;

const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

export interface IBaseHalfTerminalWheelDelta {
	/**
	 * The vertical delta, negative upward, in `deltaMode` units. Pixels are
	 * CSS pixels, like {@link IBaseHalfTerminalWheelMetrics.cellHeight}.
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
 * docs/specs/agent-area-terminal.md): scroll accumulates, with its sign, while
 * it is less than one row. Once it is one row or more, the whole rows are
 * sent and the fraction is dropped, as the reference terminal drops it. A
 * gesture that covers more than one row with each event therefore scrolls
 * less than its travel.
 *
 * A precise (trackpad) delta counts one row per cell height of finger travel.
 * That is the reference terminal's amount on a display with a scale factor of
 * 2, where its doubling of the delta and its cell height in device pixels
 * cancel out.
 */
export class BaseHalfTerminalWheelAccumulator {
	private pendingRows = 0;

	/**
	 * Adds a wheel event and returns the whole rows it completes, negative
	 * upward.
	 */
	accept(delta: IBaseHalfTerminalWheelDelta, metrics: IBaseHalfTerminalWheelMetrics): number {
		if (delta.deltaY === 0 || metrics.cellHeight <= 0) {
			return 0;
		}
		const pending = this.pendingRows + wheelRows(delta, metrics);
		// The margin keeps a sum that is one row but for rounding from waiting for another event.
		const rows = Math.trunc(pending + Math.sign(pending) * ROW_ROUNDING_MARGIN);
		this.pendingRows = rows === 0 ? pending : 0;
		return rows === 0 ? 0 : rows; // no -0
	}
}

/**
 * The rows that `delta` is worth, with a fraction. A notch is a whole number
 * of rows whatever the cell height.
 */
function wheelRows(delta: IBaseHalfTerminalWheelDelta, metrics: IBaseHalfTerminalWheelMetrics): number {
	if (delta.discrete) {
		return Math.sign(delta.deltaY) * Math.max(1, delta.notches) * ROWS_PER_WHEEL_NOTCH * metrics.sensitivity;
	}
	const rows = delta.deltaMode === WHEEL_DELTA_LINE ? delta.deltaY
		: delta.deltaMode === WHEEL_DELTA_PAGE ? delta.deltaY * metrics.rows
			: delta.deltaY / metrics.cellHeight;
	return rows * metrics.sensitivity;
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
