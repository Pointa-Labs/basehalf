/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { isMacintosh } from '../../../base/common/platform.js';
import { BASEHALF_CLIPBOARD_RECORD_TYPE, IBaseHalfPasteboardContents, IBaseHalfPasteboardService } from '../common/basehalfPasteboard.js';

/**
 * Ends a script that has `pasteboard`, `items`, and `input.files`: writes the
 * items, then reads the pasteboard back before the script ends, since the
 * system drops the files of a writer that ends as soon as it has written
 * (copy, paste, and drop, "Copy and Cut"). Says `lost` when a file is not
 * there.
 */
const WRITE_ITEMS = `
	pasteboard.clearContents;
	if (!pasteboard.writeObjects(items)) {
		return 'refused';
	}
	const written = pasteboard.pasteboardItems;
	let files = 0;
	for (let index = 0; index < written.count; index++) {
		if (!written.objectAtIndex(index).stringForType('public.file-url').isNil()) {
			files++;
		}
	}
	return files === input.files.length ? 'written' : 'lost';`;

/**
 * Writes the pasteboard through AppKit, with the system's JavaScript for
 * scripting: one item for each file, as a file manager writes files it copies, and
 * the text and the record on the first item. One item stands for the text and
 * the record when there is no file, as for a copy of drafts only.
 */
const WRITE_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
	const input = JSON.parse(argv[0]);
	const items = $.NSMutableArray.array;
	const count = Math.max(1, input.files.length);
	for (let index = 0; index < count; index++) {
		const item = $.NSPasteboardItem.alloc.init;
		if (index < input.files.length) {
			item.setStringForType($.NSURL.fileURLWithPath(input.files[index]).absoluteString, 'public.file-url');
		}
		if (index === 0) {
			item.setStringForType(input.text, 'public.utf8-plain-text');
			item.setStringForType(input.record, input.recordType);
		}
		items.addObject(item);
	}
	const pasteboard = input.pasteboard ? $.NSPasteboard.pasteboardWithName(input.pasteboard) : $.NSPasteboard.generalPasteboard;${WRITE_ITEMS}
}`;

/**
 * Adds files to what the pasteboard holds: each item a copy wrote keeps all
 * its forms, the first files go onto those items, one each, and the others
 * onto items of their own, as a file manager writes files it copies. Nothing
 * is written when the first item's text is not the copy's any more.
 */
const ADD_FILES_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
	const input = JSON.parse(argv[0]);
	const pasteboard = input.pasteboard ? $.NSPasteboard.pasteboardWithName(input.pasteboard) : $.NSPasteboard.generalPasteboard;
	const held = pasteboard.pasteboardItems;
	const count = held.count;
	if (count === 0 || ObjC.unwrap(held.objectAtIndex(0).stringForType('public.utf8-plain-text')) !== input.text) {
		return 'changed';
	}
	const items = $.NSMutableArray.array;
	for (let index = 0; index < Math.max(count, input.files.length); index++) {
		const item = $.NSPasteboardItem.alloc.init;
		if (index < count) {
			const from = held.objectAtIndex(index);
			const types = from.types;
			for (let at = 0; at < types.count; at++) {
				const type = types.objectAtIndex(at);
				const data = from.dataForType(type);
				if (ObjC.unwrap(type) !== 'public.file-url' && data && !data.isNil()) {
					item.setDataForType(data, type);
				}
			}
		}
		if (index < input.files.length) {
			item.setStringForType($.NSURL.fileURLWithPath(input.files[index]).absoluteString, 'public.file-url');
		}
		items.addObject(item);
	}${WRITE_ITEMS}
}`;

export class BaseHalfPasteboardService implements IBaseHalfPasteboardService {
	declare readonly _serviceBrand: undefined;

	async write(contents: IBaseHalfPasteboardContents, pasteboard?: string): Promise<boolean> {
		if (!isMacintosh) {
			return false;
		}
		const output = await runWrite(WRITE_SCRIPT, { files: contents.files, text: contents.text, record: contents.record, recordType: BASEHALF_CLIPBOARD_RECORD_TYPE, pasteboard });
		if (output !== 'written') {
			throw new Error(`The clipboard was not written: ${output}`);
		}
		return true;
	}

	async addFiles(files: readonly string[], text: string, pasteboard?: string): Promise<boolean> {
		if (!isMacintosh || files.length === 0) {
			return false;
		}
		const output = await runWrite(ADD_FILES_SCRIPT, { files, text, pasteboard });
		if (output === 'changed') {
			return false;
		}
		if (output !== 'written') {
			throw new Error(`The files were not added to the clipboard: ${output}`);
		}
		return true;
	}
}

/** Runs a script that writes the pasteboard, and once more when the system lost a file it wrote. */
async function runWrite(script: string, input: object): Promise<string> {
	const output = await runScript(script, input);
	return output === 'lost' ? runScript(script, input) : output;
}

function runScript(script: string, input: object): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, JSON.stringify(input)], { timeout: 10_000 }, (error, stdout) => {
			if (error) {
				reject(error);
			} else {
				resolve(stdout.trim());
			}
		});
	});
}
