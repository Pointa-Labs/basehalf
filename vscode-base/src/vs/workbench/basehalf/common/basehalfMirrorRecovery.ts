/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { hashAsync } from '../../../base/common/hash.js';
import { dirname, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorRoot } from './basehalfMirrorTree.js';

const RECOVERY_DIGEST_LENGTH = 12;

/** A write the user asked for replaced the bytes of an annotation file that could not be read. */
export interface IBaseHalfMirrorPreservedEvent {
	readonly workspaceFolder: URI;
	/** The node the file annotates. */
	readonly relativePath: string;
	/** Why the replaced bytes could not be read. */
	readonly reason: string;
	/** The replaced bytes, under `.bh/cache/recovered/`. */
	readonly recoveryCopy: URI;
}

/**
 * Where the recovery copy of a mirror file's bytes lives:
 * `.bh/cache/recovered/mirror/<node path>/<name>.<digest>.<extension>`. The
 * digest is the start of the SHA-1 of the bytes, so the same bytes always map
 * to the same copy (mirror file resilience, "Writing over content that could
 * not be read").
 */
export async function baseHalfMirrorRecoveryResource(workspaceFolder: URI, mirrorResource: URI, contents: VSBuffer): Promise<URI> {
	const relative = getRelativePath(baseHalfMirrorRoot(workspaceFolder), mirrorResource);
	if (relative === undefined || relative === '' || relative === '..' || relative.startsWith('../')) {
		throw new Error(`Resource is not a file in the BaseHalf mirror tree: ${mirrorResource.toString()}`);
	}
	const segments = baseHalfMirrorPathSegments(relative);
	const fileName = segments.pop()!;
	const dot = fileName.lastIndexOf('.');
	const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
	const extension = dot > 0 ? fileName.slice(dot) : '';
	const digest = (await hashAsync(contents)).slice(0, RECOVERY_DIGEST_LENGTH);
	return URI.joinPath(workspaceFolder, '.bh', 'cache', 'recovered', 'mirror', ...segments, `${stem}.${digest}${extension}`);
}

/**
 * Saves the exact bytes of a mirror file BaseHalf could not fully read, before
 * a write replaces them, and returns the copy. Saving the same bytes again is
 * a no-op. A failure rejects, and the caller must then leave the mirror file
 * unchanged.
 */
export async function baseHalfPreserveMirrorBytes(fileService: IFileService, workspaceFolder: URI, mirrorResource: URI, contents: VSBuffer): Promise<URI> {
	const target = await baseHalfMirrorRecoveryResource(workspaceFolder, mirrorResource, contents);
	await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, workspaceFolder, target);
	await fileService.createFolder(dirname(target));
	await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, workspaceFolder, target);
	try {
		await baseHalfCommitMirrorFile(fileService, target, contents, null);
	} catch (error) {
		// The name carries the digest of the bytes, so an existing copy with
		// these bytes is this copy.
		let existing: VSBuffer | undefined;
		try {
			existing = (await fileService.readFile(target)).value;
		} catch {
			// The create failure below is the cause.
		}
		if (!existing?.equals(contents)) {
			throw error;
		}
	}
	await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, workspaceFolder, target);
	return target;
}
