/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { basename, dirname, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from '../../workspace/common/basehalfMirrorTree.js';
import { baseHalfCloneNoteFileEditRecord, baseHalfMarkdownAttachmentHref, baseHalfNoteHome } from './basehalfMarkdownAttachment.js';
import { baseHalfNoteLinkDestinationRanges, baseHalfNoteStoreLink } from './basehalfNoteFileLinks.js';
import { BASEHALF_NO_WORKSPACE_SETUP_MARKER, BASEHALF_NOTE_FILES_STORE_PATH, baseHalfNoteFreeName, newBaseHalfNoteFolderName } from './basehalfNoteFiles.js';
import { IBaseHalfNoteRouteEdit, baseHalfApplyNoteRouteEdits } from './basehalfNoteFileRoutes.js';

// Copies that BaseHalf makes of notes (files in notes, rule 33): each copied
// note gets its own folder in the store of its home, the stored files its
// links name are cloned there with their edit records, and the copy's links
// are pointed at the clones before any editor holds it. The original, its
// files, and their records are untouched.

export interface IBaseHalfNoteFileCopyServices {
	readonly fileService: IFileService;
	readonly fileClonesService: IBaseHalfFileClonesService;
	/** The workspace folder that holds a file, if one does. */
	readonly workspaceFolderOf: (resource: URI) => URI | undefined;
}

/** How many notes one copied folder gives their own files at most. */
const MAX_NOTES = 2000;

/** The folders a walk of a copied folder does not enter: BaseHalf's own, git's, and packages. */
const SKIPPED = new Set(['.bh', '.git', 'node_modules']);

/**
 * Gives each note that `copies` made, a copied note or a note in a copied
 * folder, its own folder of clones of the stored files its links name, and
 * points its links at them. A file that could not be cloned is left linked
 * where the original links it, from the copy's place. Resolves with the
 * copies that could not get all their files.
 */
export async function baseHalfCopyNoteFiles(services: IBaseHalfNoteFileCopyServices, copies: readonly { readonly source?: URI; readonly target: URI }[]): Promise<URI[]> {
	const failed: URI[] = [];
	for (const { source, target } of copies) {
		if (!source) {
			continue;
		}
		for (const [from, to] of await notesOf(services.fileService, source, target)) {
			try {
				if (!await copyNoteFiles(services, from, to, target)) {
					failed.push(to);
				}
			} catch {
				failed.push(to);
			}
		}
	}
	return failed;
}

/** The notes a copy made, each beside the note it copies: the copy itself, or the notes below a copied folder. */
async function notesOf(fileService: IFileService, source: URI, target: URI): Promise<[URI, URI][]> {
	const stat = await fileService.stat(target).catch(() => undefined);
	if (!stat) {
		return [];
	}
	if (!stat.isDirectory) {
		return isNote(target) ? [[source, target]] : [];
	}
	const found: [URI, URI][] = [];
	const walk = async (folder: URI): Promise<void> => {
		const listing = await fileService.resolve(folder).catch(() => undefined);
		for (const child of listing?.children ?? []) {
			if (found.length >= MAX_NOTES) {
				return;
			}
			if (child.isDirectory) {
				if (!SKIPPED.has(child.name)) {
					await walk(child.resource);
				}
			} else if (isNote(child.resource)) {
				const path = relativePath(target, child.resource);
				if (path) {
					found.push([joinPath(source, ...path.split('/')), child.resource]);
				}
			}
		}
	};
	await walk(target);
	return found;
}

function isNote(resource: URI): boolean {
	return /\.(?:md|markdown)$/i.test(basename(resource));
}

/**
 * Clones the stored files that the copy `to` of the note `from` links into a
 * new folder of its home's store, with their edit records, and points its
 * links at them. A link that names a file the copied folder `copied` holds,
 * as its own store copied along, is the copy's own already. Gives false when
 * a file could not be cloned.
 */
async function copyNoteFiles(services: IBaseHalfNoteFileCopyServices, from: URI, to: URI, copied: URI): Promise<boolean> {
	const { fileService } = services;
	const workspaceFolder = services.workspaceFolderOf(to);
	if (!workspaceFolder || await fileService.exists(joinPath(workspaceFolder, BASEHALF_NO_WORKSPACE_SETUP_MARKER))) {
		return true;
	}
	const markdown = (await fileService.readFile(to)).value.toString();
	const links = baseHalfNoteLinkDestinationRanges(markdown).flatMap(({ at, destination }) => {
		const link = baseHalfNoteStoreLink(destination);
		return link ? [{ at, destination, link }] : [];
	});
	if (links.length === 0) {
		return true;
	}
	const home = await baseHalfNoteHome(fileService, to, workspaceFolder);
	if (await fileService.exists(joinPath(home, BASEHALF_NO_WORKSPACE_SETUP_MARKER))) {
		return true;
	}
	let folder: URI | undefined;
	const taken = new Set<string>();
	const clones = new ResourceMap<URI | null>();
	let complete = true;
	const edits: IBaseHalfNoteRouteEdit[] = [];
	for (const { at, destination, link } of links) {
		const original = joinPath(dirname(from), ...link.path.split('/'));
		const own = joinPath(dirname(to), ...link.path.split('/'));
		if (isEqualOrParent(own, copied) && await fileService.exists(own)) {
			continue;
		}
		let clone = clones.get(original);
		if (clone === undefined) {
			clone = null;
			if (await fileService.exists(original)) {
				try {
					folder ??= await newFolder(fileService, home);
					const name = baseHalfNoteFreeName(basename(original), taken);
					taken.add(name.toLowerCase());
					clone = joinPath(folder, name);
					await services.fileClonesService.clone(original, clone);
					await baseHalfCloneNoteFileEditRecord(services, workspaceFolder, original, clone);
				} catch {
					clone = null;
					complete = false;
				}
			}
			clones.set(original, clone);
		}
		// A file that could not be cloned stays the original's, linked from the copy's place (rule 33).
		const target = clone ?? (await fileService.exists(original) ? original : undefined);
		if (target) {
			edits.push({ at, length: destination.length, text: baseHalfMarkdownAttachmentHref(to, target) });
		}
	}
	const text = baseHalfApplyNoteRouteEdits(markdown, edits);
	if (text !== markdown) {
		await fileService.writeFile(to, VSBuffer.fromString(text));
	}
	return complete;
}

/** A new folder in the store of `home`, with the store's ignore file. */
async function newFolder(fileService: IFileService, home: URI): Promise<URI> {
	const store = joinPath(home, ...BASEHALF_NOTE_FILES_STORE_PATH);
	await baseHalfEnsureMirrorIgnoreFile(fileService, home);
	for (; ;) {
		const folder = joinPath(store, newBaseHalfNoteFolderName());
		if (!await fileService.exists(folder)) {
			await baseHalfAssertBhPathComponentsNotSymbolicLink(fileService, home, folder);
			await fileService.createFolder(folder);
			return folder;
		}
	}
}
