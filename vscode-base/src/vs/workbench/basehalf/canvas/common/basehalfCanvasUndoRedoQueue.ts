/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';

/**
 * Runs the canvas's undo and redo one after another (exact undo, "One step
 * after another"). VS Code's undo refuses an undo or a redo that comes while
 * another runs on the same files, and then drops their whole history; a key
 * pressed while a step is still undone or redone waits for it instead.
 */
export class BaseHalfCanvasUndoRedoQueue {
	private readonly sequencer = new Sequencer();
	private running = 0;

	/**
	 * Takes an undo or a redo. With nothing running and nothing to do, it
	 * returns false, and the key goes on to whoever else takes it. Otherwise it
	 * returns the step, which runs once the steps before it are done, if `can`
	 * still says so then.
	 */
	take(can: () => boolean, run: () => Promise<void> | void): Promise<void> | false {
		if (this.running === 0 && !can()) {
			return false;
		}
		this.running++;
		return this.sequencer.queue(async () => {
			try {
				if (can()) {
					await run();
				}
			} finally {
				this.running--;
			}
		});
	}
}
