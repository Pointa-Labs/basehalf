/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtensionRuntimeActionType, IExtension } from '../../../contrib/extensions/common/extensions.js';
import { selectBaseHalfPluginRuntimeExtension } from '../../browser/basehalfPluginRuntimeModel.js';

suite('BaseHalf plugin runtime action', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps the captured native model reachable after uninstall removes it from queryLocal', () => {
		const extension = {
			identifier: { id: 'pointa.basehalf-ai-video' },
			runtimeState: { action: ExtensionRuntimeActionType.RestartExtensions }
		} as IExtension;

		assert.strictEqual(selectBaseHalfPluginRuntimeExtension(
			extension.identifier.id,
			extension,
			[]
		), extension);
	});
});
