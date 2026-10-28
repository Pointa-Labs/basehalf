/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { isMacintosh } from '../../../base/common/platform.js';
import { BASEHALF_CLIPBOARD_RECORD_TYPE, IBaseHalfPasteboardContents, IBaseHalfPasteboardService } from '../common/basehalfPasteboard.js';

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
	const pasteboard = $.NSPasteboard.generalPasteboard;
	pasteboard.clearContents;
	return pasteboard.writeObjects(items) ? 'written' : 'refused';
}`;

export class BaseHalfPasteboardService implements IBaseHalfPasteboardService {
	declare readonly _serviceBrand: undefined;

	async write(contents: IBaseHalfPasteboardContents): Promise<boolean> {
		if (!isMacintosh) {
			return false;
		}
		const input = JSON.stringify({ files: contents.files, text: contents.text, record: contents.record, recordType: BASEHALF_CLIPBOARD_RECORD_TYPE });
		const output = await new Promise<string>((resolve, reject) => {
			execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', WRITE_SCRIPT, input], { timeout: 10_000 }, (error, stdout) => {
				if (error) {
					reject(error);
				} else {
					resolve(stdout.trim());
				}
			});
		});
		if (output !== 'written') {
			throw new Error(`The clipboard was not written: ${output}`);
		}
		return true;
	}
}
