/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// This module is also compiled into the rich editor's webview, whose type
// check follows every import. Its one import, the list of media files,
// imports nothing.
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../../platform/protocol/common/basehalfMediaFiles.js';

/** What a note shows for an address: a picture, a video, or a sound. */
export type BaseHalfNoteMediaKind = 'image' | 'video' | 'audio';

const kindByExtension: ReadonlyMap<string, BaseHalfNoteMediaKind> = new Map<string, BaseHalfNoteMediaKind>([
	...BASEHALF_MEDIA_FILE_EXTENSIONS.image.map(extension => [extension, 'image'] as const),
	...BASEHALF_MEDIA_FILE_EXTENSIONS.video.map(extension => [extension, 'video'] as const),
	...BASEHALF_MEDIA_FILE_EXTENSIONS.audio.map(extension => [extension, 'audio'] as const)
]);

/**
 * The kind of media an address points to, by the extension of its file in
 * the one list of media files, so that a note shows a file as a card and
 * Card Detail do (note formats, rule 26); `undefined` for any other address.
 * `?` and `#` end the path, which is percent-decoded once (kept as written
 * when it holds a bad escape) and read without regard to case, as a link's
 * address is read (rule 55).
 */
export function baseHalfNoteMediaKind(url: string): BaseHalfNoteMediaKind | undefined {
	const end = url.search(/[?#]/);
	let path = end === -1 ? url : url.slice(0, end);
	try {
		path = decodeURIComponent(path);
	} catch {
		// A malformed escape leaves the path as written.
	}
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	// A name that only starts with a dot, such as `.mp4`, has no extension.
	const dot = name.lastIndexOf('.');
	return dot > 0 ? kindByExtension.get(name.slice(dot)) : undefined;
}
