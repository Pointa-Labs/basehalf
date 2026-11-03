/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFile } from 'child_process';
import { timeout } from '../../../../base/common/async.js';
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

/** How many files a clipboard of its own holds, and the text of its first item; the clipboard stays. */
const FILES_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
	const input = JSON.parse(argv[0]);
	const held = $.NSPasteboard.pasteboardWithName(input.pasteboard).pasteboardItems;
	let files = 0;
	for (let index = 0; index < held.count; index++) {
		if (!held.objectAtIndex(index).stringForType('public.file-url').isNil()) {
			files++;
		}
	}
	return JSON.stringify({ files, text: held.count ? ObjC.unwrap(held.objectAtIndex(0).stringForType('public.utf8-plain-text')) : '' });
}`;

function run(script: string, input: object): Promise<string> {
	return new Promise((resolve, reject) => execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, JSON.stringify(input)], { timeout: 10_000 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}

async function filesOn(pasteboard: string): Promise<{ readonly files: number; readonly text: string }> {
	return JSON.parse(await run(FILES_SCRIPT, { pasteboard }));
}

async function whenFiles(pasteboard: string, count: number): Promise<void> {
	for (let look = 0; look < 200; look++) {
		if ((await filesOn(pasteboard)).files === count) {
			return;
		}
		await timeout(10);
	}
	throw new Error(`the clipboard never held ${count} files`);
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

	(isMacintosh ? test : test.skip)('files are added to what a copy put on the clipboard, which keeps every kind of data it wrote; nothing is written once the clipboard holds another text, or an earlier copy of the same text without the copy\'s mark (files in notes, rule 35)', async function () {
		this.timeout(30_000);
		const pasteboard = `com.pointalabs.basehalf.test.${generateUuid()}`;
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard, text: '![a b](a%20b.png)', html: '<img src="a%20b.png"><!--basehalf-copy-1-->', custom: 'blocknote' }), 'written');
		const service = new BaseHalfPasteboardService();

		const changed = await service.addFiles(['/notes/elsewhere.png'], 'another text', 'basehalf-copy-1', pasteboard);
		const earlier = await service.addFiles(['/notes/elsewhere.png'], '![a b](a%20b.png)', 'basehalf-copy-0', pasteboard);
		const added = await service.addFiles(['/notes/.bh/attachments/7k3f9q2m1x/a b.png', '/notes/clip.mp4'], '![a b](a%20b.png)', 'basehalf-copy-1', pasteboard);

		assert.deepStrictEqual({ changed, earlier, added, items: JSON.parse(await run(READ_SCRIPT, { pasteboard })) }, {
			changed: false,
			earlier: false,
			added: true,
			items: [
				{
					'public.utf8-plain-text': '![a b](a%20b.png)',
					'public.html': '<img src="a%20b.png"><!--basehalf-copy-1-->',
					'org.chromium.web-custom-data': 'blocknote',
					'public.file-url': 'file:///notes/.bh/attachments/7k3f9q2m1x/a%20b.png',
				},
				{ 'public.file-url': 'file:///notes/clip.mp4' },
			],
		});
	});

	(isMacintosh ? test : test.skip)('a copy that reaches the clipboard a moment after the files were asked for gets them (files in notes, rule 35)', async function () {
		this.timeout(30_000);
		const pasteboard = `com.pointalabs.basehalf.test.${generateUuid()}`;
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard, text: 'before the copy', html: '<p>before</p>', custom: '' }), 'written');
		const service = new BaseHalfPasteboardService();

		const added = service.addFiles(['/notes/clip.mp4'], '<video src="clip.mp4" controls></video>', 'basehalf-copy-2', pasteboard);
		await new Promise(resolve => setTimeout(resolve, 300));
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard, text: '<video src="clip.mp4" controls></video>', html: '<video src="clip.mp4"></video><!--basehalf-copy-2-->', custom: 'blocknote' }), 'written');

		assert.deepStrictEqual({ added: await added, file: JSON.parse(await run(READ_SCRIPT, { pasteboard }))[0]['public.file-url'] }, { added: true, file: 'file:///notes/clip.mp4' });
	});

	(isMacintosh ? test : test.skip)('files that the system drops a moment after the write are written again while the clipboard holds the copy, and another copy put there meanwhile is never written over (copy, paste, and drop, "Copy and Cut")', async function () {
		this.timeout(30_000);
		const service = new BaseHalfPasteboardService();
		const copy = { text: '![a](a.png)', html: '<img src="a.png"><!--basehalf-copy-4-->', custom: 'blocknote' };

		const dropped = `com.pointalabs.basehalf.test.${generateUuid()}`;
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard: dropped, ...copy }), 'written');
		const keeping = service.addFiles(['/notes/a.png'], copy.text, 'basehalf-copy-4', dropped);
		await whenFiles(dropped, 1);
		// The system drops the files, as a busy one did: the copy stays, without them.
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard: dropped, ...copy }), 'written');
		const kept = await keeping;

		const replaced = `com.pointalabs.basehalf.test.${generateUuid()}`;
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard: replaced, ...copy }), 'written');
		const watching = service.addFiles(['/notes/a.png'], copy.text, 'basehalf-copy-4', replaced);
		await whenFiles(replaced, 1);
		assert.strictEqual(await run(FILL_SCRIPT, { pasteboard: replaced, text: 'another copy', html: '<p>another</p>', custom: '' }), 'written');
		await watching;

		const result = { kept, dropped: await filesOn(dropped), replaced: await filesOn(replaced) };
		await run(READ_SCRIPT, { pasteboard: dropped });
		await run(READ_SCRIPT, { pasteboard: replaced });
		assert.deepStrictEqual(result, {
			kept: true,
			dropped: { files: 1, text: copy.text },
			replaced: { files: 0, text: 'another copy' },
		});
	});
});
