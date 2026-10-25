/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfMirrorPathSegments, baseHalfMirrorRoot, baseHalfWalkMirror } from '../../workspace/common/basehalfMirrorTree.js';
import { BASEHALF_EDIT_RECORD_FILE, parseBaseHalfEditRecord } from '../common/basehalfEditRecord.js';

export interface IBaseHalfMediaEditCopyServices {
	readonly fileService: IFileService;
	readonly fileClonesService: IBaseHalfFileClonesService;
	readonly workspaceContextService: IWorkspaceContextService;
	readonly uriIdentityService: IUriIdentityService;
	readonly logService: ILogService;
}

/**
 * Gives the copies that one copy through the workbench made, in Files or on
 * the canvas, the originals and the edit records of the edited files they
 * copy (editing media, "Copies, deletes, and the Trash"), so that a copy can
 * be reverted and edited from its original as the file can. The original is
 * cloned, which takes no room on a disk that can clone files, before its
 * record is written, so that no record names an original that is not there.
 * Where a copy has an edit record already, it stays. Resolves with the copies
 * that could not get theirs.
 */
export async function copyBaseHalfMediaEdits(services: IBaseHalfMediaEditCopyServices, completedFiles: readonly SourceTargetPair[]): Promise<readonly URI[]> {
	const failed: URI[] = [];
	for (const { source, target } of completedFiles) {
		const from = source ? locate(services, source) : undefined;
		const to = locate(services, target);
		// A file from outside the open folders has no card information, and a folder BaseHalf is set to leave alone gets none.
		if (!from || !to || await baseHalfIsWorkspaceFolderMarked(services.fileService, to.workspaceFolder).catch(() => true)) {
			continue;
		}
		let edited: readonly string[];
		try {
			edited = (await baseHalfWalkMirror(services.fileService, from.workspaceFolder, BASEHALF_EDIT_RECORD_FILE, from.relativePath)).map(entry => entry.relativePath).filter(Boolean);
		} catch (error) {
			services.logService.warn(`[BaseHalf] could not look for the edited files below ${source!.toString()}`, error);
			continue;
		}
		for (const path of edited) {
			const rest = path === from.relativePath ? '' : path.slice(from.relativePath ? from.relativePath.length + 1 : 0);
			const copyPath = rest ? (to.relativePath ? `${to.relativePath}/${rest}` : rest) : to.relativePath;
			try {
				await copyEdit(services, cardInformation(from.workspaceFolder, path), cardInformation(to.workspaceFolder, copyPath));
			} catch (error) {
				services.logService.warn(`[BaseHalf] could not give ${copyPath} the original of ${path}`, error);
				failed.push(rest ? URI.joinPath(target, ...rest.split('/')) : target);
			}
		}
	}
	return failed;
}

async function copyEdit(services: IBaseHalfMediaEditCopyServices, from: URI, to: URI): Promise<void> {
	const recordResource = joinPath(to, BASEHALF_EDIT_RECORD_FILE);
	if (await services.fileService.exists(recordResource)) {
		return;
	}
	const bytes = (await services.fileService.readFile(joinPath(from, BASEHALF_EDIT_RECORD_FILE))).value;
	const record = parseBaseHalfEditRecord(bytes.toString());
	const original = record ? joinPath(from, record.original) : undefined;
	// A record that cannot be read, or whose original is gone, is of no edit that a copy could revert.
	if (!record || !original || !(await services.fileService.stat(original).catch(() => undefined))?.isFile) {
		return;
	}
	await services.fileService.createFolder(to);
	const copy = joinPath(to, record.original);
	if (!await services.fileService.exists(copy)) {
		await services.fileClonesService.clone(original, copy);
	}
	await services.fileService.createFile(recordResource, bytes, { overwrite: false });
}

function cardInformation(workspaceFolder: URI, relativePath: string): URI {
	return URI.joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(relativePath));
}

function locate(services: IBaseHalfMediaEditCopyServices, resource: URI): { readonly workspaceFolder: URI; readonly relativePath: string } | undefined {
	const workspaceFolder = services.workspaceContextService.getWorkspaceFolder(resource)?.uri;
	const relativePath = workspaceFolder ? services.uriIdentityService.extUri.relativePath(workspaceFolder, resource) : undefined;
	// BaseHalf's own folder holds no edited files.
	if (!workspaceFolder || !relativePath || relativePath === '.bh' || relativePath.startsWith('.bh/') || relativePath.startsWith('../')) {
		return undefined;
	}
	return { workspaceFolder, relativePath };
}
