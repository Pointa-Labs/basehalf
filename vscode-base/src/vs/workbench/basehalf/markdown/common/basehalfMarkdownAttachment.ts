/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { basename, dirname, isEqual, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { FileOperationError, FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from '../../workspace/common/basehalfMirrorTree.js';
import { BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES, IBaseHalfMarkdownRichNoteItem, IBaseHalfMarkdownRichNoteItemFailure } from './basehalfMarkdownRichWebviewProtocol.js';
import { baseHalfNoteStoreLinks } from './basehalfNoteFileLinks.js';
import {
	BASEHALF_NO_WORKSPACE_SETUP_MARKER,
	BASEHALF_NOTE_FILES_STORE_PATH,
	baseHalfNoteFileName,
	baseHalfNoteFreeName,
	baseHalfNoteUntitledPictureName,
	isBaseHalfNoteUnnamedPicture,
	newBaseHalfNoteFolderName
} from './basehalfNoteFiles.js';
import { baseHalfMarkdownPathHref } from './basehalfNoteMarkdownText.js';

// The store of a note's files (files in notes, rules 1 to 13): a file put
// into a note goes into the note's own folder, `.bh/attachments/<folder>/`,
// in the store of the note's home, and the note links it relative to itself.

export interface IBaseHalfStoredMarkdownAttachment {
	readonly resource: URI;
	/** The note's link to it, relative to the note's folder, in the one encoding (rule 19). */
	readonly href: string;
	/** The stored file's name, which its block shows (rule 21). */
	readonly name: string;
}

export const IBaseHalfMarkdownAttachmentService = createDecorator<IBaseHalfMarkdownAttachmentService>('baseHalfMarkdownAttachmentService');

export interface IBaseHalfMarkdownAttachmentService {
	readonly _serviceBrand: undefined;

	/**
	 * Keeps `data`, a file put into the note `documentResource` whose text is
	 * `noteText`, in the note's own folder, and gives the note's link to it.
	 */
	store(documentResource: URI, noteText: string, name: string, mediaType: string, data: ArrayBuffer): Promise<IBaseHalfStoredMarkdownAttachment>;

	/**
	 * Puts the files and folders `resources`, in their order, into the note
	 * (rules 12, 14, and 15): an item of the note's workspace folder, and a
	 * file in the note's own folder, is linked where it is, and a file from
	 * elsewhere, or under `.bh/` as another note's file, is cloned into the
	 * note's own folder, its bytes never through the editor. Gives each item's
	 * block and the words of each that failed.
	 */
	items(documentResource: URI, noteText: string, resources: readonly URI[]): Promise<IBaseHalfNoteItems>;
}

export interface IBaseHalfNoteItems {
	readonly items: readonly IBaseHalfMarkdownRichNoteItem[];
	readonly failures: readonly IBaseHalfMarkdownRichNoteItemFailure[];
}

/** A failure to put a file into a note, in plain words, with no path under `.bh` (rule 49). */
export class BaseHalfNoteFileError extends Error { }

/** How many names are tried when other writes take them first. */
const NAME_ATTEMPTS = 50;

export class BaseHalfMarkdownAttachmentService implements IBaseHalfMarkdownAttachmentService {
	declare readonly _serviceBrand: undefined;

	/** The folder this window last put each note's file into: a file put in before the note links the one before it goes there too. */
	private readonly lastFolders = new ResourceMap<URI>();
	/** The files being put into each note, one after another, so that two at once find the same folder. */
	private readonly queues = new ResourceMap<Promise<unknown>>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IBaseHalfFileClonesService private readonly fileClonesService: IBaseHalfFileClonesService
	) { }

	store(documentResource: URI, noteText: string, name: string, mediaType: string, data: ArrayBuffer, now = new Date()): Promise<IBaseHalfStoredMarkdownAttachment> {
		const own = isBaseHalfNoteUnnamedPicture(name, mediaType) ? baseHalfNoteUntitledPictureName(now, name, mediaType) : baseHalfNoteFileName(name);
		if (data.byteLength > BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES) {
			return Promise.reject(new BaseHalfNoteFileError(`Could not add ${own}: a note takes files of at most ${Math.floor(BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`));
		}
		const bytes = VSBuffer.wrap(new Uint8Array(data));
		return this.inQueue(documentResource, () => this.storeNow(documentResource, noteText, own, async target => {
			try {
				// A file in the store is never overwritten (rule 11).
				await this.fileService.createFile(target, bytes, { overwrite: false });
				return true;
			} catch (error) {
				if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
					return false;
				}
				throw error;
			}
		}));
	}

	async items(documentResource: URI, noteText: string, resources: readonly URI[]): Promise<IBaseHalfNoteItems> {
		const workspaceFolder = this.contextService.getWorkspaceFolder(documentResource)?.uri;
		const items: IBaseHalfMarkdownRichNoteItem[] = [];
		const failures: IBaseHalfMarkdownRichNoteItemFailure[] = [];
		for (const resource of resources) {
			const name = basename(resource);
			try {
				const isFolder = (await this.fileService.stat(resource)).isDirectory;
				if (workspaceFolder && this.isItemOf(resource, workspaceFolder)) {
					// Linked where it is: nothing is copied or moved, also when it was cut (rule 15).
					items.push({ kind: isFolder || /\.(?:md|markdown)$/i.test(name) ? 'link' : 'file', url: baseHalfMarkdownAttachmentHref(documentResource, resource), name });
					continue;
				}
				if (!isFolder && this.isInOwnFolder(documentResource, noteText, resource)) {
					// The note's own file is not copied into the note again (rule 35).
					items.push({ kind: 'file', url: baseHalfMarkdownAttachmentHref(documentResource, resource), name });
					continue;
				}
				if (isFolder) {
					throw new BaseHalfNoteFileError(`Could not add ${name}: a folder from outside the open folder is not put into a note.`);
				}
				const stored = await this.inQueue(documentResource, () => this.storeNow(documentResource, noteText, baseHalfNoteFileName(name), async target => {
					try {
						// A clone where the disk can make one, which takes no room, a copy where it cannot (rule 12).
						await this.fileClonesService.clone(resource, target);
						return true;
					} catch (error) {
						if (/EEXIST/.test(error instanceof Error ? `${error.name} ${error.message}` : String(error))) {
							return false;
						}
						throw error;
					}
				}));
				items.push({ kind: 'file', url: stored.href, name: stored.name });
			} catch (error) {
				failures.push({ name, message: baseHalfNoteFileFailure(name, error) });
			}
		}
		return { items, failures };
	}

	/** Whether `resource` is in a folder of the store that the note's links name, or that this window last put a file of the note into. */
	private isInOwnFolder(note: URI, noteText: string, resource: URI): boolean {
		const folder = dirname(resource);
		const last = this.lastFolders.get(note);
		return (!!last && isEqual(last, folder))
			|| baseHalfNoteStoreLinks(noteText).some(link => isEqual(joinPath(dirname(note), ...`${link.route}.bh/attachments/${link.folder}`.split('/')), folder));
	}

	/** Whether `resource` is an item of the workspace folder that a note links where it is: inside it, and not under `.bh/`. */
	private isItemOf(resource: URI, workspaceFolder: URI): boolean {
		const path = isEqualOrParent(resource, workspaceFolder) ? relativePath(workspaceFolder, resource) : undefined;
		return path !== undefined && !path.split('/').includes('.bh');
	}

	/** Runs `put` after the files put into the note before it, so that two at once find the same folder. */
	private inQueue<T>(documentResource: URI, put: () => Promise<T>): Promise<T> {
		const stored = (this.queues.get(documentResource) ?? Promise.resolve()).catch(() => undefined).then(put);
		this.queues.set(documentResource, stored);
		void stored.finally(() => {
			if (this.queues.get(documentResource) === stored) {
				this.queues.delete(documentResource);
			}
		}).catch(() => undefined);
		return stored;
	}

	/**
	 * Puts a file named `own` into the note's folder with `write`, which
	 * writes it at a target and gives false when another write took the name
	 * first.
	 */
	private async storeNow(documentResource: URI, noteText: string, own: string, write: (target: URI) => Promise<boolean>): Promise<IBaseHalfStoredMarkdownAttachment> {
		const refuse = (reason: string) => new BaseHalfNoteFileError(`Could not add ${own}: ${reason}.`);
		const workspaceFolder = this.contextService.getWorkspaceFolder(documentResource)?.uri;
		if (!workspaceFolder) {
			// BaseHalf makes no `.bh/` outside the workspace folder (rule 2).
			throw refuse('the note is not in the open folder');
		}
		const home = await this.homeOf(documentResource, workspaceFolder);
		if (await this.isMarked(workspaceFolder) || await this.isMarked(home)) {
			throw refuse('files cannot be put into notes in this folder');
		}
		const folder = await this.folderOf(documentResource, noteText, home, workspaceFolder);
		const storeHome = dirname(dirname(dirname(folder)));
		// The first file of a home makes its store, with the ignore file (rules 2, 3, and 45).
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, storeHome);
		await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, storeHome, folder);
		await this.fileService.createFolder(folder);
		for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
			const fileName = baseHalfNoteFreeName(own, await this.namesIn(folder));
			const target = joinPath(folder, fileName);
			if (!await write(target)) {
				continue;
			}
			this.lastFolders.set(documentResource, folder);
			return { resource: target, href: baseHalfMarkdownAttachmentHref(documentResource, target), name: fileName };
		}
		throw refuse('its name is taken');
	}

	private homeOf(note: URI, workspaceFolder: URI): Promise<URI> {
		return baseHalfNoteHome(this.fileService, note, workspaceFolder);
	}

	private isMarked(folder: URI): Promise<boolean> {
		return this.fileService.exists(joinPath(folder, BASEHALF_NO_WORKSPACE_SETUP_MARKER));
	}

	/**
	 * The note's folder: the first folder named by its links into the store
	 * that exists, in the store of the workspace folder, of a folder inside
	 * it, or of a folder above it; else the folder this window last put a
	 * file of the note into, while it is there; else a new free folder in the
	 * home's store (rules 7, 8, and 48).
	 */
	private async folderOf(note: URI, noteText: string, home: URI, workspaceFolder: URI): Promise<URI> {
		for (const link of baseHalfNoteStoreLinks(noteText)) {
			const folder = joinPath(dirname(note), ...`${link.route}.bh/attachments/${link.folder}`.split('/'));
			const linkHome = dirname(dirname(dirname(folder)));
			const inReach = isEqualOrParent(linkHome, workspaceFolder) || isEqualOrParent(workspaceFolder, linkHome);
			if (inReach && await this.isFolder(folder)) {
				return folder;
			}
		}
		const last = this.lastFolders.get(note);
		if (last && await this.isFolder(last)) {
			return last;
		}
		const store = joinPath(home, ...BASEHALF_NOTE_FILES_STORE_PATH);
		for (; ;) {
			const candidate = joinPath(store, newBaseHalfNoteFolderName());
			if (!await this.fileService.exists(candidate)) {
				return candidate;
			}
		}
	}

	private async isFolder(resource: URI): Promise<boolean> {
		try {
			return (await this.fileService.stat(resource)).isDirectory;
		} catch {
			return false;
		}
	}

	/** The names in a note's folder, without case. */
	private async namesIn(folder: URI): Promise<Set<string>> {
		const stat = await this.fileService.resolve(folder).catch(() => undefined);
		return new Set((stat?.children ?? []).map(child => child.name.toLowerCase()));
	}
}

/**
 * The note's home: the nearest folder at or above the note, never above the
 * workspace folder, that holds `.bh/` or is the root of a git repository;
 * else the workspace folder (rules 1 and 2).
 */
export async function baseHalfNoteHome(fileService: IFileService, note: URI, workspaceFolder: URI): Promise<URI> {
	for (let folder = dirname(note); isEqualOrParent(folder, workspaceFolder) && !isEqual(folder, workspaceFolder); folder = dirname(folder)) {
		if (await fileService.exists(joinPath(folder, '.bh')) || await fileService.exists(joinPath(folder, '.git'))) {
			return folder;
		}
	}
	return workspaceFolder;
}

/**
 * What a failure to put `name` into a note says (rule 49): the store's own
 * reason, or a plain one for the disk's errors, whose messages hold paths.
 */
export function baseHalfNoteFileFailure(name: string, error: unknown): string {
	if (error instanceof BaseHalfNoteFileError) {
		return error.message;
	}
	const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	let reason = 'it could not be saved';
	if (/ENOSPC|EntryExceedsStorageQuota|quota/i.test(text)) {
		reason = 'the disk is full';
	} else if (error instanceof Error && [FileOperationResult.FILE_PERMISSION_DENIED, FileOperationResult.FILE_WRITE_LOCKED].includes(toFileOperationResult(error))) {
		reason = 'BaseHalf may not write into this folder';
	}
	return `Could not add ${name}: ${reason}.`;
}

/** The note's link to a file: its path relative to the note's folder, in the one encoding (files in notes, rule 19). */
export function baseHalfMarkdownAttachmentHref(documentResource: URI, attachmentResource: URI): string {
	const path = relativePath(dirname(documentResource), attachmentResource) ?? attachmentResource.path;
	return baseHalfMarkdownPathHref(path);
}

registerSingleton(IBaseHalfMarkdownAttachmentService, BaseHalfMarkdownAttachmentService, InstantiationType.Delayed);
