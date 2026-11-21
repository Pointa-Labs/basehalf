/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';

/** An excerpt shows the first lines of a file, so only its head is read, whatever its size. */
export const BASEHALF_CARD_EXCERPT_READ_BYTES = 8192;

/** The text a card read of its file. */
export interface IBaseHalfCardText {
	readonly text: string;
	/** Whether what was read is the whole file. */
	readonly wholeFile: boolean;
}

/**
 * Reads what a card shows of a text file, as Card Detail reads the file (note rendering,
 * rule 32a): in the encoding the settings give for it, or the one the window holds for its
 * text. A note is read whole, up to `noteLimit` bytes, and any other file by its head.
 * `undefined` for a file that is not text.
 */
export async function baseHalfReadCardText(textFileService: Pick<ITextFileService, 'read' | 'files'>, resource: URI, noteLimit: number | undefined): Promise<IBaseHalfCardText | undefined> {
	// An encoding chosen for the file in the status bar holds while the window holds its text.
	const encoding = textFileService.files.get(resource)?.getEncoding();
	try {
		const content = await textFileService.read(resource, {
			...(noteLimit !== undefined ? { limits: { size: noteLimit } } : { length: BASEHALF_CARD_EXCERPT_READ_BYTES }),
			acceptTextOnly: true,
			...(encoding ? { encoding } : {})
		});
		if (content.value.includes('\u0000')) {
			return undefined;
		}
		return { text: content.value, wholeFile: noteLimit !== undefined || content.size < BASEHALF_CARD_EXCERPT_READ_BYTES };
	} catch (error) {
		if (error instanceof TextFileOperationError && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			return undefined;
		}
		throw error;
	}
}
