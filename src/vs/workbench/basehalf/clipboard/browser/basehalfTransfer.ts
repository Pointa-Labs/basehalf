/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { CodeDataTransfers, getPathForFile } from '../../../../platform/dnd/browser/dnd.js';
import { BaseHalfTransfer } from '../common/basehalfClipboard.js';

/** The extensions of the pictures a drop takes as data, by their type. */
const PICTURE_EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/heic': 'heic',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/tiff': 'tiff'
};

/**
 * Whether a drag may hold a transfer: items from Files, files or a picture
 * from another app, or text. The window gives the types of a drag in lower
 * case while it is dragged.
 */
export function baseHalfDragHoldsTransfer(dataTransfer: DataTransfer | null): boolean {
	if (!dataTransfer) {
		return false;
	}
	const types = [...dataTransfer.types].map(type => type.toLowerCase());
	return types.includes(CodeDataTransfers.FILES.toLowerCase()) || types.includes('files') || types.includes('text/plain');
}

/** Whether a drag holds items that Files drags, which move within their workspace folder as in Files. */
export function baseHalfDragHoldsFilesItems(dataTransfer: DataTransfer | null): boolean {
	return !!dataTransfer && [...dataTransfer.types].some(type => type.toLowerCase() === CodeDataTransfers.FILES.toLowerCase());
}

/**
 * Reads what was dropped as one transfer (copy, paste, and drop, "Drop"): the
 * first that is there of items dragged from Files, files with a path dragged
 * from another app, a picture with no file, and text. It reads the drop's data
 * before it waits for anything, while the data can still be read.
 */
export async function baseHalfTransferFromDrop(dataTransfer: DataTransfer): Promise<BaseHalfTransfer | undefined> {
	let filesPaths: unknown[] = [];
	try {
		const parsed: unknown = JSON.parse(dataTransfer.getData(CodeDataTransfers.FILES) || '[]');
		filesPaths = Array.isArray(parsed) ? parsed : [];
	} catch {
		filesPaths = [];
	}
	const fromFiles = filesPaths.filter((path): path is string => typeof path === 'string' && path.length > 0);
	// Files moves what it drags within its workspace folder, as in Files.
	if (fromFiles.length > 0) {
		return { kind: 'items', items: fromFiles.map(path => ({ resource: URI.file(path) })), cut: true };
	}
	const files = [...dataTransfer.files];
	const paths = files.map(file => getPathForFile(file)).filter((path): path is string => !!path);
	if (paths.length > 0) {
		return { kind: 'items', items: paths.map(path => ({ resource: URI.file(path) })), cut: false };
	}
	const picture = files.find(file => PICTURE_EXTENSIONS[file.type] !== undefined);
	const text = dataTransfer.getData('text/plain');
	if (picture) {
		const data = VSBuffer.wrap(new Uint8Array(await picture.arrayBuffer()));
		return { kind: 'picture', data, extension: PICTURE_EXTENSIONS[picture.type], ...(picture.name && picture.name !== 'image.png' ? { name: picture.name } : {}) };
	}
	return text.length > 0 ? { kind: 'text', text } : undefined;
}
