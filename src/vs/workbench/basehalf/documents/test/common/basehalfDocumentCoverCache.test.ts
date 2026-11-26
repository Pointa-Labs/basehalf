/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfDocumentCoverKey,
	baseHalfDocumentCoverVersion,
	IBaseHalfDocumentCoverEntry,
	parseBaseHalfDocumentCoverEntry,
	serializeBaseHalfDocumentCoverEntry
} from '../../common/basehalfDocumentCoverCache.js';

suite('BaseHalfDocumentCoverCache', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps one entry for each path, whatever its version, and names it without the path', () => {
		const key = baseHalfDocumentCoverKey(URI.file('/workspace/sources/报告.pdf'));
		assert.deepStrictEqual({
			stable: key === baseHalfDocumentCoverKey(URI.file('/workspace/sources/报告.pdf')),
			other: key === baseHalfDocumentCoverKey(URI.file('/workspace/sources/other.pdf')),
			name: /^[0-9a-f]{40}$/.test(key),
			version: baseHalfDocumentCoverVersion('1729800000000-729642')
		}, { stable: true, other: false, name: true, version: '1:1729800000000-729642' });
	});

	test('reads back what it writes', () => {
		const entries: IBaseHalfDocumentCoverEntry[] = [
			{ version: '1:1-2', picture: { width: 800, height: 1131 } },
			{ version: '1:1-2', title: '西遊記', authors: ['Cheng\'en Wu'], picture: { width: 800, height: 1200 } },
			{ version: '1:1-2', title: 'Untitled', problem: 'noPicture' },
			{ version: '1:1-2', problem: 'protected' },
			{ version: '1:1-2', problem: 'locked' }
		];
		assert.deepStrictEqual(entries.map(entry => parseBaseHalfDocumentCoverEntry(serializeBaseHalfDocumentCoverEntry(entry))), entries);
	});

	test('reads nothing of an entry it did not write, which is then made again', () => {
		assert.deepStrictEqual([
			'',
			'not json',
			'null',
			'{}',
			'{"version": 1}',
			'{"version": "1:1-2", "picture": {"width": 0, "height": 10}}',
			'{"version": "1:1-2", "picture": "cover.webp"}',
			'{"version": "1:1-2", "authors": "one"}',
			'{"version": "1:1-2", "problem": "melted"}'
		].map(parseBaseHalfDocumentCoverEntry), new Array(9).fill(undefined));
	});
});
