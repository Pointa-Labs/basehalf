/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { BaseHalfTransfer, IBaseHalfTransferItem, baseHalfTransferFileNames } from '../common/basehalfClipboard.js';

/** A picture or text of a transfer: what has no file until it lands. */
export type BaseHalfTransferContent = Extract<BaseHalfTransfer, { readonly kind: 'picture' | 'text' }>;

/** One thing a transfer hands over: one of its items, its picture, or its text. */
export type BaseHalfTransferPart = { readonly kind: 'item'; readonly item: IBaseHalfTransferItem } | BaseHalfTransferContent;

/** The things a transfer hands over, one by one, in its order. */
export function baseHalfTransferParts(transfer: BaseHalfTransfer): readonly BaseHalfTransferPart[] {
	return transfer.kind === 'items' ? transfer.items.map(item => ({ kind: 'item', item })) : [transfer];
}

/** Writes a picture as it is, or text as a note, into a new file at `target`; never over a file. */
export async function baseHalfCreateTransferFile(fileService: IFileService, target: URI, content: BaseHalfTransferContent): Promise<void> {
	const data = content.kind === 'picture' ? content.data : VSBuffer.fromString(content.text.replace(/\r\n?/g, '\n'));
	await fileService.createFile(target, data, { overwrite: false });
}

/**
 * Makes a picture or text a new file in `folder` (copy, paste, and drop,
 * "What is not a file becomes one"): a picture as it is, text as a note. It
 * takes the first name that no file has and that `taken` does not hold, as
 * the name of a draft is, and never writes over a file. Returns the file.
 */
export async function baseHalfWriteTransferFile(
	fileService: IFileService,
	folder: URI,
	content: BaseHalfTransferContent,
	taken: (resource: URI) => Promise<boolean>
): Promise<URI> {
	const names = content.kind === 'picture' ? baseHalfTransferFileNames(content.extension, content.name) : baseHalfTransferFileNames('md');
	for (const name of names) {
		const target = joinPath(folder, name);
		if (await fileService.exists(target) || await taken(target)) {
			continue;
		}
		await baseHalfCreateTransferFile(fileService, target, content);
		return target;
	}
	throw new Error(content.kind === 'picture'
		? localize('basehalf.transfer.pictureNamesTaken', "Too many untitled pictures. Rename one before pasting another.")
		: localize('basehalf.transfer.noteNamesTaken', "Too many untitled notes. Rename one before pasting another."));
}
