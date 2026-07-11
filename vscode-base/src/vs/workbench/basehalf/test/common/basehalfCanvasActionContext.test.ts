/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { IBaseHalfCanvasResourceSnapshot, sameBaseHalfCanvasResourceSnapshot } from '../../common/basehalfCanvasActionContext.js';

suite('BaseHalfCanvasActionContext', () => {
	test('accepts the same resource identity', () => {
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot(), stat()), true);
	});

	test('rejects resources replaced at the same path', () => {
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot(), stat({ mtime: 11, etag: 'changed' })), false);
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot(), stat({ isFile: false, isDirectory: true })), false);
	});

	test('compares only metadata captured by the provider', () => {
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot({ mtime: undefined, ctime: undefined, size: undefined, etag: undefined }), stat({ mtime: 99, ctime: 88, size: 77, etag: 'later' })), true);
	});
});

function snapshot(overrides: Partial<IBaseHalfCanvasResourceSnapshot> = {}): IBaseHalfCanvasResourceSnapshot {
	return {
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		mtime: 10,
		ctime: 5,
		size: 100,
		etag: 'stable',
		...overrides
	};
}

function stat(overrides: Partial<IFileStatWithPartialMetadata> = {}): IFileStatWithPartialMetadata {
	return {
		resource: URI.file('/workspace/note.md'),
		name: 'note.md',
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		mtime: 10,
		ctime: 5,
		size: 100,
		etag: 'stable',
		readonly: false,
		locked: false,
		executable: false,
		...overrides
	};
}
