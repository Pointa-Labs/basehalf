/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../platform/files/common/files.js';

/**
 * Utilities for treating `<workspace>/.bh/mirror/` as a tree of per-node
 * directories. Every workspace file/folder `rel` owns the directory
 * `.bh/mirror/<rel>/`, holding up to five YAML files (badge / canvas / focus /
 * adhd / appearance). The workspace root maps to `.bh/mirror/` itself
 * (`rel === ''`).
 *
 * The mirror is sparse: only annotated nodes have a directory, so operations
 * that need "every node with a <kind>.yaml" walk the tree instead of walking
 * the workspace.
 */

export function baseHalfMirrorRoot(workspaceFolder: URI): URI {
	return URI.joinPath(workspaceFolder, '.bh', 'mirror');
}

export class BaseHalfMirrorSymbolicLinkError extends Error {
	override readonly name = 'BaseHalfMirrorSymbolicLinkError';

	constructor(
		readonly resource: URI,
		readonly symbolicLink: URI
	) {
		super(`Refusing to access BaseHalf mirror path through symbolic link ${symbolicLink.toString()} (target ${resource.toString()})`);
	}
}

/**
 * Fail closed when any EXISTING component below `<workspace>/.bh/` on the way
 * to a mirror resource is a symbolic link. This guard is shared by raw mirror
 * snapshot/commit paths; checking only the YAML leaf would still allow a
 * planted `.bh/mirror/<node>` directory link to redirect reads and writes.
 *
 * A missing component ends the walk because none of its descendants can exist
 * yet. Callers check again after directory creation and after commit. These
 * application-layer checks reject stable/planted links, but cannot close an
 * arbitrary external process' final check-to-provider-commit race; that needs
 * a future provider primitive based on component-relative no-follow IO.
 */
export async function baseHalfAssertMirrorPathComponentsNotSymbolicLink(
	fileService: IFileService,
	workspaceFolder: URI,
	resource: URI
): Promise<void> {
	const mirrorRoot = baseHalfMirrorRoot(workspaceFolder);
	const relative = getRelativePath(mirrorRoot, resource);
	if (relative === undefined || relative === '..' || relative.startsWith('../')) {
		throw new Error(`Resource is outside the BaseHalf mirror tree: ${resource.toString()}`);
	}

	const candidates = [URI.joinPath(workspaceFolder, '.bh'), mirrorRoot];
	let current = mirrorRoot;
	for (const segment of baseHalfMirrorPathSegments(relative)) {
		current = URI.joinPath(current, segment);
		candidates.push(current);
	}

	for (const candidate of candidates) {
		try {
			// `stat` observes the directory entry without enumerating a symbolic
			// link's target. `resolve` is intentionally not used here: checking a
			// hostile mirror-root link must not first traverse and list outside data.
			const stat = await fileService.stat(candidate);
			if (stat.isSymbolicLink) {
				throw new BaseHalfMirrorSymbolicLinkError(resource, candidate);
			}
		} catch (error) {
			// `IFileService.stat` deliberately exposes provider errors directly,
			// whereas read/resolve operations commonly wrap them in
			// `FileOperationError`. Treat both representations of a missing suffix
			// alike; every other provider failure still fails closed.
			if (isFileNotFound(error)) {
				return;
			}
			throw error;
		}
	}
}

/** `.bh/mirror/<rel>/<fileName>`; rejects `.`/`..` segments so a hostile rel
 *  cannot escape the mirror tree through URI joins. */
export function baseHalfMirrorResource(workspaceFolder: URI, relativePath: string, fileName: string): URI {
	return URI.joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(relativePath), fileName);
}

export function baseHalfMirrorPathSegments(relativePath: string): string[] {
	if (!relativePath) {
		return [];
	}

	const segments = relativePath.split('/').filter(Boolean);
	if (segments.some(segment => segment === '.' || segment === '..')) {
		throw new Error(`Invalid BaseHalf mirror relative path: ${relativePath}`);
	}

	return segments;
}

/** True when `relativePath` is `root` itself or a descendant of it (prefix on a
 *  path boundary: `docs` matches `docs` and `docs/a`, not `docs-2`). */
export function baseHalfIsMirrorSubtree(relativePath: string, root: string): boolean {
	return relativePath === root || relativePath.startsWith(`${root}/`);
}

/** Re-root a subtree rel from under `from` to under `to` (`from` → `to`,
 *  `from/x` → `to/x`). Caller guarantees `baseHalfIsMirrorSubtree(rel, from)`. */
export function baseHalfRemapSubtreeRel(relativePath: string, from: string, to: string): string {
	return relativePath === from ? to : `${to}${relativePath.slice(from.length)}`;
}

export interface IBaseHalfMirrorTreeEntry {
	/** Workspace-relative path of the NODE (`''` for the workspace root). */
	readonly relativePath: string;
	/** The `<fileName>` resource inside the node's mirror directory. */
	readonly resource: URI;
}

/**
 * Walk `.bh/mirror/` and return every node directory that contains `fileName`,
 * sorted by relative path. Symbolic links are never descended into (the mirror
 * is app-written; a symlinked directory inside it is hostile or an accident and
 * must not let the walk escape or loop). A missing mirror tree is an empty
 * result, never an error.
 */
export async function baseHalfWalkMirror(fileService: IFileService, workspaceFolder: URI, fileName: string): Promise<IBaseHalfMirrorTreeEntry[]> {
	const out: IBaseHalfMirrorTreeEntry[] = [];
	const stack: Array<{ readonly resource: URI; readonly relativePath: string }> = [
		{ resource: baseHalfMirrorRoot(workspaceFolder), relativePath: '' }
	];

	while (stack.length > 0) {
		const current = stack.pop()!;
		let children;
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, current.resource);
			const resolved = await fileService.resolve(current.resource);
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, current.resource);
			children = resolved.children ?? [];
		} catch (error) {
			if (isFileNotFound(error)) {
				continue;
			}

			throw error;
		}

		for (const child of children) {
			if (child.isSymbolicLink) {
				continue;
			}

			if (child.isDirectory) {
				stack.push({
					resource: child.resource,
					relativePath: current.relativePath ? `${current.relativePath}/${child.name}` : child.name
				});
			} else if (child.isFile && child.name === fileName) {
				out.push({ relativePath: current.relativePath, resource: child.resource });
			}
		}
	}

	return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
}
