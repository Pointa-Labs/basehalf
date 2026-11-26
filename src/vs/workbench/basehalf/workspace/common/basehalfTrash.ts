/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';

/**
 * Whether what BaseHalf deletes at `resource` goes to the system's Trash, from
 * which the user can take it back, and is not deleted for good: the Trash is
 * not turned off, and the file system of `resource` has one. Only the value
 * `false` of `files.enableTrash` turns it off: a setting that is not set
 * means the Trash, as its default does (exact undo, "When the kept versions
 * go to the Trash"). Everything of BaseHalf's that deletes asks here.
 */
export function baseHalfUsesTrash(configurationService: IConfigurationService, fileService: IFileService, resource: URI): boolean {
	return configurationService.getValue<boolean>('files.enableTrash') !== false
		&& fileService.hasCapability(resource, FileSystemProviderCapabilities.Trash);
}
