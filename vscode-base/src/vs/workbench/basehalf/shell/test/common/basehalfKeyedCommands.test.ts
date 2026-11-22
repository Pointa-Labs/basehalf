/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isBaseHalfHiddenCommand, isBaseHalfOwnCommand } from '../../common/basehalfHiddenCommands.js';
import { BASEHALF_KEYED_COMMANDS, baseHalfKeyedCommandsWithoutName } from '../../common/basehalfKeyedCommands.js';

suite('BaseHalfKeyedCommands', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('names a command of BaseHalf\'s that has a key and no name, and no command of the base', () => {
		const named = new Set(['basehalf.canvas.zoomIn', 'basehalf.cardDetail.close']);
		assert.deepStrictEqual(
			baseHalfKeyedCommandsWithoutName(['basehalf.canvas.zoomIn', 'basehalf.cardDetail.close', 'basehalf.changes.closeDiff', 'pointa.basehalf-ai-video.next', 'basehalf.changes.closeDiff', 'cursorDown', 'list.focusDown', 'workbench.action.quickOpen'], named),
			['basehalf.changes.closeDiff', 'pointa.basehalf-ai-video.next']
		);
	});

	test('every keyed command has a name of its own, is BaseHalf\'s, and is a command BaseHalf has', () => {
		assert.deepStrictEqual({
			names: BASEHALF_KEYED_COMMANDS.map(command => command.title.value),
			once: new Set(BASEHALF_KEYED_COMMANDS.map(command => command.id)).size === BASEHALF_KEYED_COMMANDS.length,
			notOwn: BASEHALF_KEYED_COMMANDS.filter(command => !isBaseHalfOwnCommand(command.id)),
			hidden: BASEHALF_KEYED_COMMANDS.filter(command => isBaseHalfHiddenCommand(command.id))
		}, {
			names: ['New Note', 'Close Card Detail', 'Go to Next Change in Changes', 'Go to Previous Change in Changes', 'Close Changes', 'Stop Editing Code on Card', 'Zoom Reader In', 'Zoom Reader Out', 'Zoom Reader to 100%'],
			once: true,
			notOwn: [],
			hidden: []
		});
	});
});
