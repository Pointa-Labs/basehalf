/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { releaseBaseHalfCanvasCardMedia } from '../../browser/basehalfCanvasCardMedia.js';

suite('BaseHalfCanvasCardMedia', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stops and unloads detached transports', () => {
		const calls: string[] = [];
		const media = {
			pause: () => calls.push('pause'),
			removeAttribute: (name: string) => calls.push(`remove:${name}`),
			load: () => calls.push('load')
		} as unknown as HTMLMediaElement;

		releaseBaseHalfCanvasCardMedia(media);

		assert.deepStrictEqual(calls, ['pause', 'remove:src', 'load']);
	});
});
