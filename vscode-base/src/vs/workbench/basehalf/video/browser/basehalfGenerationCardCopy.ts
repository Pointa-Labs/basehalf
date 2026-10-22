/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfWalkMirror } from '../../workspace/common/basehalfMirrorTree.js';
import { BASEHALF_GENERATION_INFO_FILE, BASEHALF_GENERATION_MADE_FILE, baseHalfGenerationKindOfPath } from '../common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardStore } from '../common/basehalfVideoGeneration.js';

export interface IBaseHalfGenerationCardCopyServices {
	readonly fileService: IFileService;
	readonly workspaceContextService: IWorkspaceContextService;
	readonly uriIdentityService: IUriIdentityService;
	readonly cardStore: IBaseHalfGenerationCardStore;
	readonly logService: ILogService;
}

export interface IBaseHalfGenerationCardCopyResult {
	/** The copies that got card information. */
	readonly copied: readonly URI[];
	/** The copies whose card information could not be written. */
	readonly failed: readonly URI[];
}

/**
 * Gives what one copy through the workbench made the card information of the
 * generation cards it copied (generation cards, "Moving, renaming, copying,
 * and undo"), in Files and on the canvas alike: the copy of a card with its
 * file gets the same `generation.yaml` and a `made.yaml` with a new `id` that
 * says which record it copies, and a draft below a copied folder is a new
 * draft at the same place in the copy. No upstream list and no task come
 * along, and where card information already is, it stays.
 *
 * Only the completed pairs of the copy are looked at: a pair that failed
 * part way has no copy to give card information to.
 */
export async function copyBaseHalfGenerationCardInformation(
	services: IBaseHalfGenerationCardCopyServices,
	completedFiles: readonly SourceTargetPair[],
	createId: () => string
): Promise<IBaseHalfGenerationCardCopyResult> {
	const copied: URI[] = [];
	const failed: URI[] = [];
	const marked = new Map<string, Promise<boolean>>();
	const isMarked = (workspaceFolder: URI) => {
		const key = workspaceFolder.toString();
		let result = marked.get(key);
		if (!result) {
			result = baseHalfIsWorkspaceFolderMarked(services.fileService, workspaceFolder).catch(() => true);
			marked.set(key, result);
		}
		return result;
	};
	for (const { source, target } of completedFiles) {
		const from = source ? locate(services, source) : undefined;
		const to = locate(services, target);
		// A file from outside the open folders has no card information, and a
		// folder BaseHalf is set to leave alone gets none.
		if (!from || !to || await isMarked(to.workspaceFolder)) {
			continue;
		}
		let cards: readonly string[];
		try {
			cards = await baseHalfGenerationCardPathsBelow(services.fileService, from.workspaceFolder, from.relativePath);
		} catch (error) {
			services.logService.warn(`[BaseHalf generation] could not look for the cards below ${source!.toString()}`, error);
			continue;
		}
		for (const path of cards) {
			const rest = path === from.relativePath ? [] : path.slice(from.relativePath ? from.relativePath.length + 1 : 0).split('/');
			const card = URI.joinPath(from.workspaceFolder, ...path.split('/'));
			const copy = rest.length ? URI.joinPath(target, ...rest) : target;
			try {
				if (await services.cardStore.writeCopy(card, copy, createId())) {
					copied.push(copy);
				}
			} catch (error) {
				services.logService.warn(`[BaseHalf generation] could not give ${copy.toString()} the card information of ${card.toString()}`, error);
				failed.push(copy);
			}
		}
	}
	return { copied, failed };
}

/**
 * The workspace-relative paths at or below `path` whose card information is
 * a generation card's: a directory of `.bh/mirror/` with a `generation.yaml`
 * or a `made.yaml`, whose name has a generation extension. Whether an item is
 * at the path is not looked at; the card store decides what a copy of each
 * one is. Symbolic links are never followed.
 */
export async function baseHalfGenerationCardPathsBelow(fileService: IFileService, workspaceFolder: URI, path: string): Promise<readonly string[]> {
	const [infos, records] = await Promise.all([
		baseHalfWalkMirror(fileService, workspaceFolder, BASEHALF_GENERATION_INFO_FILE, path),
		baseHalfWalkMirror(fileService, workspaceFolder, BASEHALF_GENERATION_MADE_FILE, path)
	]);
	const paths = new Set([...infos, ...records].map(entry => entry.relativePath).filter(candidate => !!candidate && baseHalfGenerationKindOfPath(candidate) !== undefined));
	return [...paths].sort();
}

function locate(services: IBaseHalfGenerationCardCopyServices, resource: URI): { readonly workspaceFolder: URI; readonly relativePath: string } | undefined {
	const workspaceFolder = services.workspaceContextService.getWorkspaceFolder(resource)?.uri;
	const relativePath = workspaceFolder ? services.uriIdentityService.extUri.relativePath(workspaceFolder, resource) : undefined;
	// BaseHalf's own folder holds no cards.
	if (!workspaceFolder || relativePath === undefined || relativePath === '.bh' || relativePath.startsWith('.bh/') || relativePath.startsWith('../')) {
		return undefined;
	}
	return { workspaceFolder, relativePath };
}
