/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { BaseHalfFilePlacesService } from '../../common/basehalfFilePlaces.js';

suite('BaseHalf file places', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const file = URI.file('/workspace/a.ts');
	const other = URI.file('/workspace/b.ts');

	function create() {
		const identity = store.add(new UriIdentityService(store.add(new FileService(new NullLogService()))));
		return store.add(new BaseHalfFilePlacesService(identity));
	}

	test('a file has one place, from whichever surface moved it last', () => {
		const places = create();
		const card = {};
		const view = {};
		assert.strictEqual(places.placeOf(file), undefined);
		places.setPlace(file, { top: 40 }, card);
		assert.deepStrictEqual(places.placeOf(file), { top: 40 });
		places.setPlace(file, { top: 275, focus: 301 }, view);
		assert.deepStrictEqual(places.placeOf(file), { top: 275, focus: 301 });
		assert.strictEqual(places.placeOf(other), undefined);
	});

	test('a file at its first line has no place, unless something further down was being read', () => {
		const places = create();
		places.setPlace(file, { top: 40 }, {});
		places.setPlace(file, { top: 1 }, {});
		assert.strictEqual(places.placeOf(file), undefined);
		places.setPlace(file, { top: 1, focus: 20 }, {});
		assert.deepStrictEqual(places.placeOf(file), { top: 1, focus: 20 });
	});

	test('it says who moved a place, and says nothing when nothing moved', () => {
		const places = create();
		const card = {};
		const moves: object[] = [];
		store.add(places.onDidChange(event => moves.push(event.from)));
		places.setPlace(file, { top: 40 }, card);
		places.setPlace(file, { top: 40 }, {});
		assert.deepStrictEqual(moves, [card]);
		assert.strictEqual(moves[0], card);
	});
});
