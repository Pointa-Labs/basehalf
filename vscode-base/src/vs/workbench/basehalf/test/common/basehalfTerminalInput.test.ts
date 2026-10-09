/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isIntegratedTerminalProgram } from '../../../../platform/terminal/common/terminal.js';
import { BaseHalfTerminalAtlasBudget, BaseHalfTerminalWheelAccumulator, IBaseHalfTerminalWheelDelta } from '../../common/basehalfTerminalInput.js';

suite('BaseHalfTerminalInput', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('BaseHalfTerminalWheelAccumulator', () => {
		const metrics = { cellHeight: 16, rows: 40, sensitivity: 1 };
		const precise = (deltaY: number, deltaMode = 0): IBaseHalfTerminalWheelDelta => ({ deltaY, deltaMode, discrete: false, notches: 0 });
		const notch = (deltaY: number, notches: number): IBaseHalfTerminalWheelDelta => ({ deltaY, deltaMode: 0, discrete: true, notches });

		test('counts precise deltas twice, one row per cell height, and carries the remainder across a change of direction', () => {
			const accumulator = new BaseHalfTerminalWheelAccumulator();
			assert.deepStrictEqual(
				[precise(-5), precise(-5), precise(-5), precise(-1), precise(3), precise(12), precise(4)].map(delta => accumulator.accept(delta, metrics)),
				// pending pixels: -10, -20 → -4, -14, -16 → 0, 6, 30 → 14, 22 → 6
				[0, -1, 0, -1, 0, 1, 1]
			);
		});

		test('turns a physical wheel notch into three rows, at least one notch per event', () => {
			const accumulator = new BaseHalfTerminalWheelAccumulator();
			assert.deepStrictEqual(
				[notch(-100, 1), notch(-4, 0.1), notch(240, 2)].map(delta => accumulator.accept(delta, metrics)),
				[-3, -3, 6]
			);
		});

		test('measures line deltas in cell heights and page deltas in terminal rows', () => {
			const accumulator = new BaseHalfTerminalWheelAccumulator();
			assert.deepStrictEqual(
				[precise(-1, 1), precise(0.5, 2)].map(delta => accumulator.accept(delta, metrics)),
				[-2, 40]
			);
		});

		test('scales every event by the scroll sensitivity', () => {
			const accumulator = new BaseHalfTerminalWheelAccumulator();
			const halved = { ...metrics, sensitivity: 0.5 };
			assert.deepStrictEqual(
				[precise(-16), notch(1, 1), notch(1, 1)].map(delta => accumulator.accept(delta, halved)),
				// pending pixels: -16 → 0, 24 → 8, 32 → 0
				[-1, 1, 2]
			);
		});

		test('ignores events without a vertical delta or cell height', () => {
			const accumulator = new BaseHalfTerminalWheelAccumulator();
			assert.deepStrictEqual(
				[accumulator.accept(precise(0), metrics), accumulator.accept(precise(-40), { ...metrics, cellHeight: 0 }), accumulator.accept(precise(-8), metrics)],
				[0, 0, -1]
			);
		});
	});

	suite('BaseHalfTerminalAtlasBudget', () => {
		test('asks for a clear on the third added page and defers one that comes within two seconds of the last', () => {
			const budget = new BaseHalfTerminalAtlasBudget();
			const first = [budget.pageAdded(0), budget.pageAdded(10), budget.pageAdded(20), budget.pageAdded(30)];
			budget.cleared(50);
			const second = [budget.pageAdded(100), budget.pageAdded(200), budget.pageAdded(300), budget.pageAdded(400)];
			budget.cleared(2050);
			const third = [budget.pageAdded(9000), budget.pageAdded(9001), budget.pageAdded(9002)];
			assert.deepStrictEqual({ first, second, third }, {
				first: [undefined, undefined, 0, undefined],
				second: [undefined, undefined, 1750, undefined],
				third: [undefined, undefined, 0]
			});
		});
	});

	test('recognizes BaseHalf, not VS Code, as the integrated terminal program for window reuse and --wait', () => {
		assert.deepStrictEqual(
			['BaseHalf', 'vscode', 'iTerm.app', undefined].map(isIntegratedTerminalProgram),
			[true, false, false, false]
		);
	});
});
