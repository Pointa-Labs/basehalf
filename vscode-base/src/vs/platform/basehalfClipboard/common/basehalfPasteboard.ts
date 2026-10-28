/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const BASEHALF_PASTEBOARD_CHANNEL = 'basehalfPasteboard';

/** The type under which BaseHalf's record of copied items is on the clipboard (copy, paste, and drop). */
export const BASEHALF_CLIPBOARD_RECORD_TYPE = 'com.pointalabs.basehalf.items';

export const IBaseHalfPasteboardService = createDecorator<IBaseHalfPasteboardService>('baseHalfPasteboardService');

/** What one copy of items puts on the system clipboard, all in one write. */
export interface IBaseHalfPasteboardContents {
	/** The paths on disk of the files and folders, as a file manager puts files it copies. */
	readonly files: readonly string[];
	/** Text: the paths of the items, one per line. */
	readonly text: string;
	/** BaseHalf's record, under {@link BASEHALF_CLIPBOARD_RECORD_TYPE}. */
	readonly record: string;
}

/**
 * Writes the system clipboard in several forms at once, which a window cannot
 * do: its clipboard call replaces what is there with each form it writes. The
 * service runs in the shared process (copy, paste, and drop, "Copy and Cut").
 */
export interface IBaseHalfPasteboardService {
	readonly _serviceBrand: undefined;
	/**
	 * Replaces what the clipboard holds with `contents`, in one write.
	 * Resolves with false where the system has no such write, which is every
	 * system without AppKit; nothing is written then.
	 */
	write(contents: IBaseHalfPasteboardContents): Promise<boolean>;
}
