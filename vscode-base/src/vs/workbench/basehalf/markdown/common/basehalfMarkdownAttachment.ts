/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { dirname, isEqual, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from '../../workspace/common/basehalfMirrorTree.js';
import { BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES } from './basehalfMarkdownRichWebviewProtocol.js';
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
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService
	) { }

	store(documentResource: URI, noteText: string, name: string, mediaType: string, data: ArrayBuffer, now = new Date()): Promise<IBaseHalfStoredMarkdownAttachment> {
		const stored = (this.queues.get(documentResource) ?? Promise.resolve()).catch(() => undefined).then(() => this.storeNow(documentResource, noteText, name, mediaType, data, now));
		this.queues.set(documentResource, stored);
		void stored.finally(() => {
			if (this.queues.get(documentResource) === stored) {
				this.queues.delete(documentResource);
			}
		}).catch(() => undefined);
		return stored;
	}

	private async storeNow(documentResource: URI, noteText: string, name: string, mediaType: string, data: ArrayBuffer, now: Date): Promise<IBaseHalfStoredMarkdownAttachment> {
		const own = isBaseHalfNoteUnnamedPicture(name, mediaType) ? baseHalfNoteUntitledPictureName(now, name, mediaType) : baseHalfNoteFileName(name);
		const refuse = (reason: string) => new BaseHalfNoteFileError(`Could not add ${own}: ${reason}.`);
		if (data.byteLength > BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES) {
			throw refuse(`a note takes files of at most ${Math.floor(BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`);
		}
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
		const bytes = VSBuffer.wrap(new Uint8Array(data));
		for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
			const fileName = baseHalfNoteFreeName(own, await this.namesIn(folder));
			const target = joinPath(folder, fileName);
			try {
				// A file in the store is never overwritten (rule 11).
				await this.fileService.createFile(target, bytes, { overwrite: false });
			} catch (error) {
				if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
					continue;
				}
				throw error;
			}
			this.lastFolders.set(documentResource, folder);
			return { resource: target, href: baseHalfMarkdownAttachmentHref(documentResource, target), name: fileName };
		}
		throw refuse('its name is taken');
	}

	/**
	 * The note's home: the nearest folder at or above the note, never above
	 * the workspace folder, that holds `.bh/` or is the root of a git
	 * repository; else the workspace folder.
	 */
	private async homeOf(note: URI, workspaceFolder: URI): Promise<URI> {
		for (let folder = dirname(note); isEqualOrParent(folder, workspaceFolder) && !isEqual(folder, workspaceFolder); folder = dirname(folder)) {
			if (await this.fileService.exists(joinPath(folder, '.bh')) || await this.fileService.exists(joinPath(folder, '.git'))) {
				return folder;
			}
		}
		return workspaceFolder;
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
