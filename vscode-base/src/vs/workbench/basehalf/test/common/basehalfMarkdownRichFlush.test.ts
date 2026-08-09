/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { baseHalfMarkdownRichColdFlushResult, baseHalfMarkdownRichNeedsSaveRequest } from '../../common/basehalfMarkdownRichFlush.js';

suite('BaseHalfMarkdownRichFlush', () => {
	test('completes a forced cold clean flush without entering the webview save path', () => {
		const coldResult = baseHalfMarkdownRichColdFlushResult(false, false);
		assert.strictEqual(coldResult, true);
		assert.strictEqual(coldResult === undefined
			&& baseHalfMarkdownRichNeedsSaveRequest(false, true, { forceSerialize: true }), false);
		assert.strictEqual(baseHalfMarkdownRichColdFlushResult(true, false), undefined);
	});

	test('fails a cold dirty flush closed', () => {
		assert.strictEqual(baseHalfMarkdownRichColdFlushResult(false, true), false);
		assert.strictEqual(baseHalfMarkdownRichColdFlushResult(true, true), undefined);
	});

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
