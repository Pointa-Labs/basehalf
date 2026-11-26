/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isBaseHalfViewContainerOffered, isBaseHalfViewOffered } from '../../common/basehalfOfferedViews.js';

suite('BaseHalfOfferedViews', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a list of views offers the views BaseHalf shows, and no hidden, remapped, or hosted one', () => {
		assert.deepStrictEqual({
			containers: [
				'workbench.view.explorer', 'workbench.view.scm', 'workbench.view.search', 'basehalf.agentArea',
				'workbench.view.debug', 'workbench.view.extensions', 'workbench.panel.markers', 'workbench.panel.output', 'terminal',
				'workbench.view.extension.codexViewContainer'
			].map(isBaseHalfViewContainerOffered),
			views: [
				isBaseHalfViewOffered('workbench.view.explorer', 'workbench.explorer.fileView'),
				isBaseHalfViewOffered('workbench.view.scm', 'workbench.scm.history'),
				isBaseHalfViewOffered('workbench.view.explorer', 'outline'),
				isBaseHalfViewOffered('workbench.view.explorer', 'timeline'),
				isBaseHalfViewOffered('workbench.panel.output', 'workbench.panel.output'),
				isBaseHalfViewOffered('terminal', 'terminal')
			]
		}, {
			containers: [true, true, true, true, false, false, false, false, false, false],
			views: [true, true, false, false, false, false]
		});
	});
});
