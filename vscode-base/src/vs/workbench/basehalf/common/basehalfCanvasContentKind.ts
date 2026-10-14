/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { extname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import type { BaseHalfNodeKind } from './basehalfNodeDocument.js';

/** The content family of a canvas item, by what it is on disk. */
export const BASEHALF_CANVAS_CONTENT_KINDS = [
	'text',
	'code',
	'file',
	'folder',
	'image',
	'video',
	'audio',
	'pdf',
	'presentation'
] as const;

export type BaseHalfCanvasContentKind = typeof BASEHALF_CANVAS_CONTENT_KINDS[number];

export function baseHalfCanvasContentKindForPath(path: string, directory: boolean): BaseHalfCanvasContentKind {
	if (directory) {
		return 'folder';
	}
	const extension = extname(URI.file(path)).toLowerCase();
	if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'].includes(extension)) {
		return 'image';
	}
	if (['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'].includes(extension)) {
		return 'video';
	}
	if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(extension)) {
		return 'audio';
	}
	if (extension === '.pdf') {
		return 'pdf';
	}
	if (['.ppt', '.pptx', '.key'].includes(extension)) {
		return 'presentation';
	}
	if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.css', '.html', '.sh'].includes(extension)) {
		return 'code';
	}
	if (['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv'].includes(extension)) {
		return 'text';
	}
	return 'file';
}

/** Whether a file of `contentKind` can be the file a node of `nodeKind` shows. A File node takes any file. */
export function baseHalfNodeAcceptsContentKind(nodeKind: BaseHalfNodeKind, contentKind: BaseHalfCanvasContentKind): boolean {
	return nodeKind === 'file' ? contentKind !== 'folder' : nodeKind === contentKind;
}
