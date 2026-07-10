/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';

const BASEHALF_MIRROR_TEMP_POSTFIX = '.basehalf-tmp';

/**
 * Commits one mirror serialization against the exact bytes that produced the
 * patch. `null` means the file was absent and therefore requires the provider's
 * exclusive-create operation.
 *
 * This closes the FileService validate/write TOCTOU and catches same-length
 * external rewrites before the final commit. It is intentionally not described
 * as cross-process CAS: no portable filesystem primitive can make an arbitrary
 * external writer participate in the final check-to-rename boundary.
 */
export async function baseHalfCommitMirrorFile(
	fileService: IFileService,
	resource: URI,
	contents: VSBuffer,
	expectedContents: VSBuffer | null
): Promise<void> {
	await fileService.writeFileWithExpectedContents(resource, contents, expectedContents, {
		atomic: { postfix: BASEHALF_MIRROR_TEMP_POSTFIX }
	});
}
