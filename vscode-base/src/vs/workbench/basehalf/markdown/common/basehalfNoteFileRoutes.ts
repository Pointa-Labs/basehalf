/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { dirname, isEqual, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { baseHalfNoteLinkDestinationRanges, baseHalfNoteStoreLink } from './basehalfNoteFileLinks.js';
import { BASEHALF_NO_WORKSPACE_SETUP_MARKER, BASEHALF_NOTE_FILES_STORE_PATH } from './basehalfNoteFiles.js';

// Route corrections (files in notes, rules 28 to 30): a note moved to another
// depth keeps its folder in the store; only the `../` before `.bh` of each of
// its links into the store changes, and only for a link that leads nowhere.

/** One change of a note's text: `length` characters at `at` become `text`. */
export interface IBaseHalfNoteRouteEdit {
	readonly at: number;
	readonly length: number;
	readonly text: string;
}

/** What git leaves in its folder while an operation is in the middle (rule 30). */
const GIT_BUSY: readonly string[] = ['index.lock', 'MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'];

/**
 * The edits that give each link of the note `note`, whose text is
 * `markdown`, into a store that leads nowhere the route to the nearest store
 * at or above the note that holds its key: the folder at or above the note
 * nearest to it, then the folders above it to the workspace folder and above
 * it (rule 30). A link that leads somewhere, or whose key no such store
 * holds, is left as it is. Nothing is edited in a marked folder or while git
 * is in the middle of an operation in the note's repository.
 */
export async function baseHalfNoteFileRouteEdits(fileService: IFileService, workspaceFolder: URI, note: URI, markdown: string): Promise<IBaseHalfNoteRouteEdit[]> {
	const links = baseHalfNoteLinkDestinationRanges(markdown).flatMap(({ at, destination }) => {
		const link = baseHalfNoteStoreLink(destination);
		return link ? [{ at, destination, link }] : [];
	});
	if (links.length === 0 || !isEqualOrParent(note, workspaceFolder) || await fileService.exists(joinPath(workspaceFolder, BASEHALF_NO_WORKSPACE_SETUP_MARKER)) || await gitIsBusy(fileService, workspaceFolder, note)) {
		return [];
	}
	const folder = dirname(note);
	const homes: URI[] = [];
	for (let candidate = folder; ; candidate = dirname(candidate)) {
		homes.push(candidate);
		if (isEqual(dirname(candidate), candidate)) {
			break;
		}
	}
	const edits: IBaseHalfNoteRouteEdit[] = [];
	for (const { at, destination, link } of links) {
		if (await fileService.exists(joinPath(folder, ...link.path.split('/')))) {
			continue;
		}
		for (const home of homes) {
			if (!await fileService.exists(joinPath(home, ...BASEHALF_NOTE_FILES_STORE_PATH, link.folder, link.file))) {
				continue;
			}
			// The route is a `../` for each folder between the home and the note, written in the place of the old one.
			const steps = (relativePath(home, folder) ?? '').split('/').filter(segment => segment !== '').length;
			const start = destination.startsWith('<') ? 1 : 0;
			const end = destination.indexOf('.bh/attachments/');
			if (end >= start) {
				const route = '../'.repeat(steps);
				if (destination.slice(start, end) !== route) {
					edits.push({ at: at + start, length: end - start, text: route });
				}
			}
			break;
		}
	}
	return edits;
}

/** `markdown` with `edits`, which do not overlap, made. */
export function baseHalfApplyNoteRouteEdits(markdown: string, edits: readonly IBaseHalfNoteRouteEdit[]): string {
	let text = markdown;
	for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
		text = text.slice(0, edit.at) + edit.text + text.slice(edit.at + edit.length);
	}
	return text;
}

async function gitIsBusy(fileService: IFileService, workspaceFolder: URI, note: URI): Promise<boolean> {
	for (let folder = dirname(note); isEqualOrParent(folder, workspaceFolder); folder = dirname(folder)) {
		const git = joinPath(folder, '.git');
		const stat = await fileService.stat(git).catch(() => undefined);
		if (stat?.isDirectory) {
			for (const name of GIT_BUSY) {
				if (await fileService.exists(joinPath(git, name))) {
					return true;
				}
			}
			return false;
		}
		if (stat || isEqual(folder, workspaceFolder)) {
			return false;
		}
	}
	return false;
}
