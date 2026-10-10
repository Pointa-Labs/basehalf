/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { FileOperationError, FileOperationResult, FileSystemProviderError, toFileOperationResult } from '../../../platform/files/common/files.js';
import { BaseHalfMirrorSymbolicLinkError } from './basehalfMirrorTree.js';
import { BaseHalfMirrorWriteRejected } from './basehalfMirrorYaml.js';

/**
 * Whether an error comes from storage (the file system, or a mirror write
 * BaseHalf refused after reading it back) rather than from a rule BaseHalf
 * states in its own words. The text of a storage error is not for the user.
 */
export function baseHalfIsStorageFailure(error: unknown): boolean {
	return error instanceof FileOperationError
		|| error instanceof FileSystemProviderError
		|| error instanceof BaseHalfMirrorSymbolicLinkError
		|| error instanceof BaseHalfMirrorWriteRejected
		|| (error instanceof Error && /^E[A-Z0-9_]+$/.test(String((error as Error & { readonly code?: unknown }).code ?? '')));
}

/**
 * Why a file operation failed, in words for someone who does not read code
 * (D41). An error's own text names system error codes and files under
 * `.bh/`, so it belongs in the log and never in a message.
 */
export function baseHalfPlainFailureReason(error: unknown): string {
	if (error instanceof BaseHalfMirrorWriteRejected) {
		return localize('basehalf.failure.writeRejected', "BaseHalf could not save this safely, so it changed nothing.");
	}
	if (error instanceof BaseHalfMirrorSymbolicLinkError) {
		return localize('basehalf.failure.symbolicLink', "BaseHalf's own folder is behind a symbolic link, and BaseHalf doesn't change files through links.");
	}
	const text = error instanceof Error ? error.message : String(error);
	if (/\bENOSPC\b/.test(text)) {
		return localize('basehalf.failure.diskFull', "The disk is full.");
	}
	if (/\bEROFS\b/.test(text)) {
		return localize('basehalf.failure.readOnlyDisk', "The disk can't be written to.");
	}
	switch (error instanceof Error ? toFileOperationResult(error) : FileOperationResult.FILE_OTHER_ERROR) {
		case FileOperationResult.FILE_PERMISSION_DENIED:
			return localize('basehalf.failure.permission', "BaseHalf isn't allowed to read or change files in this folder.");
		case FileOperationResult.FILE_WRITE_LOCKED:
			return localize('basehalf.failure.locked', "Another program is using a file BaseHalf needs.");
		case FileOperationResult.FILE_TOO_LARGE:
			return localize('basehalf.failure.tooLarge', "A file is too large for BaseHalf to read.");
		default:
			return localize('basehalf.failure.other', "The disk reported a problem.");
	}
}

/**
 * The text of an error for a message: a storage failure in plain words, and
 * any other error (a rule BaseHalf states itself) in its own words.
 */
export function baseHalfUserFacingErrorMessage(error: unknown): string {
	return baseHalfIsStorageFailure(error) ? baseHalfPlainFailureReason(error) : error instanceof Error ? error.message : String(error);
}
