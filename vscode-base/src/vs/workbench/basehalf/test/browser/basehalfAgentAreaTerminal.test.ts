/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { importAMDNodeModule } from '../../../../amdX.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import type { IXtermCore } from '../../../contrib/terminal/browser/xterm-private.js';
import type { XtermTerminal } from '../../../contrib/terminal/browser/xterm/xtermTerminal.js';
import { baseHalfAnswerTerminalVersion, baseHalfInstallTerminalWheel, baseHalfXtermWheelReporter, BaseHalfTerminalAtlasMaintainer } from '../../browser/basehalfAgentAreaTerminal.contribution.js';

type Terminal = XtermTerminal['raw'];
type TerminalConstructor = new (options: { cols: number; rows: number; allowProposedApi?: boolean }) => Terminal;

interface ITestTerminal {
	readonly raw: Terminal;
	readonly data: string[];
	readonly binary: string[];
}

const trackpad = { acceptStandardWheelEvent: () => { }, isPhysicalMouseWheel: () => false };

suite('BaseHalfAgentAreaTerminal', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let TerminalCtor: TerminalConstructor;
	let container: HTMLElement;

	suiteSetup(async () => {
		TerminalCtor = (await importAMDNodeModule<{ Terminal: TerminalConstructor }>('@xterm/xterm', 'lib/xterm.js')).Terminal;
	});

	setup(() => {
		container = mainWindow.document.createElement('div');
		container.style.width = '800px';
		container.style.height = '480px';
		mainWindow.document.body.appendChild(container);
	});

	teardown(() => container.remove());

	function openTerminal(store: DisposableStore): ITestTerminal {
		const raw = store.add(new TerminalCtor({ cols: 80, rows: 24, allowProposedApi: true }));
		raw.open(container);
		const data: string[] = [];
		const binary: string[] = [];
		store.add(raw.onData(value => data.push(value)));
		store.add(raw.onBinary(value => binary.push(value)));
		return { raw, data, binary };
	}

	function write(raw: Terminal, value: string): Promise<void> {
		return new Promise<void>(resolve => raw.write(value, resolve));
	}

	/**
	 * Dispatches a trackpad wheel event worth `rows` rows (negative upward)
	 * with the pointer over column 3, row 2.
	 */
	function wheel(raw: Terminal, rows: number, init: WheelEventInit = {}): WheelEvent {
		const cell = (raw as Terminal & { _core: IXtermCore })._core._renderService.dimensions.css.cell;
		const screen = raw.element!.getElementsByClassName('xterm-screen')[0] as HTMLElement;
		const box = screen.getBoundingClientRect();
		const event = new WheelEvent('wheel', {
			deltaY: Math.sign(rows) * (Math.abs(rows) + 0.25) * cell.height / 2,
			deltaMode: WheelEvent.DOM_DELTA_PIXEL,
			clientX: box.left + cell.width * 2.5,
			clientY: box.top + cell.height * 1.5,
			bubbles: true,
			cancelable: true,
			...init
		});
		screen.dispatchEvent(event);
		return event;
	}

	test('sends one SGR wheel report per row at the cell under the pointer', async () => {
		const store = disposables.add(new DisposableStore());
		const { raw, data } = openTerminal(store);
		store.add(baseHalfInstallTerminalWheel(raw, () => { }, trackpad));
		await write(raw, '\x1b[?1000h\x1b[?1006h');

		const up = wheel(raw, -3);
		const down = wheel(raw, 2);

		assert.deepStrictEqual({ data, consumed: [up.defaultPrevented, down.defaultPrevented] }, {
			data: ['\x1b[<64;3;2M', '\x1b[<64;3;2M', '\x1b[<64;3;2M', '\x1b[<65;3;2M', '\x1b[<65;3;2M'],
			consumed: [true, true]
		});
	});

	test('keeps the application\'s mouse encoding', async () => {
		const store = disposables.add(new DisposableStore());
		const { raw, data, binary } = openTerminal(store);
		store.add(baseHalfInstallTerminalWheel(raw, () => { }, trackpad));
		await write(raw, '\x1b[?1000h');

		wheel(raw, -2);

		// Default encoding: ESC [ M, then 32 + button (96 for wheel up), column, and row.
		assert.deepStrictEqual({ data, binary }, { data: [], binary: ['\x1b[M`#"', '\x1b[M`#"'] });
	});

	test('sends one cursor key per row in the alternate buffer without mouse tracking, respecting application cursor mode', async () => {
		const store = disposables.add(new DisposableStore());
		const { raw, data } = openTerminal(store);
		store.add(baseHalfInstallTerminalWheel(raw, () => { }, trackpad));
		await write(raw, '\x1b[?1049h');

		wheel(raw, -3);
		await write(raw, '\x1b[?1h');
		wheel(raw, 2);

		assert.deepStrictEqual(data, ['\x1b[A\x1b[A\x1b[A', '\x1bOB\x1bOB']);
	});

	test('leaves the normal buffer, modified wheel events, and X10 mode to xterm.js', async () => {
		const store = disposables.add(new DisposableStore());
		const normal = openTerminal(store);
		store.add(baseHalfInstallTerminalWheel(normal.raw, () => { }, trackpad));
		wheel(normal.raw, -3);

		// xterm.js sends a single report for a whole event, with the Ctrl bit (16).
		const modified = openTerminal(store);
		store.add(baseHalfInstallTerminalWheel(modified.raw, () => { }, trackpad));
		await write(modified.raw, '\x1b[?1000h\x1b[?1006h');
		wheel(modified.raw, -3, { ctrlKey: true, deltaY: -200 });

		// In X10 mode xterm.js reports no wheel; in the alternate buffer it sends one cursor key per event.
		const x10 = openTerminal(store);
		store.add(baseHalfInstallTerminalWheel(x10.raw, () => { }, trackpad));
		await write(x10.raw, '\x1b[?1049h\x1b[?9h');
		wheel(x10.raw, -3, { deltaY: -200 });

		assert.deepStrictEqual({ normal: normal.data, modified: modified.data, x10: x10.data }, {
			normal: [],
			modified: ['\x1b[<80;3;2M'],
			x10: ['\x1b[A']
		});
	});

	test('falls back to xterm.js reports and warns once when its report internals are missing', async () => {
		const store = disposables.add(new DisposableStore());
		const { raw, data } = openTerminal(store);
		let warnings = 0;
		store.add(baseHalfInstallTerminalWheel(raw, () => warnings++, trackpad));
		await write(raw, '\x1b[?1000h\x1b[?1006h');
		// xterm.js keeps its own reference to the screen element from `open`;
		// only the reporter looks it up on the core.
		const core = (raw as Terminal & { _core: { screenElement?: HTMLElement } })._core;
		const screenElement = core.screenElement;
		core.screenElement = undefined;

		wheel(raw, -3, { deltaY: -200 });
		wheel(raw, -3, { deltaY: -200 });
		const reporter = baseHalfXtermWheelReporter(raw);
		core.screenElement = screenElement;

		assert.deepStrictEqual({ reporter, data, warnings }, { reporter: undefined, data: ['\x1b[<64;3;2M', '\x1b[<64;3;2M'], warnings: 1 });
	});

	test('finds the xterm.js wheel-report internals of an opened terminal', () => {
		const store = disposables.add(new DisposableStore());
		const unopened = store.add(new TerminalCtor({ cols: 80, rows: 24 }));
		const { raw } = openTerminal(store);

		assert.deepStrictEqual({ unopened: typeof baseHalfXtermWheelReporter(unopened), opened: typeof baseHalfXtermWheelReporter(raw) }, { unopened: 'undefined', opened: 'function' });
	});

	test('answers XTVERSION as BaseHalf and leaves other parameters to xterm.js', async () => {
		const store = disposables.add(new DisposableStore());
		const { raw, data } = openTerminal(store);
		store.add(baseHalfAnswerTerminalVersion(raw, '1.2.3'));

		await write(raw, '\x1b[>q\x1b[>0q\x1b[>1q');

		assert.deepStrictEqual(data, ['\x1bP>|BaseHalf(1.2.3)\x1b\\', '\x1bP>|BaseHalf(1.2.3)\x1b\\']);
	});

	test('clears the glyph atlas on the third added page at the next frame, deferring a clear that comes within two seconds', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const store = disposables.add(new DisposableStore());
		const pageAdded = store.add(new Emitter<void>());
		const frames: (() => void)[] = [];
		let clears = 0;
		store.add(new BaseHalfTerminalAtlasMaintainer(pageAdded.event, () => clears++, runner => {
			frames.push(runner);
			return toDisposable(() => { });
		}));

		for (let i = 0; i < 5; i++) {
			pageAdded.fire();
		}
		await timeout(0);
		const beforeFrame = { clears, frames: frames.length };
		frames.shift()!();

		for (let i = 0; i < 3; i++) {
			pageAdded.fire();
		}
		await timeout(1000);
		const deferred = { clears, frames: frames.length };
		await timeout(1100);
		frames.shift()!();

		assert.deepStrictEqual({ beforeFrame, deferred, clears }, {
			beforeFrame: { clears: 0, frames: 1 },
			deferred: { clears: 1, frames: 0 },
			clears: 2
		});
	}));
});
