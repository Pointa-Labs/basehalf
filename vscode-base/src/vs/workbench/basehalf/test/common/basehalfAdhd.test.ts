/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	baseHalfAdhdKeywordHits,
	dedupeBaseHalfAdhdKeywords,
	mergeBaseHalfAdhdRange,
	normalizeBaseHalfAdhdRanges,
	subtractBaseHalfAdhdRange
} from '../../common/basehalfAdhd.js';

suite('BaseHalfAdhd', () => {
	test('normalizes read ranges into sorted gap-coalesced spans', () => {
		assert.deepStrictEqual(normalizeBaseHalfAdhdRanges([[5, 6], [1, 2], [3, 4], [10, 12], [12, 15]]), [
			[1, 6],
			[10, 15]
		]);

		assert.throws(() => normalizeBaseHalfAdhdRanges([[2, 1]]), /before start/);
		assert.throws(() => normalizeBaseHalfAdhdRanges([[0, 1]]), /1-based/);
	});

	test('merges and subtracts inclusive read ranges', () => {
		assert.deepStrictEqual(mergeBaseHalfAdhdRange([[1, 2], [6, 8]], 3, 5), [[1, 8]]);
		assert.deepStrictEqual(subtractBaseHalfAdhdRange([[1, 10]], 4, 6), [[1, 3], [7, 10]]);
		assert.deepStrictEqual(subtractBaseHalfAdhdRange([[1, 3], [7, 10]], 2, 8), [[1, 1], [9, 10]]);
	});

	test('dedupes trimmed keywords while preserving casing and order', () => {
		assert.deepStrictEqual(dedupeBaseHalfAdhdKeywords(['  Cost ', '', 'Cost', 'cost']), ['Cost', 'cost']);
	});

	test('finds case-insensitive and CJK keyword spans without torn overlaps', () => {
		assert.deepStrictEqual(baseHalfAdhdKeywordHits('Cost and COST again', ['cost']), [[0, 4], [9, 13]]);
		assert.deepStrictEqual(baseHalfAdhdKeywordHits('abc', ['ab', 'bc']), [[0, 3]]);
		assert.deepStrictEqual(baseHalfAdhdKeywordHits('供需均衡影响边际成本', ['供需均衡', '边际成本']), [[0, 4], [6, 10]]);
		assert.deepStrictEqual(baseHalfAdhdKeywordHits('plain text', ['absent']), []);
	});
});
