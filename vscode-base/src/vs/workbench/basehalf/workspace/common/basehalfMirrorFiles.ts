/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { BASEHALF_GENERATION_INFO_FILE, BASEHALF_GENERATION_MADE_FILE, parseBaseHalfGenerationInfo, parseBaseHalfGenerationMade } from '../../video/common/basehalfGenerationInfo.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfPreserveMirrorBytes } from './basehalfMirrorRecovery.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink } from './basehalfMirrorTree.js';

/**
 * Reading, writing, and removing one per-node mirror file the way the mirror
 * cascade, relocation, and draft operations move card information: never
 * through a symbolic link, and against the bytes that were read, so that a
 * move that stopped in the middle can be run again without loss.
 */

/** Largest per-node mirror file a move reads (`badge.yaml` is capped at 128 KiB, `generation.yaml` and `made.yaml` at 256 KiB). */
export const BASEHALF_MIRROR_FILE_MAX_BYTES = 1024 * 1024;

/** Reads a mirror file, or `null` when it does not exist. */
export async function baseHalfReadMirrorFile(fileService: IFileService, workspaceFolder: URI, resource: URI): Promise<VSBuffer | null> {
	await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	try {
		return (await fileService.readFile(resource, { atomic: true, limits: { size: BASEHALF_MIRROR_FILE_MAX_BYTES } })).value;
	} catch (error) {
		if (isFileNotFound(error)) {
			return null;
		}
		throw error;
	}
}

/**
 * Writes a mirror file against the bytes it has now (`null` when it has
 * none), creating its directory first. A file that changed in between is not
 * written over: the write fails.
 */
export async function baseHalfWriteMirrorFile(fileService: IFileService, workspaceFolder: URI, resource: URI, contents: VSBuffer, current: VSBuffer | null): Promise<void> {
	await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	await fileService.createFolder(dirname(resource));
	await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	await baseHalfCommitMirrorFile(fileService, resource, contents, current);
	await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
}

/** Deletes one mirror file, never a directory; with `expected`, only while it still has those bytes. */
export async function baseHalfDeleteMirrorFile(fileService: IFileService, workspaceFolder: URI, resource: URI, expected?: VSBuffer): Promise<void> {
	if (expected) {
		const current = await baseHalfReadMirrorFile(fileService, workspaceFolder, resource);
		if (current === null) {
			return;
		}
		if (!current.equals(expected)) {
			throw new FileOperationError(`${resource.toString()} changed before it could be moved`, FileOperationResult.FILE_MODIFIED_SINCE);
		}
	}
	await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
	try {
		await fileService.del(resource, { recursive: false, useTrash: false, atomic: false });
	} catch (error) {
		if (!isFileNotFound(error)) {
			throw error;
		}
	}
}

/**
 * Whether a mirror file is generation information that BaseHalf cannot read:
 * a `generation.yaml` that is not YAML at all, or a `made.yaml` that is not a
 * whole record (mirror file resilience, "Structural operations").
 */
export function baseHalfIsUnreadableGenerationFile(fileName: string, contents: VSBuffer): boolean {
	if (fileName === BASEHALF_GENERATION_INFO_FILE) {
		return !parseBaseHalfGenerationInfo(contents.toString()).readable;
	}
	if (fileName === BASEHALF_GENERATION_MADE_FILE) {
		return parseBaseHalfGenerationMade(contents.toString()) === undefined;
	}
	return false;
}

/**
 * Keeps a recovery copy of a `generation.yaml` or `made.yaml` that BaseHalf
 * cannot read, before it is removed or replaced, so that content BaseHalf
 * cannot read is never destroyed. Resolves with the copy, or `undefined` when
 * the file is not one of these or can be read. A copy that cannot be saved
 * rejects, and the caller then leaves the file as it is.
 */
export async function baseHalfPreserveUnreadableGenerationFile(fileService: IFileService, workspaceFolder: URI, resource: URI, contents: VSBuffer): Promise<URI | undefined> {
	return baseHalfIsUnreadableGenerationFile(basename(resource), contents) ? baseHalfPreserveMirrorBytes(fileService, workspaceFolder, resource, contents) : undefined;
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
}
