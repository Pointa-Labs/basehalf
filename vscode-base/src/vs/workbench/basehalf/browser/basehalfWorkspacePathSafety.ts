/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { extUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';

export interface IBaseHalfVerifiedWorkspacePath {
	readonly workspaceRealpath: URI;
	readonly resourceRealpath: URI;
}

/**
 * Verifies an existing project-local path without following symbolic-link
 * components. Callers still use conditional writes for publication; this
 * guard establishes the project boundary before any read or mutation begins.
 */
export async function assertBaseHalfWorkspaceFile(
	fileService: IFileService,
	workspaceFolder: URI,
	resource: URI,
	label: string
): Promise<IBaseHalfVerifiedWorkspacePath> {
	const relative = workspaceRelativePath(workspaceFolder, resource, label);
	const entries = workspacePathEntries(workspaceFolder, relative);
	const stats = await Promise.all(entries.map(entry => fileService.stat(entry)));
	const leaf = stats.at(-1);
	if (stats.some(stat => stat.isSymbolicLink)) {
		throw new Error(`The ${label} cannot follow symbolic links.`);
	}
	if (!leaf?.isFile || leaf.isDirectory) {
		throw new Error(`The ${label} must identify a regular project file.`);
	}
	for (const stat of stats.slice(0, -1)) {
		if (!stat.isDirectory) {
			throw new Error(`The ${label} contains a non-folder path component.`);
		}
	}
	const [workspaceRealpath, resourceRealpath] = await Promise.all([
		resolveWorkspacePath(fileService, workspaceFolder),
		resolveWorkspacePath(fileService, resource)
	]);
	if (!extUri.isEqualOrParent(resourceRealpath, workspaceRealpath)
		|| extUri.isEqual(resourceRealpath, workspaceRealpath)) {
		throw new Error(`The ${label} resolves outside this project.`);
	}
	// Repeat the component check after realpath resolution. This narrows the
	// namespace race around providers that cannot expose dirfd/openat semantics.
	const afterStats = await Promise.all(entries.map(entry => fileService.stat(entry)));
	if (afterStats.some(stat => stat.isSymbolicLink) || !afterStats.at(-1)?.isFile) {
		throw new Error(`The ${label} changed while its project path was being verified.`);
	}
	return Object.freeze({ workspaceRealpath, resourceRealpath });
}

/** Ensures a project-local directory one segment at a time and rejects every
 * pre-existing symbolic-link component before it can receive project data. */
export async function ensureBaseHalfWorkspaceDirectory(
	fileService: IFileService,
	workspaceFolder: URI,
	directory: URI,
	label: string
): Promise<URI> {
	const relative = workspaceRelativePath(workspaceFolder, directory, label);
	const workspaceStat = await fileService.stat(workspaceFolder);
	const workspaceRealpath = await resolveWorkspacePath(fileService, workspaceFolder);
	if (!workspaceStat.isDirectory || workspaceStat.isSymbolicLink) {
		throw new Error(`This project cannot verify the ${label}.`);
	}

	let parent = workspaceFolder;
	let parentRealpath = workspaceRealpath;
	for (const segment of relative.split('/').filter(Boolean)) {
		const current = URI.joinPath(parent, segment);
		const verifiedParent = await resolveWorkspacePath(fileService, parent);
		const parentStat = await fileService.stat(parent);
		if (!extUri.isEqual(verifiedParent, parentRealpath)
			|| !parentStat.isDirectory || parentStat.isSymbolicLink) {
			throw new Error(`The ${label} changed while its parent was being verified.`);
		}
		if (!await fileService.exists(current)) {
			await fileService.createFolder(current);
		}
		const stat = await fileService.stat(current);
		const currentRealpath = await resolveWorkspacePath(fileService, current);
		if (!stat.isDirectory || stat.isSymbolicLink
			|| !extUri.isEqualOrParent(currentRealpath, workspaceRealpath)) {
			throw new Error(`The ${label} contains a non-folder or symbolic-link component.`);
		}
		const parentAfter = await resolveWorkspacePath(fileService, parent);
		if (!extUri.isEqual(parentAfter, parentRealpath)) {
			throw new Error(`The ${label} changed while a directory was being created.`);
		}
		parent = current;
		parentRealpath = currentRealpath;
	}
	return parentRealpath;
}

/** Verifies every existing component of a project path. The leaf may be absent
 * when a caller is about to publish a new file with exclusive creation. */
export async function assertBaseHalfWorkspaceFilePath(
	fileService: IFileService,
	workspaceFolder: URI,
	resource: URI,
	label: string,
	allowMissingLeaf: boolean
): Promise<void> {
	const relative = workspaceRelativePath(workspaceFolder, resource, label);
	const workspaceRealpath = await resolveWorkspacePath(fileService, workspaceFolder);
	const workspaceStat = await fileService.stat(workspaceFolder);
	if (!workspaceStat.isDirectory || workspaceStat.isSymbolicLink) {
		throw new Error(`This project cannot verify the ${label}.`);
	}
	let current = workspaceFolder;
	const segments = relative.split('/').filter(Boolean);
	for (let index = 0; index < segments.length; index++) {
		current = URI.joinPath(current, segments[index]);
		if (!await fileService.exists(current)) {
			if (allowMissingLeaf && index === segments.length - 1) {
				return;
			}
			throw new Error(`The ${label} path is missing.`);
		}
		const stat = await fileService.stat(current);
		if (stat.isSymbolicLink) {
			throw new Error(`The ${label} cannot follow symbolic links.`);
		}
		if (index < segments.length - 1 && !stat.isDirectory) {
			throw new Error(`The ${label} contains a non-folder path component.`);
		}
		if (index === segments.length - 1 && stat.isDirectory) {
			throw new Error(`The ${label} must identify a regular project file.`);
		}
		const realpath = await resolveWorkspacePath(fileService, current);
		if (!extUri.isEqualOrParent(realpath, workspaceRealpath)) {
			throw new Error(`The ${label} resolves outside this project.`);
		}
	}
}

async function resolveWorkspacePath(fileService: IFileService, resource: URI): Promise<URI> {
	return await fileService.realpath(resource) ?? resource;
}

function workspaceRelativePath(workspaceFolder: URI, resource: URI, label: string): string {
	if (workspaceFolder.scheme !== resource.scheme || workspaceFolder.authority !== resource.authority
		|| workspaceFolder.query || workspaceFolder.fragment || resource.query || resource.fragment) {
		throw new Error(`The ${label} must use a plain project URI.`);
	}
	const relative = extUri.relativePath(workspaceFolder, resource);
	if (!relative || relative === '..' || relative.startsWith('../')) {
		throw new Error(`The ${label} must remain inside this project.`);
	}
	return relative;
}

function workspacePathEntries(workspaceFolder: URI, relative: string): readonly URI[] {
	const entries: URI[] = [workspaceFolder];
	let current = workspaceFolder;
	for (const segment of relative.split('/').filter(Boolean)) {
		current = URI.joinPath(current, segment);
		entries.push(current);
	}
	return entries;
}
