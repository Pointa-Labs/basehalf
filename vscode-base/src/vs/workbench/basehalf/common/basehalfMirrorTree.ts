/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';

/**
 * Utilities for treating `<workspace>/.bh/mirror/` as a tree of per-node
 * directories. Every workspace file/folder `rel` owns the directory
 * `.bh/mirror/<rel>/`, holding up to four YAML files (badge / canvas / focus /
 * adhd). The workspace root maps to `.bh/mirror/` itself (`rel === ''`).
 *
 * The mirror is sparse: only annotated nodes have a directory, so operations
 * that need "every node with a <kind>.yaml" walk the tree instead of walking
 * the workspace.
 */

export function baseHalfMirrorRoot(workspaceFolder: URI): URI {
	return URI.joinPath(workspaceFolder, '.bh', 'mirror');
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
			children = (await fileService.resolve(current.resource)).children ?? [];
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
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
