/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { FileType, IFileStat } from '../../../../platform/files/common/files.js';
import { baseHalfCanvasItemsFromStat, baseHalfCanvasPosition, isBaseHalfCanvasEntry } from '../../common/basehalfCanvasModel.js';

suite('BaseHalfCanvasModel', () => {
	test('filters tooling folders, junk files, and root agent hints', () => {
		const root = folder('/workspace', [
			folder('/workspace/src'),
			folder('/workspace/node_modules'),
			file('/workspace/README.md'),
			file('/workspace/AGENTS.md'),
			file('/workspace/.DS_Store')
		]);

		assert.deepStrictEqual(baseHalfCanvasItemsFromStat(root, true).map(item => item.name), ['src', 'README.md']);
		assert.strictEqual(isBaseHalfCanvasEntry(file('/workspace/notes/AGENTS.md'), false), true);
	});

	test('sorts folders first then files alphabetically', () => {
		const root = folder('/workspace', [
			file('/workspace/z.md'),
			folder('/workspace/b'),
			file('/workspace/a.md'),
			folder('/workspace/a')
		]);

		assert.deepStrictEqual(baseHalfCanvasItemsFromStat(root, true).map(item => item.name), ['a', 'b', 'a.md', 'z.md']);
	});

	test('returns stable grid positions', () => {
		assert.deepStrictEqual(baseHalfCanvasPosition(0, 8), { x: 48, y: 84 });
		assert.deepStrictEqual(baseHalfCanvasPosition(5, 8), { x: 48, y: 252 });
	});

	function folder(path: string, children: IFileStat[] = []): IFileStat {
		return stat(path, FileType.Directory, children);
	}

	function file(path: string): IFileStat {
		return stat(path, FileType.File);
	}

	function stat(path: string, type: FileType, children?: IFileStat[]): IFileStat {
		const resource = URI.file(path);
		return {
			resource,
			name: resource.path.split('/').pop() ?? '',
			isFile: type === FileType.File,
			isDirectory: type === FileType.Directory,
			isSymbolicLink: false,
			mtime: 0,
			ctime: 0,
			size: 0,
			children
		};
	}
});
