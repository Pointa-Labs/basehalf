/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService, IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { baseHalfPathHoldsDraft } from '../../video/common/basehalfGenerationDraft.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceResourceMutationStamp } from '../../workspace/common/basehalfWorkspaceMutation.js';

/** Set in the menu of a card that is a draft, which has no file: what works on a file is not offered there. */
export const BASEHALF_CANVAS_CARD_IS_DRAFT = new RawContextKey<boolean>('basehalfCanvasCardIsDraft', false);

export interface IBaseHalfCanvasResourceSnapshot {
	readonly isFile: boolean;
	readonly isDirectory: boolean;
	readonly isSymbolicLink: boolean;
	readonly mtime: number | undefined;
	readonly ctime: number | undefined;
	readonly size: number | undefined;
	readonly etag: string | undefined;
	/**
	 * The resource is a draft: a generation card whose file does not exist yet
	 * (generation cards, "Drafts and missing files"). It is neither a file nor a
	 * folder.
	 */
	readonly draft?: true;
}

export interface IBaseHalfCanvasActionContext {
	readonly resource: URI;
	readonly workspaceFolder: URI;
	readonly relativePath: string;
	readonly stamp: IBaseHalfWorkspaceResourceMutationStamp;
	readonly snapshot: IBaseHalfCanvasResourceSnapshot;
}

export const IBaseHalfCanvasActionContextService = createDecorator<IBaseHalfCanvasActionContextService>('baseHalfCanvasActionContextService');

export interface IBaseHalfCanvasActionContextService {
	readonly _serviceBrand: undefined;
	capture(resource: URI, workspaceFolder: URI, relativePath: string): Promise<IBaseHalfCanvasActionContext>;
	assertCurrent(context: IBaseHalfCanvasActionContext): Promise<IFileStatWithPartialMetadata>;
}

export function isBaseHalfCanvasActionContext(value: unknown): value is IBaseHalfCanvasActionContext {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<IBaseHalfCanvasActionContext>;
	return URI.isUri(candidate.resource)
		&& URI.isUri(candidate.workspaceFolder)
		&& typeof candidate.relativePath === 'string'
		&& !!candidate.stamp
		&& !!candidate.snapshot;
}

export function sameBaseHalfCanvasResourceSnapshot(snapshot: IBaseHalfCanvasResourceSnapshot, stat: IFileStatWithPartialMetadata): boolean {
	const sameKind = snapshot.isFile === stat.isFile
		&& snapshot.isDirectory === stat.isDirectory
		&& snapshot.isSymbolicLink === stat.isSymbolicLink;
	if (!sameKind || snapshot.isDirectory) {
		// A directory's mtime, size and provider etag normally change whenever a
		// child is added or removed. Those are canvas contents, not a replacement
		// of the folder identity captured for an open action. Structural moves and
		// deletes are already guarded by the resource mutation stamp above.
		return sameKind;
	}
	return optionalMetadataMatches(snapshot.mtime, stat.mtime)
		&& optionalMetadataMatches(snapshot.ctime, stat.ctime)
		&& optionalMetadataMatches(snapshot.size, stat.size)
		&& optionalMetadataMatches(snapshot.etag, stat.etag);
}

export class BaseHalfCanvasActionContextService implements IBaseHalfCanvasActionContextService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator
	) { }

	async capture(resource: URI, workspaceFolder: URI, relativePath: string): Promise<IBaseHalfCanvasActionContext> {
		const stamp = this.workspaceMutationCoordinator.captureResource(workspaceFolder, relativePath);
		if (!this.workspaceMutationCoordinator.isResourceStampCurrent(workspaceFolder, stamp)) {
			throw new Error('The resource identity changed before the canvas action started.');
		}
		let snapshot: IBaseHalfCanvasResourceSnapshot;
		try {
			snapshot = snapshotFromStat(await this.fileService.stat(resource));
		} catch (error) {
			// A draft has no file: its card is acted on all the same.
			if (!await baseHalfPathHoldsDraft(this.fileService, workspaceFolder, relativePath)) {
				throw error;
			}
			snapshot = DRAFT_SNAPSHOT;
		}
		if (!this.workspaceMutationCoordinator.isResourceStampCurrent(workspaceFolder, stamp)) {
			throw new Error('The resource identity changed before the canvas action started.');
		}
		return { resource, workspaceFolder, relativePath, stamp, snapshot };
	}

	async assertCurrent(context: IBaseHalfCanvasActionContext): Promise<IFileStatWithPartialMetadata> {
		if (!this.workspaceMutationCoordinator.isResourceStampCurrent(context.workspaceFolder, context.stamp)) {
			throw new Error('The resource identity changed while the canvas action was open. Try the action again.');
		}
		if (context.snapshot.draft) {
			// Still a draft, and no file came: its stat is made up, neither a file nor a folder.
			if (!await baseHalfPathHoldsDraft(this.fileService, context.workspaceFolder, context.relativePath)
				|| !this.workspaceMutationCoordinator.isResourceStampCurrent(context.workspaceFolder, context.stamp)) {
				throw new Error('The resource changed while the canvas action was open. Try the action again.');
			}
			return draftStat(context.resource);
		}
		const stat = await this.fileService.stat(context.resource);
		if (!this.workspaceMutationCoordinator.isResourceStampCurrent(context.workspaceFolder, context.stamp)
			|| !sameBaseHalfCanvasResourceSnapshot(context.snapshot, stat)) {
			throw new Error('The resource changed while the canvas action was open. Try the action again.');
		}
		return stat;
	}
}

/** What a canvas action knows of a draft: it is no file or folder, and nothing about it can be compared. */
const DRAFT_SNAPSHOT: IBaseHalfCanvasResourceSnapshot = Object.freeze({
	isFile: false,
	isDirectory: false,
	isSymbolicLink: false,
	mtime: undefined,
	ctime: undefined,
	size: undefined,
	etag: undefined,
	draft: true
});

function draftStat(resource: URI): IFileStatWithPartialMetadata {
	return { resource, name: basename(resource), isFile: false, isDirectory: false, isSymbolicLink: false, mtime: 0, ctime: 0, etag: '', size: 0, readonly: false, locked: false, executable: false };
}

function snapshotFromStat(stat: IFileStatWithPartialMetadata): IBaseHalfCanvasResourceSnapshot {
	return {
		isFile: stat.isFile,
		isDirectory: stat.isDirectory,
		isSymbolicLink: stat.isSymbolicLink,
		mtime: stat.mtime,
		ctime: stat.ctime,
		size: stat.size,
		etag: stat.etag
	};
}

function optionalMetadataMatches<T>(expected: T | undefined, actual: T | undefined): boolean {
	return expected === undefined || expected === actual;
}

registerSingleton(IBaseHalfCanvasActionContextService, BaseHalfCanvasActionContextService, InstantiationType.Delayed);
