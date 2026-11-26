/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfCanvasNavigationService } from '../../navigation/common/basehalfCanvasNavigation.js';
import { shouldFallbackToVSCodeEditorAfterBaseHalfRouting } from '../../navigation/common/basehalfOpenRouting.js';
import { baseHalfIsUnderBhFolder } from '../../workspace/common/basehalfBhFolder.js';
import { BASEHALF_CHANGES_PROJECTION_ID, IBaseHalfFileChangesService } from './basehalfFileChanges.js';

export interface IBaseHalfSourceControlRow {
	readonly resource: URI;
	readonly groupId: string;
	readonly preserveFocus?: boolean;
	readonly pinned?: boolean;
	readonly sideBySide?: boolean;
}

/**
 * Opens the file of a row of Source Control where BaseHalf opens a file: Card
 * Detail, at the Changes view when the file has one (the changes of a file, rules
 * 19 to 21). False leaves the row to VS Code: a deleted file, which has nothing to
 * open, a file under `.bh`, a conflict, a file outside the workspace folders, and a
 * row opened to the side. Card Detail of that file gives way first, or it would close
 * what VS Code opens as its duplicate.
 */
export async function tryOpenBaseHalfSourceControlRow(
	row: IBaseHalfSourceControlRow,
	navigation: IBaseHalfCanvasNavigationService,
	changes: IBaseHalfFileChangesService
): Promise<boolean> {
	if (row.sideBySide || row.resource.scheme !== Schemas.file || row.groupId === 'merge' || baseHalfIsUnderBhFolder(row.resource.path)) {
		const open = navigation.state.cardDetail;
		if (open && isEqual(open.resource, row.resource)) {
			await navigation.closeCardDetail();
		}
		return false;
	}
	const options = { source: 'api', preserveFocus: row.preserveFocus, pinned: row.pinned } as const;
	const result = changes.hasChangesView(row.resource) && changes.changeOf(row.resource, row.groupId)?.groupId === row.groupId
		? await navigation.openCardDetail(row.resource, { ...options, projection: BASEHALF_CHANGES_PROJECTION_ID, changesGroup: row.groupId })
		: await navigation.openResource(row.resource, options);
	return result.handled || !shouldFallbackToVSCodeEditorAfterBaseHalfRouting(result);
}
