/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from './basehalfMirrorTree.js';

/**
 * Card places change far more often than anything else BaseHalf stores, and
 * each person arranges their own canvas. So layouts stay in the folder and out
 * of git (canvas card placement, "Places stay out of git").
 *
 * - `/.gitignore` hides this file itself, so that writing it shows nothing.
 * - `canvas.yaml` hides every layout. `!canvas.yaml/` keeps the mirror
 *   directory of a user's own file of that name, with its description.
 * - `/cache/` hides BaseHalf's working files.
 */
export const BASEHALF_MIRROR_IGNORE_CONTENT = [
	'# Written by BaseHalf. Card positions and BaseHalf\'s working files are',
	'# not shared through git.',
	'/.gitignore',
	'canvas.yaml',
	'!canvas.yaml/',
	'/cache/',
	''
].join('\n');

const IGNORE_FILE_READ_LIMIT = 64 * 1024;

export function baseHalfMirrorIgnoreResource(workspaceFolder: URI): URI {
	return URI.joinPath(workspaceFolder, '.bh', '.gitignore');
}

/**
 * Writes the ignore file when it is not there. It is called before a layout
 * or anything under `.bh/cache/` is written. One that is there is left as it
 * is, whatever it holds. A failure rejects, and the caller then writes nothing
 * that git would show.
 */
export async function baseHalfEnsureMirrorIgnoreFile(fileService: IFileService, workspaceFolder: URI): Promise<void> {
	const resource = baseHalfMirrorIgnoreResource(workspaceFolder);
	await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	if (await isThere(fileService, resource)) {
		return;
	}
	await fileService.createFolder(dirname(resource));
	await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	try {
		await baseHalfCommitMirrorFile(fileService, resource, VSBuffer.fromString(BASEHALF_MIRROR_IGNORE_CONTENT), null);
	} catch (error) {
		// Another window, or another write of this one, was first.
		if (await isThere(fileService, resource)) {
			return;
		}
		throw error;
	}
}

async function isThere(fileService: IFileService, resource: URI): Promise<boolean> {
	try {
		await fileService.readFile(resource, { limits: { size: IGNORE_FILE_READ_LIMIT } });
		return true;
	} catch (error) {
		if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
			return false;
		}
		// Whatever is there, also something larger than BaseHalf would write, is left as it is.
		if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_TOO_LARGE) {
			return true;
		}
		throw error;
	}
}
