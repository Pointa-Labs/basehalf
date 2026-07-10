/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { baseHalfMarkdownRichNeedsSaveRequest } from '../../common/basehalfMarkdownRichFlush.js';

suite('BaseHalfMarkdownRichFlush', () => {
	test('dirty editor requests a save in the ordinary path', () => {
		assert.strictEqual(baseHalfMarkdownRichNeedsSaveRequest(true, false, {}), true);
	});

	test('structural force flags bypass a lagging clean host bit', () => {
		assert.strictEqual(baseHalfMarkdownRichNeedsSaveRequest(false, true, { forceSerialize: true, forceWrite: false, activeProjection: 'rich' }), true);
		assert.strictEqual(baseHalfMarkdownRichNeedsSaveRequest(false, true, {}), false);
	});

	test('structural flush never serializes a stale hidden rich projection over active Source or Preview', () => {
		assert.strictEqual(baseHalfMarkdownRichNeedsSaveRequest(true, false, { forceSerialize: true, forceWrite: false, activeProjection: 'source' }), false);
	});
});
