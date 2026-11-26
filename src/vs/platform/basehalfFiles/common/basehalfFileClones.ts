/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const BASEHALF_FILE_CLONES_CHANNEL = 'basehalfFileClones';

export const IBaseHalfFileClonesService = createDecorator<IBaseHalfFileClonesService>('baseHalfFileClonesService');

/** A range of a file on disk. */
export interface IBaseHalfFileRange {
	readonly source: URI;
	readonly offset: number;
	readonly length: number;
}

/**
 * A part of a file that `assemble` writes: bytes, or a range of a file on
 * disk. A list of parts crosses to the shared process with each buffer as it
 * is, which a buffer inside an object would not.
 */
export type BaseHalfFilePart = VSBuffer | IBaseHalfFileRange;

/**
 * Clones files on disk, which a window cannot do itself: the service runs in
 * the shared process (editing media, "Copies, deletes, and the Trash").
 */
export interface IBaseHalfFileClonesService {
	readonly _serviceBrand: undefined;
	/**
	 * Copies a file to a path that holds nothing: by a clone on a disk that can
	 * make one, as macOS's can, which takes no room until one of the two
	 * changes, and byte for byte on other disks. The parent folder must exist.
	 */
	clone(source: URI, target: URI): Promise<void>;
	/**
	 * Writes parts into a file, one after the other: bytes as they are, and
	 * ranges of files on disk copied here, so that their bytes never pass
	 * through a window (editing media, "While it is saved, and after"). Without
	 * `append` the file is new, at a path that holds nothing; with it, the parts
	 * go after what the file holds. A range that runs past its file's end is
	 * refused. The parent folder must exist.
	 */
	assemble(target: URI, parts: readonly BaseHalfFilePart[], append?: boolean): Promise<void>;
}
