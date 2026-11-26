/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow, runWhenWindowIdle } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { XtermTerminal } from './xterm/xtermTerminal.js';

const enum Constants {
	// Ghostty treats resize as a source-agnostic size stream and consumes the
	// latest value on a fixed 25ms cadence. Mouse state never crosses this layer.
	ResizeInterval = 25,
}

export class TerminalResizeDebouncer extends Disposable {
	private _latestX: number = 0;
	private _latestY: number = 0;
	private _resizePending = false;

	private readonly _hiddenResizeJob = this._register(new MutableDisposable());

	// Owned by the disposable store so the pending timer is cancelled on dispose,
	// avoiding callbacks that fire against a torn-down xterm renderer.
	private readonly _resizeScheduler = this._register(new RunOnceScheduler(
		() => this._commitLatestSize(),
		Constants.ResizeInterval,
	));

	constructor(
		private readonly _isVisible: () => boolean,
		private readonly _getXterm: () => XtermTerminal | undefined,
		private readonly _resizeBothCallback: (cols: number, rows: number) => void,
		private readonly _resizeLiveCallback: (cols: number, rows: number) => boolean,
	) {
		super();
	}

	async resize(cols: number, rows: number, immediate: boolean): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}
		this._latestX = cols;
		this._latestY = rows;

		// An explicit immediate resize is used for lifecycle transitions where the
		// caller needs the pty dimensions synchronously.
		if (immediate) {
			this._hiddenResizeJob.clear();
			this._resizeScheduler.cancel();
			this._resizePending = false;
			this._resizeBothCallback(cols, rows);
			return;
		}

		this._resizePending = true;

		// Hidden terminals do not need frame-cadence work, but dimensions remain
		// one atomic pair. Splitting X and Y into independent idle jobs can expose
		// a mixed revision to the pty when a tab becomes visible midway through.
		const win = getWindow(this._getXterm()!.raw.element);
		if (win && !this._isVisible()) {
			this._resizeScheduler.cancel();
			if (!this._hiddenResizeJob.value) {
				this._hiddenResizeJob.value = runWhenWindowIdle(win, () => {
					if (this._store.isDisposed) {
						return;
					}
					this._hiddenResizeJob.clear();
					this._commitLatestSize();
				});
			}
			return;
		}

		this._hiddenResizeJob.clear();
		if (!this._resizeScheduler.isScheduled()) {
			this._resizeScheduler.schedule();
		}
	}

	flush(): void {
		if (this._store.isDisposed) {
			return;
		}
		if (this._hiddenResizeJob.value || this._resizeScheduler.isScheduled() || this._resizePending) {
			this._hiddenResizeJob.clear();
			this._resizeScheduler.cancel();
			this._commitLatestSize();
		}
	}

	private _commitLatestSize(): void {
		if (!this._resizePending) {
			return;
		}
		this._resizePending = false;
		if (!this._resizeLiveCallback(this._latestX, this._latestY)) {
			this._resizeBothCallback(this._latestX, this._latestY);
		}
	}
}

/**
 * Builds a local-only sequence that blanks every visible row occupied by the
 * current semantic prompt while preserving the emulator cursor position.
 */
export function getPromptClearSequence(promptStartLine: number, baseY: number, cursorY: number, rows: number): string | undefined {
	const cursorLine = baseY + cursorY;
	const lastVisibleLine = baseY + rows - 1;
	if (rows <= 0 || promptStartLine < baseY || promptStartLine > cursorLine || cursorLine > lastVisibleLine) {
		return undefined;
	}
	const rowsUp = cursorLine - promptStartLine;
	let sequence = '\x1b7\r';
	if (rowsUp > 0) {
		sequence += `\x1b[${rowsUp}A`;
	}
	// Ghostty clears from the semantic prompt start through the rest of the
	// active screen, not merely through the cursor row. A shell editor can move
	// the cursor back into the middle of wrapped input; clearing only to that row
	// would leave the lower half of the old prompt behind after reflow.
	const rowsToClear = lastVisibleLine - promptStartLine + 1;
	for (let row = 0; row < rowsToClear; row++) {
		sequence += '\x1b[2K';
		if (row < rowsToClear - 1) {
			sequence += '\x1b[1B\r';
		}
	}
	return `${sequence}\x1b8`;
}
