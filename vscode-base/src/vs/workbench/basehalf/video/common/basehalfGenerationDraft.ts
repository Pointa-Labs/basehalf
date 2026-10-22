/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { FileOperationResult, IFileService, IFileStat, IFileStatWithPartialMetadata, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorResource, baseHalfMirrorRoot } from '../../workspace/common/basehalfMirrorTree.js';
import {
	BASEHALF_GENERATION_INFO_FILE,
	BASEHALF_GENERATION_MADE_FILE,
	baseHalfGenerationKindOfPath,
	baseHalfGenerationNameParts,
	baseHalfGenerationNextFreeName
} from './basehalfGenerationInfo.js';

/**
 * Drafts (generation cards, "Drafts and missing files"). A draft is a
 * generation card before its file exists: a `generation.yaml` with no
 * `made.yaml`, under a name with a generation extension, at a path that names
 * no file or folder. Its path is the path its file will have.
 *
 * One rule decides it for every part of BaseHalf that meets a path without an
 * item: the reference index (a draft is a node that is present), following
 * moved items and the mirror cascade (a draft is card information without a
 * file by design, which the orphan sweep never marks), and the canvas (a
 * draft has a card, and its row is never removed as the row of an item that
 * is gone). A generation card whose generated file is gone has a `made.yaml`
 * and is not a draft: it is a missing file.
 *
 * {@link baseHalfIsDraft} is the rule. The functions below it read what it
 * needs from disk.
 */

/** What the card information at a path says, whatever is at the path now. */
export interface IBaseHalfDraftInformation {
	/** Workspace-relative path of the card. */
	readonly path: string;
	/** `.bh/mirror/<path>/generation.yaml` is a file. */
	readonly hasGenerationInfo: boolean;
	/** `.bh/mirror/<path>/made.yaml` is a file. */
	readonly hasMade: boolean;
}

/** What decides whether a path holds a draft. */
export interface IBaseHalfDraftFacts extends IBaseHalfDraftInformation {
	/** A file or a folder is at the path. */
	readonly itemExists: boolean;
}

/**
 * Whether the card information at a path is a draft's: a `generation.yaml`,
 * no `made.yaml`, and a name with a generation extension. A file or folder
 * that is at the path now is not looked at: an item that arrives at a draft's
 * path finds a draft's card information there.
 */
export function baseHalfIsDraftInformation(information: IBaseHalfDraftInformation): boolean {
	return information.hasGenerationInfo && !information.hasMade && baseHalfGenerationKindOfPath(information.path) !== undefined;
}

/**
 * Whether a path holds a draft: its card information is a draft's
 * ({@link baseHalfIsDraftInformation}) and no file or folder is at the path.
 * The workspace root and paths under `.bh/` never hold one.
 */
export function baseHalfIsDraft(facts: IBaseHalfDraftFacts): boolean {
	return !facts.itemExists && !isOutsideItems(facts.path) && baseHalfIsDraftInformation(facts);
}

/** Paths that are never items: the workspace root and BaseHalf's own folder. */
function isOutsideItems(path: string): boolean {
	return path === '' || path === '.bh' || path.startsWith('.bh/');
}

/**
 * Reads what decides whether `path` holds a draft. A mirror file that lies
 * behind a symbolic link, or that cannot be looked at, reads as absent:
 * BaseHalf never treats what it reaches through a link as card information.
 */
export async function baseHalfReadDraftFacts(fileService: IFileService, workspaceFolder: URI, path: string): Promise<IBaseHalfDraftFacts> {
	if (isOutsideItems(path)) {
		return { path, hasGenerationInfo: false, hasMade: false, itemExists: false };
	}
	const [hasGenerationInfo, hasMade, item] = await Promise.all([
		mirrorFileExists(fileService, workspaceFolder, path, BASEHALF_GENERATION_INFO_FILE),
		mirrorFileExists(fileService, workspaceFolder, path, BASEHALF_GENERATION_MADE_FILE),
		statOptional(fileService, itemResource(workspaceFolder, path))
	]);
	return { path, hasGenerationInfo, hasMade, itemExists: !!item };
}

/**
 * Whether `path` holds a draft that is shown: a draft whose folder exists on
 * this computer. The reference graph and the canvas treat only such a draft
 * as present (generation cards: "A draft in a folder that does not exist on
 * this computer is not shown").
 */
export async function baseHalfPathHoldsDraft(fileService: IFileService, workspaceFolder: URI, path: string): Promise<boolean> {
	if (baseHalfGenerationKindOfPath(path) === undefined || isOutsideItems(path)) {
		return false;
	}
	const slash = path.lastIndexOf('/');
	const [facts, folder] = await Promise.all([
		baseHalfReadDraftFacts(fileService, workspaceFolder, path),
		slash < 0 ? Promise.resolve(undefined) : statOptional(fileService, itemResource(workspaceFolder, path.slice(0, slash)))
	]);
	return baseHalfIsDraft(facts) && (slash < 0 || !!folder?.isDirectory);
}

/**
 * The paths at or below `below` (the whole workspace folder by default) whose
 * card information is a draft's ({@link baseHalfIsDraftInformation}): a walk
 * of `.bh/mirror/**` for `generation.yaml` that never follows a symbolic link.
 * Whether a file or folder is at a path is not looked at. A missing mirror
 * tree is an empty result.
 */
export async function baseHalfWalkDraftInformation(fileService: IFileService, workspaceFolder: URI, below = ''): Promise<string[]> {
	const out: string[] = [];
	const mirrorRoot = baseHalfMirrorRoot(workspaceFolder);
	const stack: { readonly resource: URI; readonly path: string }[] = [{ resource: below ? URI.joinPath(mirrorRoot, ...baseHalfMirrorPathSegments(below)) : mirrorRoot, path: below }];
	while (stack.length > 0) {
		const current = stack.pop()!;
		let children: readonly IFileStat[];
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, current.resource);
			const resolved = await fileService.resolve(current.resource);
			if (!resolved.isDirectory) {
				continue;
			}
			children = resolved.children ?? [];
		} catch (error) {
			if (isFileNotFound(error)) {
				continue;
			}
			throw error;
		}
		let hasGenerationInfo = false;
		let hasMade = false;
		for (const child of children) {
			if (child.isSymbolicLink) {
				continue;
			}
			if (child.isDirectory) {
				stack.push({ resource: child.resource, path: current.path ? `${current.path}/${child.name}` : child.name });
			} else if (child.isFile && child.name === BASEHALF_GENERATION_INFO_FILE) {
				hasGenerationInfo = true;
			} else if (child.isFile && child.name === BASEHALF_GENERATION_MADE_FILE) {
				hasMade = true;
			}
		}
		if (current.path && baseHalfIsDraftInformation({ path: current.path, hasGenerationInfo, hasMade })) {
			out.push(current.path);
		}
	}
	return out.sort();
}

/**
 * The path a draft at `path` moves aside to when an item takes its path
 * (following moved items, "Relocation"): the first name of its folder that
 * is numbered from its own, as the canvas numbers what it creates
 * (`shot.mp4`, `shot-2.mp4`, `shot-3.mp4`), at which neither an item nor any
 * card information is. Names that differ only in letter case count as the
 * same name. `undefined` when no name is free.
 */
export async function baseHalfDraftAsidePath(fileService: IFileService, workspaceFolder: URI, path: string): Promise<string | undefined> {
	const slash = path.lastIndexOf('/');
	const folder = slash < 0 ? '' : path.slice(0, slash);
	const { base, extension } = baseHalfGenerationNameParts(path.slice(slash + 1));
	const taken = new Set<string>();
	for (const directory of [folder ? itemResource(workspaceFolder, folder) : workspaceFolder, folder ? URI.joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(folder)) : baseHalfMirrorRoot(workspaceFolder)]) {
		try {
			for (const child of (await fileService.resolve(directory)).children ?? []) {
				taken.add(child.name.toLowerCase());
			}
		} catch (error) {
			if (!isFileNotFound(error)) {
				throw error;
			}
		}
	}
	const name = baseHalfGenerationNextFreeName(base, extension, candidate => taken.has(candidate.toLowerCase()), 2);
	return name === undefined ? undefined : folder ? `${folder}/${name}` : name;
}

async function mirrorFileExists(fileService: IFileService, workspaceFolder: URI, path: string, fileName: string): Promise<boolean> {
	const resource = baseHalfMirrorResource(workspaceFolder, path, fileName);
	try {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, resource);
		const stat = await fileService.stat(resource);
		return stat.isFile && !stat.isSymbolicLink;
	} catch {
		return false;
	}
}

async function statOptional(fileService: IFileService, resource: URI): Promise<IFileStatWithPartialMetadata | undefined> {
	try {
		return await fileService.stat(resource);
	} catch {
		return undefined;
	}
}

function itemResource(workspaceFolder: URI, path: string): URI {
	return URI.joinPath(workspaceFolder, ...path.split('/'));
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
}
