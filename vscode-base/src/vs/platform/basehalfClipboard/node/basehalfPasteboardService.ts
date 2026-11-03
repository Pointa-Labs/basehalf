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
 * Whether the first item of `held` is the copy of `input`: its text, and the
 * mark in its HTML or BaseHalf's record where `input` names them.
 */
const IS_THE_COPY = `
function isTheCopy(held, input) {
	if (held.count === 0) {
		return false;
	}
	const first = held.objectAtIndex(0);
	if (ObjC.unwrap(first.stringForType('public.utf8-plain-text')) !== input.text) {
		return false;
	}
	if (input.mark) {
		const html = ObjC.unwrap(first.stringForType('public.html'));
		if (typeof html !== 'string' || !html.includes(input.mark)) {
			return false;
		}
	}
	return input.record === undefined || ObjC.unwrap(first.stringForType(input.recordType)) === input.record;
}`;

/**
 * Writes the pasteboard through AppKit, with the system's JavaScript for
 * scripting: one item for each file, as a file manager writes files it copies, and
 * the text and the record on the first item. One item stands for the text and
 * the record when there is no file, as for a copy of drafts only. Written
 * `again`, it writes only over its own copy.
 */
const WRITE_SCRIPT = `
ObjC.import('AppKit');${IS_THE_COPY}
function run(argv) {
	const input = JSON.parse(argv[0]);
	const pasteboard = input.pasteboard ? $.NSPasteboard.pasteboardWithName(input.pasteboard) : $.NSPasteboard.generalPasteboard;
	if (input.again && !isTheCopy(pasteboard.pasteboardItems, input)) {
		return 'changed';
	}
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
	}${WRITE_ITEMS}
}`;

/**
 * Adds files to what the pasteboard holds: each item a copy wrote keeps all
 * its forms, the first files go onto those items, one each, and the others
 * onto items of their own, as a file manager writes files it copies. It waits
 * for the copy, two seconds at most: a page's copy can reach the pasteboard a
 * moment after the page said it copied, and an earlier copy of the same text
 * is told from it by the mark in its HTML. Nothing is written when the first
 * item is not the copy's.
 */
const ADD_FILES_SCRIPT = `
ObjC.import('AppKit');${IS_THE_COPY}
function run(argv) {
	const input = JSON.parse(argv[0]);
	const pasteboard = input.pasteboard ? $.NSPasteboard.pasteboardWithName(input.pasteboard) : $.NSPasteboard.generalPasteboard;
	let held = pasteboard.pasteboardItems;
	for (let waited = 0; !isTheCopy(held, input) && waited < 100; waited++) {
		$.NSThread.sleepForTimeInterval(0.02);
		held = pasteboard.pasteboardItems;
	}
	if (!isTheCopy(held, input)) {
		return 'changed';
	}
	const count = held.count;
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

/**
 * Says whether the pasteboard holds the copy of `input` with all its files
 * (`held`), the copy without some of them (`lost`), or another copy
 * (`changed`). It runs in a process of its own, which sees what the system
 * keeps.
 */
const CHECK_SCRIPT = `
ObjC.import('AppKit');${IS_THE_COPY}
function run(argv) {
	const input = JSON.parse(argv[0]);
	const pasteboard = input.pasteboard ? $.NSPasteboard.pasteboardWithName(input.pasteboard) : $.NSPasteboard.generalPasteboard;
	const held = pasteboard.pasteboardItems;
	if (!isTheCopy(held, input)) {
		return 'changed';
	}
	let files = 0;
	for (let index = 0; index < held.count; index++) {
		if (!held.objectAtIndex(index).stringForType('public.file-url').isNil()) {
			files++;
		}
	}
	return files === input.files.length ? 'held' : 'lost';
}`;

export class BaseHalfPasteboardService implements IBaseHalfPasteboardService {
	declare readonly _serviceBrand: undefined;

	async write(contents: IBaseHalfPasteboardContents, pasteboard?: string): Promise<boolean> {
		if (!isMacintosh) {
			return false;
		}
		const input = { files: contents.files, text: contents.text, record: contents.record, recordType: BASEHALF_CLIPBOARD_RECORD_TYPE, pasteboard };
		const output = await runWrite(WRITE_SCRIPT, input);
		if (output !== 'written') {
			throw new Error(`The clipboard was not written: ${output}`);
		}
		if (input.files.length > 0) {
			// A paste in BaseHalf reads the record, which the system keeps: the look for the files is not waited for.
			void keepFiles(WRITE_SCRIPT, { ...input, again: true }, input);
		}
		return true;
	}

	async addFiles(files: readonly string[], text: string, mark: string, pasteboard?: string): Promise<boolean> {
		if (!isMacintosh || files.length === 0) {
			return false;
		}
		const input = { files, text, mark, pasteboard };
		const output = await runWrite(ADD_FILES_SCRIPT, input);
		if (output === 'changed') {
			return false;
		}
		if (output !== 'written') {
			throw new Error(`The files were not added to the clipboard: ${output}`);
		}
		await keepFiles(ADD_FILES_SCRIPT, input, input);
		return true;
	}
}

/**
 * A busy system can drop the files of a write a moment after its writer
 * ended (copy, paste, and drop, "Copy and Cut"): a process of its own looks
 * 0.3 s later, and the files are written again while the pasteboard still
 * holds the copy, twice at most. The scripts write only over the copy, never
 * over what another copy put there meanwhile.
 */
async function keepFiles(script: string, again: object, check: object): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt++) {
		await new Promise<void>(resolve => setTimeout(resolve, 300));
		if (await runScript(CHECK_SCRIPT, check).catch(() => 'changed') !== 'lost') {
			return;
		}
		await runWrite(script, again).catch(() => undefined);
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
