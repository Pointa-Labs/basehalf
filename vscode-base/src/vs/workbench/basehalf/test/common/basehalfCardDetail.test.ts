/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, isBaseHalfMarkdownResource } from '../../common/basehalfCardDetail.js';

suite('BaseHalfCardDetail', () => {
	test('uses source as the only implemented projection for card detail state', () => {
		assert.strictEqual(DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, 'source');
	});

	test('recognizes Markdown resources for future rich and preview projections', () => {
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/README.md')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.markdown')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.txt')), false);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/md')), false);
	});
});
