/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { baseHalfIsWorkspaceFolderMarked } from './basehalfLegacyCleanup.js';

// The files the system makes by itself stay out of git, by a rule only this
// repository on this computer has (Git/SCM/GitHub/GitGraph, "Files The System
// Makes", D115).

const EXCLUDE_FIRST_LINE = '# Files the system makes by itself. Written by BaseHalf.';

const EXCLUDE_LINES: readonly string[] = [
	EXCLUDE_FIRST_LINE,
	'.DS_Store',
	'._*',
	'Thumbs.db',
	'desktop.ini'
];

/** The folder git keeps a repository in: its `.git`, or for a linked worktree the main repository's. */
export async function baseHalfGitFolder(fileService: IFileService, root: URI): Promise<URI> {
	const git = joinPath(root, '.git');
	const stat = await fileService.stat(git).catch(() => undefined);
	if (!stat || stat.isDirectory) {
		return git;
	}
	const pointer = /^gitdir:\s*(.+?)\s*$/m.exec((await fileService.readFile(git).catch(() => undefined))?.value.toString() ?? '')?.[1];
	if (!pointer) {
		return git;
	}
	const folder = pointer.startsWith('/') ? git.with({ path: pointer }) : joinPath(root, pointer);
	const common = (await fileService.readFile(joinPath(folder, 'commondir')).catch(() => undefined))?.value.toString().trim();
	return common ? (common.startsWith('/') ? folder.with({ path: common }) : joinPath(folder, common)) : folder;
}

/** Whether neither the repository's root nor a workspace folder inside or around it is marked, as far as that can be told. */
export async function baseHalfMayLeaveOutSystemFiles(fileService: IFileService, root: URI, workspaceFolders: readonly URI[]): Promise<boolean> {
	const related = workspaceFolders.filter(folder => isEqualOrParent(folder, root) || isEqualOrParent(root, folder));
	for (const folder of [root, ...related]) {
		if (await baseHalfIsWorkspaceFolderMarked(fileService, folder)) {
			return false;
		}
	}
	return true;
}

/**
 * Adds the files the system makes to the `info/exclude` of the repository at
 * `root`, unless that file holds BaseHalf's first line. Says whether it wrote.
 * A file that cannot be read rejects, and nothing is written over it.
 */
export async function baseHalfLeaveOutSystemFiles(fileService: IFileService, root: URI): Promise<boolean> {
	const exclude = joinPath(await baseHalfGitFolder(fileService, root), 'info', 'exclude');
	let held = '';
	try {
		held = (await fileService.readFile(exclude)).value.toString();
	} catch (error) {
		if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) {
			throw error;
		}
	}
	if (held.split(/\r?\n/).includes(EXCLUDE_FIRST_LINE)) {
		return false;
	}
	const start = held && !held.endsWith('\n') ? `${held}\n` : held;
	await fileService.writeFile(exclude, VSBuffer.fromString(`${start}${EXCLUDE_LINES.join('\n')}\n`));
	return true;
}
