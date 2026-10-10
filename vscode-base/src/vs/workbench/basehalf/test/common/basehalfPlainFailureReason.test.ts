/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createFileSystemProviderError, FileOperationError, FileOperationResult, FileSystemProviderErrorCode } from '../../../../platform/files/common/files.js';
import { BaseHalfMirrorSymbolicLinkError } from '../../common/basehalfMirrorTree.js';
import { BaseHalfMirrorWriteRejected } from '../../common/basehalfMirrorYaml.js';
import { baseHalfIsStorageFailure, baseHalfPlainFailureReason } from '../../common/basehalfPlainFailureReason.js';

suite('BaseHalfPlainFailureReason', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('states a storage failure in plain words, without the path or the error code', () => {
		const hidden = URI.file('/work/.bh/mirror/notes/canvas.yaml');
		const failures: Error[] = [
			new FileOperationError(`Unable to write file '${hidden.fsPath}' (NoPermissions (FileSystemError): Error: EACCES: permission denied, open '${hidden.fsPath}')`, FileOperationResult.FILE_PERMISSION_DENIED),
			createFileSystemProviderError(`EACCES: permission denied, open '${hidden.fsPath}'`, FileSystemProviderErrorCode.NoPermissions),
			new FileOperationError(`Unable to write file '${hidden.fsPath}' (Unknown (FileSystemError): Error: ENOSPC: no space left on device, write)`, FileOperationResult.FILE_OTHER_ERROR),
			new FileOperationError(`Unable to write file '${hidden.fsPath}' (Unknown (FileSystemError): Error: EROFS: read-only file system, open '${hidden.fsPath}')`, FileOperationResult.FILE_OTHER_ERROR),
			new FileOperationError(`Unable to read file '${hidden.fsPath}' (Error: File is too large)`, FileOperationResult.FILE_TOO_LARGE),
			new FileOperationError(`Unable to read file '${hidden.fsPath}' (Error: is a directory)`, FileOperationResult.FILE_IS_DIRECTORY),
			new BaseHalfMirrorSymbolicLinkError(hidden, URI.file('/work/.bh')),
			new BaseHalfMirrorWriteRejected(hidden, 'the layout changed when it was read back')
		];
		const reasons = failures.map(baseHalfPlainFailureReason);
		assert.deepStrictEqual({
			reasons,
			storage: failures.every(baseHalfIsStorageFailure),
			leaks: reasons.filter(reason => /\.bh|yaml|\/work|E[A-Z]{3,}|Error/.test(reason)),
			// A rule BaseHalf states in its own words keeps its own text.
			ownRule: baseHalfIsStorageFailure(new Error('This item is being moved.'))
		}, {
			reasons: [
				'BaseHalf isn\'t allowed to read or change files in this folder.',
				'BaseHalf isn\'t allowed to read or change files in this folder.',
				'The disk is full.',
				'The disk can\'t be written to.',
				'A file is too large for BaseHalf to read.',
				'The disk reported a problem.',
				'BaseHalf\'s own folder is behind a symbolic link, and BaseHalf doesn\'t change files through links.',
				'BaseHalf could not save this safely, so it changed nothing.'
			],
			storage: true,
			leaks: [],
			ownRule: false
		});
	});
});
