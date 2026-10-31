/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { BaseHalfNoteZoomLevel } from '../../browser/basehalfNoteZoomLevel.js';

suite('BaseHalfNoteZoomLevel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('a page gets the levels other projections report, never its own', () => {
		const disposables = store.add(new DisposableStore());
		const storage = disposables.add(new InMemoryStorageService());
		const toRich: number[] = [];
		const toPreview: number[] = [];
		const rich = disposables.add(new BaseHalfNoteZoomLevel(storage, level => toRich.push(level)));
		const preview = disposables.add(new BaseHalfNoteZoomLevel(storage, level => toPreview.push(level)));
		assert.strictEqual(rich.level, 1);

		rich.report(1.8);
		rich.report(1.776);
		preview.report(0.6);
		assert.deepStrictEqual({ toRich, toPreview, level: preview.level }, { toRich: [0.6], toPreview: [1.8, 1.776], level: 0.6 });
	});

	test('a level that is not one is kept as 100%', () => {
		const disposables = store.add(new DisposableStore());
		const level = disposables.add(new BaseHalfNoteZoomLevel(disposables.add(new InMemoryStorageService()), () => { }));
		level.report(Number.NaN);
		assert.strictEqual(level.level, 1);
	});
});
