/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, defaultBaseHalfCardDetailProjection, isBaseHalfMarkdownResource, normalizeBaseHalfCardDetailProjection } from '../../common/basehalfCardDetail.js';

suite('BaseHalfCardDetail', () => {
	test('uses source as the fallback projection for non-Markdown files', () => {
		assert.strictEqual(DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, 'source');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/app.ts')), 'source');
	});

	test('uses preview as the Markdown default projection', () => {
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/README.md')), 'preview');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/docs/guide.markdown')), 'preview');
	});

	test('normalizes preview requests to Markdown resources only', () => {
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/README.md'), 'preview'), 'preview');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), 'preview'), 'source');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), undefined), 'source');
	});

	test('recognizes Markdown resources for card detail projections', () => {
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/README.md')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.markdown')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.txt')), false);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/md')), false);
	});
});
