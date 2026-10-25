/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfIsMirrorSubtree, baseHalfMirrorPathSegments, baseHalfWalkMirror } from '../../workspace/common/basehalfMirrorTree.js';
import { BASEHALF_EDIT_RECORD_FILE, baseHalfIsEditOriginalName, parseBaseHalfEditRecord } from './basehalfEditRecord.js';

/** How long an original stays while its file is gone (editing media, "When the file is gone"). */
export const BASEHALF_GONE_ORIGINAL_MS = 30 * 24 * 60 * 60 * 1000;

/** Since when the file of each original was gone, by the file's path, as this computer saw it. */
const NOTES_FILE = 'gone-originals.json';
/** Names of an original beside its file, from `shot original.mp4` on. */
const MAX_NAMES = 100;

export interface IBaseHalfOriginalReleaseServices {
	readonly fileService: IFileService;
	/** Whether what is deleted in the workspace folder goes to the Trash. */
	readonly trash: boolean;
	/** Following moved items is told that what disappears is no move to recognize. */
	readonly acceptWorkbenchDelete: (workspaceFolder: URI, path: string) => void;
}

export interface IBaseHalfGoneOriginalsServices extends IBaseHalfOriginalReleaseServices {
	readonly logService: ILogService;
	readonly now?: () => number;
}

/**
 * The name an original takes when it leaves BaseHalf, after its file:
 * `shot original.mp4`, and from the second on with a number,
 * `shot original 2.mp4`.
 */
export function baseHalfOriginalFileName(fileName: string, originalName: string, index = 1): string {
	const dot = fileName.lastIndexOf('.');
	const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
	const extensionDot = originalName.lastIndexOf('.');
	const extension = extensionDot >= 0 ? originalName.slice(extensionDot) : '';
	return `${stem} original${index > 1 ? ` ${index}` : ''}${extension}`;
}

/**
 * Sends an original that no file is the edit of any more to the Trash, as an
 * ordinary file named after its file. It goes from the folder that held the
 * file, so that Put Back returns it there (exact undo, "When the kept versions
 * go to the Trash"), or from where it is when that folder is gone. Without the
 * Trash it is deleted for good.
 */
export async function baseHalfReleaseEditOriginal(services: IBaseHalfOriginalReleaseServices, workspaceFolder: URI, filePath: string, original: URI): Promise<void> {
	const { fileService } = services;
	if (!services.trash) {
		await fileService.del(original);
		return;
	}
	const segments = baseHalfMirrorPathSegments(filePath);
	const fileName = segments[segments.length - 1] ?? basename(original);
	const home = URI.joinPath(workspaceFolder, ...segments.slice(0, -1));
	const beside = await fileService.exists(home) ? await freeName(fileService, home, fileName, basename(original)) : undefined;
	const target = beside ?? await freeName(fileService, dirname(original), fileName, basename(original));
	if (!target) {
		await fileService.del(original, { useTrash: true });
		return;
	}
	// The window is told nothing of its way there: it is no item of the workspace.
	await fileService.move(original, target, false, 'nothing');
	try {
		if (beside) {
			services.acceptWorkbenchDelete(workspaceFolder, [...segments.slice(0, -1), basename(beside)].join('/'));
		}
		await fileService.del(target, { useTrash: true });
	} catch (error) {
		// What the Trash refused stays where it was.
		await fileService.move(target, original, false, 'nothing');
		throw error;
	}
}

/**
 * At the open of a workspace folder, once following moved items has followed
 * what it recognized: notes each original whose file is not there, and sends
 * to the Trash, with its record deleted, every one whose file was gone at each
 * open for 30 days since the first (editing media, "When the file is gone").
 * An original gets no note while its path waits for its move (`waiting`), while
 * its file cannot be looked at, while a placeholder of a cloud folder holds the
 * file's place, or when its record cannot be read.
 */
export async function baseHalfNoteGoneOriginals(services: IBaseHalfGoneOriginalsServices, workspaceFolder: URI, waiting: readonly string[]): Promise<void> {
	const { fileService, logService } = services;
	if (await baseHalfIsWorkspaceFolderMarked(fileService, workspaceFolder)) {
		return;
	}
	const now = (services.now ?? Date.now)();
	const notesResource = joinPath(workspaceFolder, '.bh', 'cache', NOTES_FILE);
	const before = await readNotes(fileService, notesResource);
	const notes: Record<string, number> = {};
	let records;
	try {
		records = await baseHalfWalkMirror(fileService, workspaceFolder, BASEHALF_EDIT_RECORD_FILE);
	} catch (error) {
		logService.warn('[BaseHalf] could not look for the originals of files that are gone', error);
		return;
	}
	for (const entry of records) {
		const path = entry.relativePath;
		if (!path || waiting.some(from => baseHalfIsMirrorSubtree(path, from)) || await isGone(fileService, workspaceFolder, path) !== true || !await isReadable(fileService, entry.resource)) {
			continue;
		}
		const since = before[path] ?? now;
		if (now - since < BASEHALF_GONE_ORIGINAL_MS) {
			notes[path] = since;
			continue;
		}
		try {
			const listing = await fileService.resolve(dirname(entry.resource));
			for (const child of listing.children ?? []) {
				if (child.isFile && baseHalfIsEditOriginalName(child.name)) {
					await baseHalfReleaseEditOriginal(services, workspaceFolder, path, child.resource);
				}
			}
			await fileService.del(entry.resource);
			logService.info(`[BaseHalf] ${path} was gone for 30 days: its original went to the Trash`);
		} catch (error) {
			// The next open tries again.
			notes[path] = since;
			logService.warn(`[BaseHalf] could not send the original of ${path} to the Trash`, error);
		}
	}
	if (JSON.stringify(notes) !== JSON.stringify(before)) {
		await writeNotes(fileService, workspaceFolder, notesResource, notes).catch(error => logService.warn('[BaseHalf] could not note the originals of files that are gone', error));
	}
}

/** `true` when nothing is at the path, `false` when something is, and `undefined` when it cannot be looked at. */
async function isGone(fileService: IFileService, workspaceFolder: URI, path: string): Promise<boolean | undefined> {
	const segments = baseHalfMirrorPathSegments(path);
	try {
		await fileService.stat(URI.joinPath(workspaceFolder, ...segments));
		return false;
	} catch (error) {
		if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND) {
			return undefined;
		}
	}
	// A cloud folder that took the file off the disk leaves a placeholder in its place.
	const placeholder = URI.joinPath(workspaceFolder, ...segments.slice(0, -1), `.${segments[segments.length - 1]}.icloud`);
	return !await fileService.exists(placeholder);
}

async function isReadable(fileService: IFileService, record: URI): Promise<boolean> {
	try {
		return !!parseBaseHalfEditRecord((await fileService.readFile(record)).value.toString());
	} catch {
		return false;
	}
}

async function freeName(fileService: IFileService, folder: URI, fileName: string, originalName: string): Promise<URI | undefined> {
	for (let index = 1; index <= MAX_NAMES; index++) {
		const candidate = joinPath(folder, baseHalfOriginalFileName(fileName, originalName, index));
		if (!await fileService.exists(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

async function readNotes(fileService: IFileService, resource: URI): Promise<Record<string, number>> {
	try {
		const value: unknown = JSON.parse((await fileService.readFile(resource)).value.toString());
		const notes: Record<string, number> = {};
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			for (const [path, since] of Object.entries(value)) {
				if (typeof since === 'number' && Number.isFinite(since)) {
					notes[path] = since;
				}
			}
		}
		return notes;
	} catch {
		return {};
	}
}

async function writeNotes(fileService: IFileService, workspaceFolder: URI, resource: URI, notes: Record<string, number>): Promise<void> {
	if (!Object.keys(notes).length) {
		await fileService.del(resource).catch(() => undefined);
		return;
	}
	// The notes are of this computer: git must not show them.
	await baseHalfEnsureMirrorIgnoreFile(fileService, workspaceFolder);
	await fileService.writeFile(resource, VSBuffer.fromString(JSON.stringify(notes, undefined, '\t')));
}
