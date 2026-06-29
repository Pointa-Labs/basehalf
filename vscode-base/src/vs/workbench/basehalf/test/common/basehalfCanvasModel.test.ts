/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { FileType, IFileStat } from '../../../../platform/files/common/files.js';
import {
	BASEHALF_CANVAS_CHILD_LIMIT,
	baseHalfCanvasItemsFromStat,
	baseHalfCanvasModelFromStat,
	baseHalfCanvasPosition,
	isBaseHalfCanvasEntry
} from '../../common/basehalfCanvasModel.js';

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

	test('merges saved canvas card geometry by workspace-relative path', () => {
		const root = folder('/workspace', [
			folder('/workspace/docs'),
			file('/workspace/README.md')
		]);

		const model = baseHalfCanvasModelFromStat(root, {
			rootLevel: true,
			canvas: {
				path: '',
				size: { width: 1200, height: 800 },
				cards: [{ path: 'docs', kind: 'folder', x: 320, y: 180, width: 260, height: 140 }],
				edges: []
			}
		});

		assert.deepStrictEqual(model.size, { width: 1200, height: 800 });
		assert.deepStrictEqual(
			model.items.find(item => item.path === 'docs')?.card,
			{ path: 'docs', kind: 'folder', x: 320, y: 180, width: 260, height: 140 }
		);
		assert.strictEqual(model.items.find(item => item.path === 'README.md')?.card, undefined);
	});

	test('uses folder relative paths when matching saved card geometry inside subfolders', () => {
		const docs = folder('/workspace/docs', [
			file('/workspace/docs/chapter-01.md')
		]);

		const model = baseHalfCanvasModelFromStat(docs, {
			rootLevel: false,
			folderRelativePath: 'docs',
			canvas: {
				path: 'docs',
				cards: [{ path: 'docs/chapter-01.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 }],
				edges: []
			}
		});

		assert.strictEqual(model.items[0]?.path, 'docs/chapter-01.md');
		assert.deepStrictEqual(
			model.items[0]?.card,
			{ path: 'docs/chapter-01.md', kind: 'file', x: 10, y: 20, width: 260, height: 140 }
		);
	});

	test('caps very large folders and reports how many canvas entries were held back', () => {
		const children = Array.from({ length: BASEHALF_CANVAS_CHILD_LIMIT + 2 }, (_, index) => file(`/workspace/${String(index).padStart(3, '0')}.md`));
		const root = folder('/workspace', children);

		const model = baseHalfCanvasModelFromStat(root, { rootLevel: true });

		assert.strictEqual(model.items.length, BASEHALF_CANVAS_CHILD_LIMIT);
		assert.strictEqual(model.truncated, 2);
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
