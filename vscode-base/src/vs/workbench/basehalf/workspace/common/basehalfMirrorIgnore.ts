/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from './basehalfMirrorTree.js';

/**
 * Card places change far more often than anything else BaseHalf stores, and
 * each person arranges their own canvas. So layouts stay in the folder and out
 * of git (canvas card placement, "Places stay out of git"). Every rule is
 * anchored at `.bh/`, so that a note's file in the store, whatever its name,
 * is tracked (files in notes, rule 45).
 *
 * - `/.gitignore` hides this file itself, so that writing it shows nothing.
 * - The two `canvas.yaml` rules hide every layout in the mirror, and keep the
 *   mirror directory of a user's own file of that name, with its description.
 * - `/cache/` hides BaseHalf's working files.
 * - The two `*.basehalf-tmp` rules hide the file a mirror write goes through
 *   before it takes its name. It is there for a moment, or longer after a
 *   crash.
 */
export const BASEHALF_MIRROR_IGNORE_CONTENT = [
	'# Written by BaseHalf. Card positions and BaseHalf\'s working files are',
	'# not shared through git.',
	'/.gitignore',
	'/mirror/**/canvas.yaml',
	'!/mirror/**/canvas.yaml/',
	'/cache/',
	'/*.basehalf-tmp',
	'/mirror/**/*.basehalf-tmp',
	''
].join('\n');

const IGNORE_FILE_READ_LIMIT = 64 * 1024;

export function baseHalfMirrorIgnoreResource(workspaceFolder: URI): URI {
	return URI.joinPath(workspaceFolder, '.bh', '.gitignore');
}

/**
 * Writes the ignore file when it is not there or holds anything else. It is
 * called before a layout, a file of a note, or anything under `.bh/cache/`
 * is written. A failure rejects, and the caller then writes nothing that git
 * would show.
 */
export async function baseHalfEnsureMirrorIgnoreFile(fileService: IFileService, workspaceFolder: URI): Promise<void> {
	const resource = baseHalfMirrorIgnoreResource(workspaceFolder);
	await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	const current = await readIgnoreFile(fileService, resource);
	if (current !== undefined && current !== TOO_LARGE && current.toString() === BASEHALF_MIRROR_IGNORE_CONTENT) {
		return;
	}
	await fileService.createFolder(dirname(resource));
	await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	const content = VSBuffer.fromString(BASEHALF_MIRROR_IGNORE_CONTENT);
	try {
		if (current === TOO_LARGE) {
			await fileService.writeFile(resource, content, { atomic: { postfix: '.basehalf-tmp' } });
		} else {
			await baseHalfCommitMirrorFile(fileService, resource, content, current ?? null);
		}
	} catch (error) {
		// Another window, or another write of this one, was first.
		const after = await readIgnoreFile(fileService, resource).catch(() => undefined);
		if (after !== undefined && after !== TOO_LARGE && after.toString() === BASEHALF_MIRROR_IGNORE_CONTENT) {
			return;
		}
		throw error;
	}
}

const TOO_LARGE = Symbol('tooLarge');

/** The ignore file's bytes; nothing when it is not there. */
async function readIgnoreFile(fileService: IFileService, resource: URI): Promise<VSBuffer | typeof TOO_LARGE | undefined> {
	try {
		return (await fileService.readFile(resource, { limits: { size: IGNORE_FILE_READ_LIMIT } })).value;
	} catch (error) {
		if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
			return undefined;
		}
		if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_TOO_LARGE) {
			return TOO_LARGE;
		}
		throw error;
	}
}
