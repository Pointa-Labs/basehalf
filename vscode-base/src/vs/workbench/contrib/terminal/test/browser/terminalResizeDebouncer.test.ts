/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getPromptClearSequence, TerminalResizeDebouncer } from '../../browser/terminalResizeDebouncer.js';
import type { XtermTerminal } from '../../browser/xterm/xtermTerminal.js';

suite('TerminalResizeDebouncer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const xterm = { raw: { cols: 80, rows: 24, buffer: { normal: { length: 1 } } } } as unknown as XtermTerminal;

	test('coalesces every visible size source into one atomic latest pair', async () => {
		const both: Array<[number, number]> = [];
		const live: Array<[number, number]> = [];
		const debouncer = store.add(new TerminalResizeDebouncer(
			() => true,
			() => xterm,
			(cols, rows) => both.push([cols, rows]),
			(cols, rows) => {
				live.push([cols, rows]);
				return false;
			},
		));

		await debouncer.resize(90, 24, false);
		await debouncer.resize(72, 25, false);
		await debouncer.resize(104, 23, false);

		deepStrictEqual(both, []);
		deepStrictEqual(live, []);
		debouncer.flush();
		deepStrictEqual(live, [[104, 23]]);
		deepStrictEqual(both, [[104, 23]]);
	});

	test('keeps explicit lifecycle resizes synchronous', async () => {
		const both: Array<[number, number]> = [];
		const debouncer = store.add(new TerminalResizeDebouncer(
			() => true,
			() => xterm,
			(cols, rows) => both.push([cols, rows]),
			() => false,
		));

		await debouncer.resize(120, 40, true);
		deepStrictEqual(both, [[120, 40]]);
	});

	test('automatically commits the latest dimensions on the Ghostty cadence', async () => {
		let resolveResize!: (value: [number, number]) => void;
		const resized = new Promise<[number, number]>(resolve => resolveResize = resolve);
		const debouncer = store.add(new TerminalResizeDebouncer(
			() => true,
			() => xterm,
			(cols, rows) => resolveResize([cols, rows]),
			() => false,
		));

		await debouncer.resize(95, 30, false);
		await debouncer.resize(110, 32, false);
		deepStrictEqual(await resized, [110, 32]);
	});

	test('uses the semantic atomic resize path without a duplicate fallback commit', async () => {
		const both: Array<[number, number]> = [];
		let resolveLive!: (value: [number, number]) => void;
		const resized = new Promise<[number, number]>(resolve => resolveLive = resolve);
		const debouncer = store.add(new TerminalResizeDebouncer(
			() => true,
			() => xterm,
			(cols, rows) => both.push([cols, rows]),
			(cols, rows) => {
				resolveLive([cols, rows]);
				return true;
			},
		));

		await debouncer.resize(92, 28, false);
		await debouncer.resize(108, 31, false);
		deepStrictEqual(await resized, [108, 31]);
		deepStrictEqual(both, []);
	});

	test('continues consuming a sustained stream instead of waiting for mouseup', async () => {
		const commits: Array<[number, number]> = [];
		let resolveFirst!: () => void;
		let resolveSecond!: () => void;
		const first = new Promise<void>(resolve => resolveFirst = resolve);
		const second = new Promise<void>(resolve => resolveSecond = resolve);
		const debouncer = store.add(new TerminalResizeDebouncer(
			() => true,
			() => xterm,
			() => undefined,
			(cols, rows) => {
				commits.push([cols, rows]);
				(commits.length === 1 ? resolveFirst : resolveSecond)();
				return true;
			},
		));

		await debouncer.resize(88, 24, false);
		await first;
		await debouncer.resize(104, 24, false);
		await second;
		deepStrictEqual(commits, [[88, 24], [104, 24]]);
	});

	test('keeps hidden terminal columns and rows in one revision', async () => {
		const hiddenElement = document.createElement('div');
		const hiddenXterm = { raw: { element: hiddenElement, cols: 80, rows: 24 } } as unknown as XtermTerminal;
		const both: Array<[number, number]> = [];
		const live: Array<[number, number]> = [];
		const debouncer = store.add(new TerminalResizeDebouncer(
			() => false,
			() => hiddenXterm,
			(cols, rows) => both.push([cols, rows]),
			(cols, rows) => {
				live.push([cols, rows]);
				return false;
			},
		));

		await debouncer.resize(90, 26, false);
		await debouncer.resize(112, 34, false);
		debouncer.flush();
		deepStrictEqual(live, [[112, 34]]);
		deepStrictEqual(both, [[112, 34]]);
	});

	test('cancels pending frame work on disposal', async () => {
		const both: Array<[number, number]> = [];
		const debouncer = new TerminalResizeDebouncer(
			() => true,
			() => xterm,
			(cols, rows) => both.push([cols, rows]),
			() => false,
		);

		await debouncer.resize(100, 30, false);
		debouncer.dispose();
		await new Promise(resolve => setTimeout(resolve, 40));
		deepStrictEqual(both, []);
	});

	test('builds a cursor-preserving clear sequence for a multiline semantic prompt', () => {
		strictEqual(
			getPromptClearSequence(10, 8, 4, 6),
			'\x1b7\r\x1b[2A\x1b[2K\x1b[1B\r\x1b[2K\x1b[1B\r\x1b[2K\x1b[1B\r\x1b[2K\x1b8',
		);
		strictEqual(getPromptClearSequence(7, 8, 4, 6), undefined);
		strictEqual(getPromptClearSequence(13, 8, 4, 6), undefined);
		strictEqual(getPromptClearSequence(10, 8, 6, 6), undefined);
	});
});
