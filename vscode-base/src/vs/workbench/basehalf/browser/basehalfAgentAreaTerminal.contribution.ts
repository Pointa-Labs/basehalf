/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../base/browser/dom.js';
import { IMouseWheelEvent, StandardWheelEvent } from '../../../base/browser/mouseEvent.js';
import { MouseWheelClassifier } from '../../../base/browser/ui/scrollbar/scrollableElement.js';
import { disposableTimeout } from '../../../base/common/async.js';
import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { getTerminalProgramVersion, TERMINAL_PROGRAM_NAME } from '../../../platform/terminal/common/terminal.js';
import { ITerminalContribution, IXtermTerminal } from '../../contrib/terminal/browser/terminal.js';
import { registerTerminalContribution, type ITerminalContributionContext } from '../../contrib/terminal/browser/terminalExtensions.js';
import type { IXtermCore } from '../../contrib/terminal/browser/xterm-private.js';
import type { XtermTerminal } from '../../contrib/terminal/browser/xterm/xtermTerminal.js';
import { BaseHalfTerminalAtlasBudget, BaseHalfTerminalWheelAccumulator } from '../common/basehalfTerminalInput.js';

type RawXtermTerminal = XtermTerminal['raw'];

// xterm.js's CoreMouseButton.WHEEL and the CoreMouseAction values of a wheel report.
const XTERM_MOUSE_BUTTON_WHEEL = 4;
const XTERM_MOUSE_ACTION_UP = 0;
const XTERM_MOUSE_ACTION_DOWN = 1;

interface IXtermMouseReport {
	col: number;
	row: number;
	x: number;
	y: number;
	button: number;
	action: number;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
}

/**
 * The xterm.js internals that wheel reports and wheel metrics use.
 * `basehalfAgentAreaTerminal.test.ts` pins them against the bundled xterm.js.
 */
interface IXtermCoreWithMouse extends IXtermCore {
	readonly screenElement?: HTMLElement;
	readonly _mouseService?: {
		_triggerMouseEvent?(report: IXtermMouseReport): boolean;
		readonly _mouseCoordsService?: {
			getMouseReportCoords?(event: MouseEvent, element: HTMLElement): { col: number; row: number; x: number; y: number } | undefined;
		};
	};
}

interface IRawXtermWithCore extends RawXtermTerminal {
	readonly _core?: IXtermCoreWithMouse;
}

/**
 * A wheel event with Chromium's legacy `wheelDelta*` fields, which
 * `StandardWheelEvent` reads to count physical wheel notches.
 */
type ChromiumWheelEvent = WheelEvent & Pick<IMouseWheelEvent, 'wheelDelta' | 'wheelDeltaX' | 'wheelDeltaY'>;

/**
 * Answers XTVERSION (`CSI > q`, `CSI > 0 q`) with BaseHalf's terminal identity
 * instead of xterm.js's (D39). Other parameter values stay with xterm.js.
 */
export function baseHalfAnswerTerminalVersion(raw: Pick<RawXtermTerminal, 'parser' | 'input'>, version: string): IDisposable {
	return raw.parser.registerCsiHandler({ prefix: '>', final: 'q' }, params => {
		if (params.length > 1 || (params.length === 1 && params[0] !== 0)) {
			return false;
		}
		raw.input(`\x1bP>|${TERMINAL_PROGRAM_NAME}(${version})\x1b\\`, false);
		return true;
	});
}

/**
 * Returns a function that sends one wheel report for `event`'s pointer cell
 * through xterm.js's own report path, so the application's mouse protocol and
 * encoding apply unchanged. Returns `undefined` when an xterm.js upgrade
 * removed the internals it needs.
 */
export function baseHalfXtermWheelReporter(raw: RawXtermTerminal): ((event: MouseEvent, up: boolean) => boolean) | undefined {
	const core = (raw as IRawXtermWithCore)._core;
	const screenElement = core?.screenElement;
	const mouseService = core?._mouseService;
	const coordsService = mouseService?._mouseCoordsService;
	if (!screenElement || !mouseService || typeof mouseService._triggerMouseEvent !== 'function' || typeof coordsService?.getMouseReportCoords !== 'function') {
		return undefined;
	}
	return (event, up) => {
		const coords = coordsService.getMouseReportCoords?.(event, screenElement);
		return !!coords && !!mouseService._triggerMouseEvent?.({
			...coords,
			button: XTERM_MOUSE_BUTTON_WHEEL,
			action: up ? XTERM_MOUSE_ACTION_UP : XTERM_MOUSE_ACTION_DOWN,
			ctrl: false,
			alt: false,
			shift: false
		});
	};
}

/**
 * Gives `raw` Ghostty's wheel semantics (D39, docs/specs/agent-area-terminal.md).
 * An unmodified vertical wheel event becomes one wheel report per row while the
 * application tracks the wheel, or one cursor key per row in the alternate
 * buffer. Everything else keeps xterm.js's behavior, including scrolling the
 * normal buffer.
 */
export function baseHalfInstallTerminalWheel(
	raw: RawXtermTerminal,
	onMissingInternals: () => void,
	classifier: Pick<MouseWheelClassifier, 'acceptStandardWheelEvent' | 'isPhysicalMouseWheel'> = new MouseWheelClassifier()
): IDisposable {
	const accumulator = new BaseHalfTerminalWheelAccumulator();
	let reportedMissingInternals = false;
	raw.attachCustomWheelEventHandler(event => {
		const standardEvent = new StandardWheelEvent(event as ChromiumWheelEvent);
		classifier.acceptStandardWheelEvent(standardEvent);
		if (event.deltaY === 0 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
			return true;
		}

		const tracking = raw.modes.mouseTrackingMode;
		const reportsWheel = tracking === 'vt200' || tracking === 'drag' || tracking === 'any';
		if (!reportsWheel && (tracking !== 'none' || raw.buffer.active.type !== 'alternate')) {
			return true;
		}
		const reportWheel = reportsWheel ? baseHalfXtermWheelReporter(raw) : undefined;
		if (reportsWheel && !reportWheel) {
			if (!reportedMissingInternals) {
				reportedMissingInternals = true;
				onMissingInternals();
			}
			return true;
		}
		const cellHeight = (raw as IRawXtermWithCore)._core?._renderService?.dimensions?.css?.cell?.height ?? 0;
		if (cellHeight <= 0) {
			return true;
		}

		const rows = accumulator.accept(
			{ deltaY: event.deltaY, deltaMode: event.deltaMode, discrete: classifier.isPhysicalMouseWheel(), notches: Math.abs(standardEvent.deltaY) },
			{ cellHeight, rows: raw.rows, sensitivity: raw.options.scrollSensitivity ?? 1 }
		);
		if (reportWheel) {
			for (let i = 0; i < Math.abs(rows) && reportWheel(event, rows < 0); i++) {
				// One report per row.
			}
		} else if (rows !== 0) {
			const sequence = `\x1b${raw.modes.applicationCursorKeysMode ? 'O' : '['}${rows < 0 ? 'A' : 'B'}`;
			raw.input(sequence.repeat(Math.abs(rows)), true);
		}
		event.preventDefault();
		event.stopPropagation();
		return false;
	});
	return toDisposable(() => raw.attachCustomWheelEventHandler(() => true));
}

/**
 * Clears the WebGL glyph atlas before it starts merging pages, following
 * {@link BaseHalfTerminalAtlasBudget}. This replaces the reset that Claude Code
 * performs only for terminals it recognizes as xterm.js (D39).
 */
export class BaseHalfTerminalAtlasMaintainer extends Disposable {
	private readonly budget = new BaseHalfTerminalAtlasBudget();
	private readonly pendingClear = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		onDidAddTextureAtlasPage: Event<void>,
		private readonly clearTextureAtlas: () => void,
		private readonly scheduleFrame: (runner: () => void) => IDisposable,
		private readonly now: () => number = () => Date.now()
	) {
		super();
		this._register(onDidAddTextureAtlasPage(() => this.pageAdded()));
	}

	private pageAdded(): void {
		const delay = this.budget.pageAdded(this.now());
		if (delay === undefined) {
			return;
		}
		const pending = new DisposableStore();
		this.pendingClear.value = pending;
		disposableTimeout(() => pending.add(this.scheduleFrame(() => {
			this.clearTextureAtlas();
			this.budget.cleared(this.now());
		})), delay, pending);
	}
}

class BaseHalfAgentAreaTerminalContribution extends Disposable implements ITerminalContribution {
	static readonly ID = 'basehalf.agentAreaTerminal';

	constructor(
		_ctx: ITerminalContributionContext,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	xtermReady(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void {
		this._register(baseHalfAnswerTerminalVersion(xterm.raw, getTerminalProgramVersion(this.productService)));
		this._register(baseHalfInstallTerminalWheel(xterm.raw, () => this.logService.warn('Agent Area terminal: xterm.js wheel-report internals are missing; wheel reports fall back to xterm.js.')));
		this._register(new BaseHalfTerminalAtlasMaintainer(
			xterm.onDidAddTextureAtlasPage,
			() => xterm.raw.clearTextureAtlas(),
			runner => dom.scheduleAtNextAnimationFrame(dom.getWindow(xterm.raw.element), runner)
		));
	}
}

registerTerminalContribution(BaseHalfAgentAreaTerminalContribution.ID, BaseHalfAgentAreaTerminalContribution);
