/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { streamToBuffer, VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';

/**
 * A part of a file's saved content, read from the disk alone. The file
 * service's `readFile` with a position reads the whole file and then cuts the
 * part out of it, so that each part of a book or a PDF of hundreds of
 * megabytes would pass through the window whole; a stream reads only the part.
 */
export async function readBaseHalfFileRange(fileService: IFileService, resource: URI, position: number, length: number): Promise<VSBuffer> {
	return streamToBuffer((await fileService.readFileStream(resource, { position, length })).value);
}
