/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFile } from 'child_process';
import { isMacintosh } from '../../../../base/common/platform.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BASEHALF_CLIPBOARD_RECORD_TYPE } from '../../common/basehalfPasteboard.js';
import { BaseHalfPasteboardService } from '../../node/basehalfPasteboardService.js';

/** Fills a clipboard of its own as a page's copy does: its text, its HTML, and the page's own kinds of data, in one item. */
const FILL_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
	const input = JSON.parse(argv[0]);
	const pasteboard = $.NSPasteboard.pasteboardWithName(input.pasteboard);
	const item = $.NSPasteboardItem.alloc.init;
	item.setStringForType(input.text, 'public.utf8-plain-text');
	item.setStringForType(input.html, 'public.html');
	item.setDataForType($(input.custom).dataUsingEncoding($.NSUTF8StringEncoding), 'org.chromium.web-custom-data');
	pasteboard.clearContents;
	return pasteboard.writeObjects($.NSArray.arrayWithObject(item)) ? 'written' : 'refused';
}`;

/** What a clipboard of its own holds, item by item and kind by kind, as text; then it is released. */
const READ_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
	const input = JSON.parse(argv[0]);
	const pasteboard = $.NSPasteboard.pasteboardWithName(input.pasteboard);
	const items = [];
	const held = pasteboard.pasteboardItems;
	for (let index = 0; index < held.count; index++) {
		const item = held.objectAtIndex(index);
		const kinds = {};
		const types = item.types;
		for (let at = 0; at < types.count; at++) {
			const type = ObjC.unwrap(types.objectAtIndex(at));
			const data = item.dataForType(type);
			kinds[type] = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
		}
		items.push(kinds);
	}
	pasteboard.releaseGlobally;
	return JSON.stringify(items);
}`;

function run(script: string, input: object): Promise<string> {
	return new Promise((resolve, reject) => execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, JSON.stringify(input)], { timeout: 10_000 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}

suite('BaseHalfPasteboardService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	(isMacintosh ? test : test.skip)('a copy of items writes each file as an item of its own, the text and the record on the first, and is done once the clipboard holds every file (copy, paste, and drop, "Copy and Cut")', async function () {
		this.timeout(30_000);
		const pasteboard = `com.pointalabs.basehalf.test.${generateUuid()}`;
		const service = new BaseHalfPasteboardService();

		const written = await service.write({ files: ['/notes/a b.png', '/notes/clip.mp4'], text: 'a b.png\nclip.mp4', record: '{"items":2}' }, pasteboard);

		assert.deepStrictEqual({ written, items: JSON.parse(await run(READ_SCRIPT, { pasteboard })) }, {
			written: true,
			items: [
				{
					'public.file-url': 'file:///notes/a%20b.png',
					'public.utf8-plain-text': 'a b.png\nclip.mp4',
					[BASEHALF_CLIPBOARD_RECORD_TYPE]: '{"items":2}',
				},
				{ 'public.file-url': 'file:///notes/clip.mp4' },
			],
		});
	});

	(isMacintosh ? test : test.skip)('files are added to what a copy put on the clipboard, which keeps every kind of data it wrote; nothing is written once the clipboard holds another text (files in notes, rule 35)', async function () {
		this.timeout(30_000);
		const pasteboard = `com.pointalabs.basehalf.test.${generateUuid()}`;
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard, text: '![a b](a%20b.png)', html: '<img src="a%20b.png">', custom: 'blocknote' }), 'written');
		const service = new BaseHalfPasteboardService();

		const changed = await service.addFiles(['/notes/elsewhere.png'], 'another text', pasteboard);
		const added = await service.addFiles(['/notes/.bh/attachments/7k3f9q2m1x/a b.png', '/notes/clip.mp4'], '![a b](a%20b.png)', pasteboard);

		assert.deepStrictEqual({ changed, added, items: JSON.parse(await run(READ_SCRIPT, { pasteboard })) }, {
			changed: false,
			added: true,
			items: [
				{
					'public.utf8-plain-text': '![a b](a%20b.png)',
					'public.html': '<img src="a%20b.png">',
					'org.chromium.web-custom-data': 'blocknote',
					'public.file-url': 'file:///notes/.bh/attachments/7k3f9q2m1x/a%20b.png',
				},
				{ 'public.file-url': 'file:///notes/clip.mp4' },
			],
		});
	});
});
