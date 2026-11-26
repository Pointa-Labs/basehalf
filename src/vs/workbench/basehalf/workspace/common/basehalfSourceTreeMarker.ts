/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';

/**
 * A tracked repository-level opt-out for folders that may be opened by a
 * BaseHalf development host but must not be treated as product workspaces.
 * Presence alone disables every BaseHalf write, including legacy cleanup; the
 * file's contents are intentionally ignored.
 */
export const BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER = '.basehalf-no-workspace-setup';

/**
 * Whether a workspace folder opts out of every BaseHalf write with
 * {@link BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER}. When the provider cannot
 * say whether the marker exists, this fails closed and reports it as marked.
 */
export async function baseHalfIsWorkspaceFolderMarked(fileService: IFileService, workspaceFolder: URI): Promise<boolean> {
	try {
		await fileService.stat(URI.joinPath(workspaceFolder, BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER));
		return true;
	} catch (error) {
		return !(error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND);
	}
}
