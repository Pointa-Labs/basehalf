/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfClipboardRecord, baseHalfTransferFileNames, parseBaseHalfClipboardFileNames, parseBaseHalfClipboardRecord } from '../../common/basehalfClipboard.js';
import { BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, BASEHALF_CANVAS_GRID_COLUMN_GAP, baseHalfCanvasCenteredTransferOrigin } from '../../../canvas/common/basehalfCanvasModel.js';

suite('BaseHalf clipboard', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the record names every item by its address, says which are drafts and whether they were cut, and reads back as it was written; other text is no record', () => {
		const record = baseHalfClipboardRecord([
			{ resource: URI.file('/work/shots/a b.png') },
			{ resource: URI.file('/work/shots/next.mp4'), draft: true }
		], true);
		const read = parseBaseHalfClipboardRecord(record);
		assert.deepStrictEqual({
			read: read && { cut: read.cut, items: read.items.map(item => ({ path: item.resource.path, draft: item.draft })) },
			others: ['shots/a.png', '{"version":2,"cut":false,"items":[]}', '{"version":1,"cut":false,"items":[]}', '{"version":1,"cut":"no","items":[{"uri":"file:///a"}]}'].map(parseBaseHalfClipboardRecord)
		}, {
			read: { cut: true, items: [{ path: '/work/shots/a b.png', draft: undefined }, { path: '/work/shots/next.mp4', draft: true }] },
			others: [undefined, undefined, undefined, undefined]
		});
	});

	test('the files another app copied are read from the list of file names the system gives, with the characters of XML as they were', () => {
		const list = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<array>\n\t<string>/Users/me/Desktop/Salt &amp; Pepper.png</string>\n\t<string>/Users/me/&#x4E2D;&#25991;.mov</string>\n\t<string>relative.txt</string>\n</array>\n</plist>\n';
		assert.deepStrictEqual(parseBaseHalfClipboardFileNames(list), ['/Users/me/Desktop/Salt & Pepper.png', '/Users/me/中文.mov']);
	});

	test('a picture or text that becomes a file is named as New Note names a note; a picture with a name keeps it, with a number after it when it is taken', () => {
		const first = (names: Iterable<string>, count: number) => [...names].slice(0, count);
		assert.deepStrictEqual({
			picture: first(baseHalfTransferFileNames('png'), 3),
			note: first(baseHalfTransferFileNames('md'), 2),
			named: first(baseHalfTransferFileNames('jpg', 'cat.jpg'), 3),
			noExtension: first(baseHalfTransferFileNames('', 'README'), 2)
		}, {
			picture: ['untitled.png', 'untitled-1.png', 'untitled-2.png'],
			note: ['untitled.md', 'untitled-1.md'],
			named: ['cat.jpg', 'cat 2.jpg', 'cat 3.jpg'],
			noExtension: ['README', 'README 2']
		});
	});

	test('a block pasted without a point is centered on the middle of the visible canvas', () => {
		assert.deepStrictEqual({
			one: baseHalfCanvasCenteredTransferOrigin({ x: 500, y: 400 }, [{ width: 200, height: 100 }]),
			two: baseHalfCanvasCenteredTransferOrigin({ x: 500, y: 400 }, [{ width: 200, height: 100 }, { width: 200, height: 100 }])
		}, {
			one: { x: 400, y: 350 },
			two: { x: 500 - (BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH + BASEHALF_CANVAS_GRID_COLUMN_GAP + 200) / 2, y: 350 }
		});
	});
});

