/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IExpression } from '../../../../base/common/glob.js';

/** The setting that shows `.bh` in Files, and only there (workspace state, D116). */
export const BASEHALF_FILES_SHOW_HIDDEN_FOLDER_SETTING = 'basehalf.files.showHiddenFolder';

const BH_FOLDER_EXCLUDE = '**/.bh';

/** What Files leaves out of `files.exclude`: everything else that reads it goes on leaving `.bh` out. */
export function baseHalfFilesExclude(exclude: IExpression, showBhFolder: boolean): IExpression {
	if (!showBhFolder || !Object.hasOwn(exclude, BH_FOLDER_EXCLUDE)) {
		return exclude;
	}
	const { [BH_FOLDER_EXCLUDE]: _bhFolder, ...others } = exclude;
	return others;
}

/** Whether a path of the workspace is `.bh` or under it, at any depth. */
export function baseHalfIsUnderBhFolder(relativePath: string): boolean {
	return relativePath.split('/').includes('.bh');
}
