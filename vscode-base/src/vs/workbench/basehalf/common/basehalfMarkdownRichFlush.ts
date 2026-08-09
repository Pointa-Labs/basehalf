/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { baseHalfEditorProjectionCanFlush, IBaseHalfEditorFlushOptions } from './basehalfEditorFlush.js';

/**
 * A first-frame rich surface is inert, so a clean projection cannot contain an
 * unobserved user edit. Complete that flush without posting into a webview that
 * has not installed its message handler yet. A dirty cold state is unexpected
 * and fails closed instead of claiming that its content was saved.
 */
export function baseHalfMarkdownRichColdFlushResult(editorReady: boolean, dirty: boolean): boolean | undefined {
	if (editorReady) {
		return undefined;
	}
	return !dirty;
}

/** Host dirty messages cross a webview boundary and may lag the editor. A
 * structural flush therefore always asks the webview/YJS owner to serialize,
 * even when the host's last observed dirty bit is false. */
export function baseHalfMarkdownRichNeedsSaveRequest(dirty: boolean, visible: boolean, options: IBaseHalfEditorFlushOptions): boolean {
	const forced = options.forceSerialize === true || options.forceWrite === true;
	// Retained projections share one TextModel. When Source or Preview is the
	// active owner, the hidden rich/YJS projection can lag that model; forcing
	// it to serialize would either overwrite the active edit or invent a false
	// conflict. The active projection's flusher owns structural preflight.
	if (!baseHalfEditorProjectionCanFlush('rich', visible, options)) {
		return false;
	}
	return dirty || forced;
}
