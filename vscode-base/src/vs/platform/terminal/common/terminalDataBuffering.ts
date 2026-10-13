/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { isString } from '../../../base/common/types.js';
import { IProcessDataEvent } from './terminal.js';

interface TerminalDataBuffer extends IDisposable {
	data: string[];
	timeoutId: Timeout;
	quietCheck?: IDisposable;
}

/**
 * Sends output that follows a quiet period without waiting for the end of its
 * batch (docs/specs/agent-area-terminal.md, Output latency): once the terminal
 * has been silent for {@link quietTime}. A pty delivers what a program writes
 * at once in pieces a fraction of a millisecond apart, and the silence keeps
 * them in one message.
 */
export interface ITerminalDataQuietFlush {
	/**
	 * The silence, in milliseconds, after which pending data is sent.
	 */
	readonly quietTime: number;
	/**
	 * The current time in milliseconds, with a resolution finer than
	 * {@link quietTime}.
	 */
	now(): number;
	/**
	 * Runs `callback` after the data that is ready now has been read.
	 */
	schedule(callback: () => void): IDisposable;
}

export class TerminalDataBufferer implements IDisposable {
	private readonly _terminalBufferMap = new Map<number, TerminalDataBuffer>();
	/**
	 * When each terminal last produced data, by the clock of the quiet flush.
	 */
	private readonly _lastDataAt = new Map<number, number>();

	constructor(
		private readonly _callback: (id: number, data: string) => void,
		private readonly _quietFlush?: ITerminalDataQuietFlush
	) {
	}

	dispose() {
		for (const buffer of this._terminalBufferMap.values()) {
			buffer.dispose();
		}
	}

	startBuffering(id: number, event: Event<string | IProcessDataEvent>, throttleBy: number = 5): IDisposable {

		const disposable = event((e: string | IProcessDataEvent) => {
			const data = isString(e) ? e : e.data;
			const quietFlush = this._quietFlush;
			const now = quietFlush?.now() ?? 0;
			const lastDataAt = this._lastDataAt.get(id);
			if (quietFlush) {
				this._lastDataAt.set(id, now);
			}
			let buffer = this._terminalBufferMap.get(id);
			if (buffer) {
				buffer.data.push(data);
				return;
			}

			const timeoutId = setTimeout(() => this.flushBuffer(id), throttleBy);
			buffer = {
				data: [data],
				timeoutId,
				dispose: () => {
					this.flushBuffer(id);
					disposable.dispose();
				}
			};
			this._terminalBufferMap.set(id, buffer);
			// A flood keeps its batches: only output after a quiet period goes early.
			if (quietFlush && (lastDataAt === undefined || now - lastDataAt >= throttleBy)) {
				this._sendWhenQuiet(id, buffer, quietFlush);
			}
		});
		return disposable;
	}

	/**
	 * Sends what `buffer` holds once the terminal has been silent for the quiet
	 * time. The batch stays open: what arrives later goes at its end, no later
	 * than it would have gone without the early send.
	 */
	private _sendWhenQuiet(id: number, buffer: TerminalDataBuffer, quietFlush: ITerminalDataQuietFlush): void {
		buffer.quietCheck = quietFlush.schedule(() => {
			buffer.quietCheck?.dispose();
			buffer.quietCheck = undefined;
			if (this._terminalBufferMap.get(id) !== buffer) {
				return;
			}
			if (quietFlush.now() - (this._lastDataAt.get(id) ?? 0) >= quietFlush.quietTime) {
				this._callback(id, buffer.data.splice(0).join(''));
			} else {
				this._sendWhenQuiet(id, buffer, quietFlush);
			}
		});
	}

	stopBuffering(id: number) {
		const buffer = this._terminalBufferMap.get(id);
		buffer?.dispose();
		this._lastDataAt.delete(id);
	}

	flushBuffer(id: number): void {
		const buffer = this._terminalBufferMap.get(id);
		if (buffer) {
			this._terminalBufferMap.delete(id);
			clearTimeout(buffer.timeoutId);
			buffer.quietCheck?.dispose();
			buffer.quietCheck = undefined;
			if (buffer.data.length > 0) {
				this._callback(id, buffer.data.join(''));
			}
		}
	}
}
