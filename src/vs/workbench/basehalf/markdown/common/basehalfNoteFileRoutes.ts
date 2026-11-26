/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { ResourceMap } from '../../../../base/common/map.js';
import { basename, dirname, isEqual, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from '../../workspace/common/basehalfMirrorTree.js';
import { baseHalfCloneNoteFileEditRecord, baseHalfMarkdownAttachmentHref, baseHalfNoteHome } from './basehalfMarkdownAttachment.js';
import { baseHalfNoteLinkDestinationRanges, baseHalfNoteStoreLink } from './basehalfNoteFileLinks.js';
import { BASEHALF_NO_WORKSPACE_SETUP_MARKER, BASEHALF_NOTE_FILES_STORE_PATH, baseHalfNoteFreeName, newBaseHalfNoteFolderName } from './basehalfNoteFiles.js';

// Route corrections (files in notes, rules 28 to 31): a note moved to another
// depth keeps its folder in the store; only the `../` before `.bh` of each of
// its links into the store changes, and only for a link that leads nowhere.
// A link whose files are in another home's store, or in a store beside the
// note, gets clones in the note's home instead.

/** One change of a note's text: `length` characters at `at` become `text`. */
export interface IBaseHalfNoteRouteEdit {
	readonly at: number;
	readonly length: number;
	readonly text: string;
}

export interface IBaseHalfNoteFileRouteServices {
	readonly fileService: IFileService;
	/** Clones the files of another store into the note's home; without it, nothing is cloned. */
	readonly fileClonesService?: IBaseHalfFileClonesService;
	/** The stores BaseHalf knows of the workspace's folders, read once a note needs them (rule 30). */
	readonly knownStores?: () => Promise<readonly URI[]>;
}

/** What git leaves in its folder while an operation is in the middle (rule 30). */
const GIT_BUSY: readonly string[] = ['index.lock', 'MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'];

/** How many folders of a workspace folder are looked through for its stores (rule 30). */
export const BASEHALF_NOTE_STORE_SEARCH_FOLDERS = 5000;

/**
 * The edits that keep each link of the note `note`, whose text is
 * `markdown`, into a store that leads nowhere working (rules 30 and 31). A
 * link whose key is in the store of the note's home, or in a store above the
 * workspace folder (rule 48), the nearest first, gets the route to it. A
 * link whose key is in another store BaseHalf knows, of another home above
 * the note or beside it, gets its file cloned, with its edit record, into a
 * new folder of the home's store, one for the note, and is pointed there; so
 * does a link that leads into the store of another home of the workspace
 * folder, as a note's link does after a move down into a repository outside
 * BaseHalf. Any other link that leads somewhere, or whose key no store holds,
 * is left as it is. Nothing is edited in a marked folder or while git is in
 * the middle of an operation in the note's repository.
 */
export async function baseHalfNoteFileRouteEdits(services: IBaseHalfNoteFileRouteServices, workspaceFolder: URI, note: URI, markdown: string): Promise<IBaseHalfNoteRouteEdit[]> {
	const { fileService } = services;
	const links = baseHalfNoteLinkDestinationRanges(markdown).flatMap(({ at, destination }) => {
		const link = baseHalfNoteStoreLink(destination);
		return link ? [{ at, destination, link }] : [];
	});
	if (links.length === 0 || !isEqualOrParent(note, workspaceFolder) || await fileService.exists(joinPath(workspaceFolder, BASEHALF_NO_WORKSPACE_SETUP_MARKER)) || await gitIsBusy(fileService, workspaceFolder, note)) {
		return [];
	}
	const folder = dirname(note);
	const home = await baseHalfNoteHome(fileService, note, workspaceFolder);
	if (await fileService.exists(joinPath(home, BASEHALF_NO_WORKSPACE_SETUP_MARKER))) {
		return [];
	}
	// Where a route may lead: the home's store, then the stores above the workspace folder.
	const routed: URI[] = [home];
	// Where files are cloned from: the other homes above the note, then the stores BaseHalf knows.
	const cloned: URI[] = [];
	for (let candidate = dirname(home); ; candidate = dirname(candidate)) {
		(isEqualOrParent(candidate, workspaceFolder) ? cloned : routed).push(candidate);
		if (isEqual(dirname(candidate), candidate)) {
			break;
		}
	}
	const homeStore = joinPath(home, ...BASEHALF_NOTE_FILES_STORE_PATH);
	const clones = new BaseHalfNoteFileClones(services, workspaceFolder, home);
	const edits: IBaseHalfNoteRouteEdit[] = [];
	for (const { at, destination, link } of links) {
		const linked = joinPath(folder, ...link.path.split('/'));
		if (await fileService.exists(linked)) {
			// The store of the home the note left, or of a home inside it: the note's home holds what the note shows (rule 31).
			const linkedHome = joinPath(folder, ...link.route.split('/').filter(segment => segment !== ''));
			if (services.fileClonesService && isEqualOrParent(linkedHome, workspaceFolder) && !isEqual(linkedHome, home)) {
				const clone = await clones.clone(linked);
				if (clone) {
					edits.push({ at, length: destination.length, text: baseHalfMarkdownAttachmentHref(note, clone) });
				}
			}
			continue;
		}
		const key = [link.folder, link.file];
		const route = await firstAsync(routed, async candidate => await fileService.exists(joinPath(candidate, ...BASEHALF_NOTE_FILES_STORE_PATH, ...key)) ? candidate : undefined);
		if (route) {
			// The route is a `../` for each folder between the home and the note, written in the place of the old one.
			const steps = (relativePath(route, folder) ?? '').split('/').filter(segment => segment !== '').length;
			const start = destination.startsWith('<') ? 1 : 0;
			const end = destination.indexOf('.bh/attachments/');
			if (end >= start) {
				const text = '../'.repeat(steps);
				if (destination.slice(start, end) !== text) {
					edits.push({ at: at + start, length: end - start, text });
				}
			}
			continue;
		}
		if (!services.fileClonesService) {
			continue;
		}
		const stores = [...cloned.map(candidate => joinPath(candidate, ...BASEHALF_NOTE_FILES_STORE_PATH)), ...(await clones.knownStores()).filter(store => !isEqual(store, homeStore))];
		const original = await firstAsync(stores, async store => {
			const file = joinPath(store, ...key);
			return await fileService.exists(file) ? file : undefined;
		});
		const clone = original && await clones.clone(original);
		if (clone) {
			edits.push({ at, length: destination.length, text: baseHalfMarkdownAttachmentHref(note, clone) });
		}
	}
	return edits;
}

/**
 * The stores at or below a workspace folder, `.bh/attachments` of each
 * folder that has one, found in its first `limit` folders, outside `.git`,
 * `node_modules`, and folders reached through links (rule 30).
 */
export async function baseHalfNoteStoresBelow(fileService: IFileService, workspaceFolder: URI, limit = BASEHALF_NOTE_STORE_SEARCH_FOLDERS): Promise<URI[]> {
	const stores: URI[] = [];
	const queue = [workspaceFolder];
	for (let read = 0; queue.length > 0 && read < limit; read++) {
		const listing = await fileService.resolve(queue.shift()!).catch(() => undefined);
		for (const child of listing?.children ?? []) {
			if (!child.isDirectory || child.isSymbolicLink) {
				continue;
			}
			if (child.name === '.bh') {
				const store = joinPath(child.resource, BASEHALF_NOTE_FILES_STORE_PATH[1]);
				if (await fileService.exists(store)) {
					stores.push(store);
				}
			} else if (child.name !== '.git' && child.name !== 'node_modules') {
				queue.push(child.resource);
			}
		}
	}
	return stores;
}

/**
 * Clones of stored files into one new folder of a home's store, made when
 * the first is asked for, each file once, with its edit record (rules 31 and
 * 33). Gives none for a file that could not be cloned.
 */
export class BaseHalfNoteFileClones {
	private folder: URI | undefined;
	private readonly taken = new Set<string>();
	private readonly clones = new ResourceMap<Promise<URI | undefined>>();
	private stores: Promise<readonly URI[]> | undefined;

	constructor(
		private readonly services: IBaseHalfNoteFileRouteServices,
		private readonly workspaceFolder: URI,
		private readonly home: URI
	) { }

	/** Whether a file could not be cloned. */
	incomplete = false;

	knownStores(): Promise<readonly URI[]> {
		this.stores ??= this.services.knownStores?.().catch(() => []) ?? Promise.resolve([]);
		return this.stores;
	}

	clone(original: URI): Promise<URI | undefined> {
		let clone = this.clones.get(original);
		if (!clone) {
			clone = this.make(original);
			this.clones.set(original, clone);
		}
		return clone;
	}

	private async make(original: URI): Promise<URI | undefined> {
		const { fileService, fileClonesService } = this.services;
		if (!fileClonesService) {
			return undefined;
		}
		try {
			this.folder ??= await newFolder(fileService, this.home);
			const name = baseHalfNoteFreeName(basename(original), this.taken);
			this.taken.add(name.toLowerCase());
			const clone = joinPath(this.folder, name);
			await fileClonesService.clone(original, clone);
			await baseHalfCloneNoteFileEditRecord({ fileService, fileClonesService }, this.workspaceFolder, original, clone);
			return clone;
		} catch {
			this.incomplete = true;
			return undefined;
		}
	}
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

/** The first answer of `find` for the items in order, asked one after another. */
async function firstAsync<T, R>(items: readonly T[], find: (item: T) => Promise<R | undefined>): Promise<R | undefined> {
	for (const item of items) {
		const found = await find(item);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
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
