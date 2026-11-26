/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_AGENT_AREA_LARGER_TEXT_COMMAND_ID, BASEHALF_AGENT_AREA_RESET_TEXT_SIZE_COMMAND_ID, BASEHALF_AGENT_AREA_SKIP_SHELL_COMMAND_IDS, BASEHALF_AGENT_AREA_SMALLER_TEXT_COMMAND_ID } from '../../common/basehalfAgentArea.js';
import { baseHalfAgentAreaTextSize, baseHalfAgentAreaTextSizeStep } from '../../common/basehalfAgentAreaTextSize.js';

// Each part zooms by itself, rules 9 and 10: the size of the Agent Area's text is the terminal's font size.
suite('BaseHalf Agent Area text size', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a press is one pixel from the size in effect', () => {
		assert.deepStrictEqual([baseHalfAgentAreaTextSizeStep(13, 13, 1), baseHalfAgentAreaTextSizeStep(14, 13, -1), baseHalfAgentAreaTextSizeStep(12.5, 13, 1)], [14, 13, 13.5]);
	});

	test('the size stays from 6 to 100, and a value that is no number is the default', () => {
		assert.deepStrictEqual(
			[baseHalfAgentAreaTextSizeStep(100, 13, 1), baseHalfAgentAreaTextSizeStep(6, 13, -1), baseHalfAgentAreaTextSizeStep(300, 13, -1), baseHalfAgentAreaTextSizeStep('large', 13, 1), baseHalfAgentAreaTextSize(undefined, 13)],
			[100, 6, 99, 14, 13]
		);
	});

	test('the keys of the text go to no program in the terminal', () => {
		const commands = [BASEHALF_AGENT_AREA_LARGER_TEXT_COMMAND_ID, BASEHALF_AGENT_AREA_SMALLER_TEXT_COMMAND_ID, BASEHALF_AGENT_AREA_RESET_TEXT_SIZE_COMMAND_ID];
		assert.deepStrictEqual(commands.filter(command => !BASEHALF_AGENT_AREA_SKIP_SHELL_COMMAND_IDS.includes(command)), []);
	});
});
