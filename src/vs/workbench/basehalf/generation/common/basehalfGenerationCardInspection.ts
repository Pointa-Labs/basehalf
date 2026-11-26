/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { dirname, extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BaseHalfGenerationKind, baseHalfGenerationKindOfPath } from './basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardSnapshot, IBaseHalfGenerationCardStore } from './basehalfVideoGeneration.js';

/** What a generation card is, to code that is not the card's own. */
export interface IBaseHalfGenerationCardState {
	readonly kind: BaseHalfGenerationKind;
	readonly hasFile: boolean;
	/** The `id` of its `made.yaml`. */
	readonly generationId?: string;
}

/**
 * What code outside generation cards learns of one (generation cards,
 * "Implementation boundaries"): its kind, whether it has its file, and the
 * `id` of its `made.yaml`, read through the card store. Every resource that
 * is not a generation card of an open local workspace folder answers
 * nothing, and so does one that is a symbolic link or resolves outside its
 * workspace folder. Nothing is written.
 */
export async function inspectBaseHalfGenerationCard(
	card: URI,
	fileService: IFileService,
	workspaceContextService: IWorkspaceContextService,
	generationCardStore: IBaseHalfGenerationCardStore
): Promise<IBaseHalfGenerationCardState | undefined> {
	if (card.scheme !== Schemas.file || card.query || card.fragment) {
		return undefined;
	}
	const workspaceFolder = workspaceContextService.getWorkspaceFolder(card)?.uri;
	const relativePath = workspaceFolder ? extUri.relativePath(workspaceFolder, card) : undefined;
	if (!workspaceFolder || !relativePath || relativePath === '..' || relativePath.startsWith('../')
		|| relativePath.split('/').some(segment => segment.toLowerCase() === '.bh')
		|| !baseHalfGenerationKindOfPath(relativePath)
		|| !await resolvesInside(fileService, workspaceFolder, card)
		|| !await generationCardStore.isGenerationCard(card)) {
		return undefined;
	}
	let snapshot: IBaseHalfGenerationCardSnapshot;
	try {
		snapshot = await generationCardStore.read(card);
	} catch {
		return undefined;
	}
	return {
		kind: snapshot.kind,
		hasFile: snapshot.hasFile,
		...(snapshot.made ? { generationId: snapshot.made.id } : {})
	};
}

/**
 * Whether a file is a regular file, not a symbolic link, that resolves inside
 * a workspace folder.
 */
export async function isBaseHalfOrdinaryFileInside(fileService: IFileService, workspaceFolder: URI, resource: URI): Promise<boolean> {
	const stat = await statQuietly(fileService, resource);
	return !!stat && stat.isFile && !stat.isSymbolicLink && await resolvesInside(fileService, workspaceFolder, resource);
}

/**
 * Whether a card is a regular file that resolves inside its workspace
 * folder, or a draft whose folder does: never a symbolic link.
 */
async function resolvesInside(fileService: IFileService, workspaceFolder: URI, card: URI): Promise<boolean> {
	const [workspaceRealpath, stat] = await Promise.all([realpathQuietly(fileService, workspaceFolder), statQuietly(fileService, card)]);
	if (!workspaceRealpath) {
		return false;
	}
	if (stat && (stat.isSymbolicLink || !stat.isFile)) {
		return false;
	}
	const realpath = await realpathQuietly(fileService, stat ? card : dirname(card));
	return !!realpath && extUri.isEqualOrParent(realpath, workspaceRealpath) && (!stat || !extUri.isEqual(realpath, workspaceRealpath));
}

async function statQuietly(fileService: IFileService, resource: URI): Promise<IFileStatWithPartialMetadata | undefined> {
	try {
		return await fileService.stat(resource);
	} catch {
		return undefined;
	}
}

async function realpathQuietly(fileService: IFileService, resource: URI): Promise<URI | undefined> {
	try {
		return await fileService.realpath(resource);
	} catch {
		return undefined;
	}
}
