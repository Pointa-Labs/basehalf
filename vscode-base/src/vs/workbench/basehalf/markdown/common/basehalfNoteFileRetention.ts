/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { isEqual, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { BASEHALF_NO_WORKSPACE_SETUP_MARKER } from './basehalfNoteFiles.js';

// Leaving (files in notes, rules 36 to 43): nothing deletes a note's file at
// once. A daily scan reads the text files of the workspace folder, notes when
// a stored file stopped being mentioned, and sends one that nothing mentioned
// for 30 days to the Trash, a whole folder as one item.

/** How long a stored file that nothing mentions stays (rule 43). */
export const BASEHALF_NOTE_FILE_RELEASE_MS = 30 * 24 * 60 * 60 * 1000;
/** A home is scanned at most once a day (rule 37). */
const SCAN_EVERY_MS = 24 * 60 * 60 * 1000;
/** The lock of a window that stopped while it scanned goes stale (rule 37). */
const LOCK_STALE_MS = 5 * 60 * 1000;
const NOTES_FILE = 'note-files.json';
const LOCK_FILE = 'note-files.lock';

/** The files whose text can mention a note's file (rule 37). */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.json', '.yaml', '.yml', '.csv', '.xml', '.org', '.rst', '.adoc', '.tex', '.ipynb']);
/** Folders that hold no one's notes. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['.git', 'node_modules']);
/** How much of the text after a mention's folder is compared with the names of its files. */
const MENTION_WINDOW = 1100;

export interface IBaseHalfNoteFileScanLimits {
	readonly files: number;
	readonly fileBytes: number;
	readonly totalBytes: number;
}

const LIMITS: IBaseHalfNoteFileScanLimits = { files: 50_000, fileBytes: 32 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 };

export interface IBaseHalfNoteFileRetentionServices {
	readonly fileService: IFileService;
	readonly logService: ILogService;
	/** Whether what is released goes to the Trash; else it is deleted. */
	readonly trash: boolean;
	readonly now?: () => number;
	/** The text of the notes open in this window, saved or not. */
	readonly openTexts?: () => readonly string[];
	readonly limits?: IBaseHalfNoteFileScanLimits;
}

/**
 * What a scan did: `released` and `noted` read everything; the others
 * released nothing, `unread` and `limit` after noting what they found.
 */
export type BaseHalfNoteFileScanOutcome = 'released' | 'noted' | 'unread' | 'limit' | 'cloud' | 'marked' | 'recent' | 'locked' | 'none';

export interface IBaseHalfNoteFileScanResult {
	readonly outcome: BaseHalfNoteFileScanOutcome;
	/** What went to the Trash, by its path in the workspace folder. */
	readonly released: readonly string[];
}

interface INoteFilesRecord {
	readonly scanned?: number;
	/** Since when nothing mentions each stored file, by its path in the workspace folder. */
	readonly unmentioned: Readonly<Record<string, number>>;
}

interface IStoredFile {
	/** Its path in the workspace folder, the key of its note. */
	readonly path: string;
	readonly resource: URI;
	readonly folder: URI;
	readonly folderName: string;
	readonly name: string;
}

interface IWalk {
	readonly texts: IFileStatWithMetadata[];
	readonly stores: URI[];
	readonly cloud: boolean;
	readonly overLimit: boolean;
}

/**
 * Scans the text files of `workspaceFolder` for mentions of the files in the
 * stores at and below it, notes since when each is not mentioned, and
 * releases those that nothing mentioned for 30 days (rules 37 to 43). A store
 * above the workspace folder is never touched (rule 41).
 */
export async function baseHalfReleaseUnmentionedNoteFiles(services: IBaseHalfNoteFileRetentionServices, workspaceFolder: URI): Promise<IBaseHalfNoteFileScanResult> {
	const { fileService } = services;
	const now = (services.now ?? Date.now)();
	const limits = services.limits ?? LIMITS;
	const nothing = (outcome: BaseHalfNoteFileScanOutcome): IBaseHalfNoteFileScanResult => ({ outcome, released: [] });
	if (await fileService.exists(joinPath(workspaceFolder, BASEHALF_NO_WORKSPACE_SETUP_MARKER))) {
		return nothing('marked');
	}
	// A folder the system keeps in the cloud is not read, so that nothing is downloaded (rule 39).
	if (/\/Library\/(?:Mobile Documents|CloudStorage)\//.test(`${workspaceFolder.path}/`)) {
		return nothing('cloud');
	}
	// Nothing is made in a folder that has no `.bh/` (rule 3).
	if (!await fileService.exists(joinPath(workspaceFolder, '.bh'))) {
		return nothing('none');
	}
	const cache = joinPath(workspaceFolder, '.bh', 'cache');
	const notesResource = joinPath(cache, NOTES_FILE);
	const before = await readNotes(fileService, notesResource);
	if (before.scanned !== undefined && now - before.scanned >= 0 && now - before.scanned < SCAN_EVERY_MS) {
		return nothing('recent');
	}
	await baseHalfEnsureMirrorIgnoreFile(fileService, workspaceFolder);
	const lock = joinPath(cache, LOCK_FILE);
	if (!await takeLock(fileService, lock, now)) {
		return nothing('locked');
	}
	try {
		return await scan(services, workspaceFolder, before, notesResource, now, limits);
	} finally {
		await fileService.del(lock).catch(() => undefined);
	}
}

async function scan(services: IBaseHalfNoteFileRetentionServices, workspaceFolder: URI, before: INoteFilesRecord, notesResource: URI, now: number, limits: IBaseHalfNoteFileScanLimits): Promise<IBaseHalfNoteFileScanResult> {
	const { fileService, logService } = services;
	let walked: IWalk;
	try {
		walked = await walk(fileService, workspaceFolder, limits);
	} catch (error) {
		logService.warn('[BaseHalf] could not list the notes that mention their files', error);
		return { outcome: 'unread', released: [] };
	}
	const stored = await storedFiles(fileService, workspaceFolder, walked.stores);
	const names = new Map<string, string[]>();
	for (const file of stored) {
		names.set(file.folderName, [...names.get(file.folderName) ?? [], file.name]);
	}
	const mentioned = new Set<string>();
	let unread = walked.overLimit;
	for (const text of walked.texts) {
		const content = await readText(fileService, text.resource);
		if (content === undefined) {
			unread = true;
			continue;
		}
		findMentions(content, names, mentioned);
	}
	for (const text of services.openTexts?.() ?? []) {
		findMentions(text, names, mentioned);
	}
	const unmentioned: Record<string, number> = {};
	for (const file of stored) {
		if (!mentioned.has(`${file.folderName}/${file.name}`)) {
			unmentioned[file.path] = before.unmentioned[file.path] ?? now;
		}
	}
	const complete = !unread && !walked.cloud;
	const due = complete ? stored.filter(file => unmentioned[file.path] !== undefined && now - unmentioned[file.path] >= BASEHALF_NOTE_FILE_RELEASE_MS) : [];
	const released: string[] = [];
	if (due.length > 0) {
		// Just before a release, what changed since the scan is read again (rule 42).
		for (const text of walked.texts) {
			const stat = await fileService.stat(text.resource).catch(() => undefined);
			if (stat && (stat.mtime !== text.mtime || stat.size !== text.size)) {
				const content = await readText(fileService, text.resource);
				if (content !== undefined) {
					findMentions(content, names, mentioned);
				}
			}
		}
		const releasing = due.filter(file => !mentioned.has(`${file.folderName}/${file.name}`));
		for (const item of releaseItems(stored, releasing)) {
			try {
				await release(services, workspaceFolder, item);
				released.push(relativePath(workspaceFolder, item) ?? item.path);
				for (const file of releasing) {
					if (isEqual(file.resource, item) || isEqual(file.folder, item)) {
						delete unmentioned[file.path];
					}
				}
			} catch (error) {
				// The next scan tries again.
				logService.warn('[BaseHalf] could not send a file no note mentions to the Trash', error);
			}
		}
	}
	await writeNotes(fileService, notesResource, { scanned: now, unmentioned }).catch(error => logService.warn('[BaseHalf] could not note the files no note mentions', error));
	if (released.length > 0) {
		logService.info(`[BaseHalf] ${released.length} file(s) no note mentioned for 30 days went to the Trash`);
	}
	return { outcome: unread ? (walked.overLimit ? 'limit' : 'unread') : walked.cloud ? 'cloud' : released.length > 0 ? 'released' : 'noted', released };
}

/** The text files of the workspace folder, with its kept versions, and the stores at and below it. */
async function walk(fileService: IFileService, workspaceFolder: URI, limits: IBaseHalfNoteFileScanLimits): Promise<IWalk> {
	const texts: IFileStatWithMetadata[] = [];
	const stores: URI[] = [];
	let cloud = false;
	let bytes = 0;
	const queue: URI[] = [workspaceFolder];
	while (queue.length > 0) {
		const folder = queue.shift()!;
		const stat = await fileService.resolve(folder, { resolveMetadata: true });
		for (const child of stat.children ?? []) {
			if (child.isSymbolicLink) {
				continue;
			}
			if (child.isDirectory) {
				if (child.name === '.bh') {
					if (await fileService.exists(joinPath(child.resource, 'attachments'))) {
						stores.push(joinPath(child.resource, 'attachments'));
					}
					// A deleted note waits in the kept versions, and its files with it (rule 36).
					const kept = joinPath(child.resource, 'cache', 'kept');
					if (isEqual(folder, workspaceFolder) && await fileService.exists(kept)) {
						queue.push(kept);
					}
				} else if (!SKIPPED_FOLDERS.has(child.name)) {
					queue.push(child.resource);
				}
				continue;
			}
			// What the system took off the disk into the cloud leaves a placeholder (rule 39).
			if (/^\..+\.icloud$/.test(child.name)) {
				cloud = true;
				continue;
			}
			const dot = child.name.lastIndexOf('.');
			if (dot > 0 && TEXT_EXTENSIONS.has(child.name.slice(dot).toLowerCase())) {
				bytes += child.size;
				if (texts.length >= limits.files || child.size > limits.fileBytes || bytes > limits.totalBytes) {
					return { texts, stores, cloud, overLimit: true };
				}
				texts.push(child);
			}
		}
	}
	return { texts, stores, cloud, overLimit: false };
}

async function storedFiles(fileService: IFileService, workspaceFolder: URI, stores: readonly URI[]): Promise<IStoredFile[]> {
	const files: IStoredFile[] = [];
	for (const store of stores) {
		const folders = await fileService.resolve(store).catch(() => undefined);
		for (const folder of folders?.children ?? []) {
			if (!folder.isDirectory || folder.isSymbolicLink) {
				continue;
			}
			const listing = await fileService.resolve(folder.resource).catch(() => undefined);
			for (const file of listing?.children ?? []) {
				const path = relativePath(workspaceFolder, file.resource);
				if (path && !file.isSymbolicLink) {
					files.push({ path, resource: file.resource, folder: folder.resource, folderName: folder.name.normalize('NFC'), name: file.name.normalize('NFC') });
				}
			}
		}
	}
	return files;
}

/**
 * Adds to `found` the key, `<folder>/<file>`, of each stored file that
 * `text` mentions after `attachments/` (rule 38): written as it is or
 * percent-encoded, in NFC or NFD. A false match only keeps a file longer.
 */
function findMentions(text: string, names: ReadonlyMap<string, readonly string[]>, found: Set<string>): void {
	if (names.size === 0) {
		return;
	}
	for (const marker of text.matchAll(/attachments(?:\/|%2f)/gi)) {
		const start = (marker.index ?? 0) + marker[0].length;
		const rest = text.slice(start, start + MENTION_WINDOW).split(/[\r\n]/, 1)[0];
		for (const candidate of new Set([rest.normalize('NFC'), decodeLeniently(rest).normalize('NFC')])) {
			const slash = candidate.indexOf('/');
			const files = slash > 0 ? names.get(candidate.slice(0, slash)) : undefined;
			for (const file of files ?? []) {
				if (candidate.startsWith(file, slash + 1)) {
					found.add(`${candidate.slice(0, slash)}/${file}`);
				}
			}
		}
	}
}

function decodeLeniently(text: string): string {
	return text.replace(/(?:%[0-9a-f]{2})+/gi, run => {
		try {
			return decodeURIComponent(run);
		} catch {
			return run;
		}
	});
}

/** What goes to the Trash: a folder none of whose files is mentioned, as one item; else each file. */
function releaseItems(stored: readonly IStoredFile[], releasing: readonly IStoredFile[]): URI[] {
	const items: URI[] = [];
	const folders = new Map<string, { readonly folder: URI; readonly all: number; readonly due: IStoredFile[] }>();
	for (const file of stored) {
		const entry = folders.get(file.folder.toString()) ?? { folder: file.folder, all: 0, due: [] };
		folders.set(file.folder.toString(), { ...entry, all: entry.all + 1 });
	}
	for (const file of releasing) {
		folders.get(file.folder.toString())?.due.push(file);
	}
	for (const { folder, all, due } of folders.values()) {
		if (due.length === all && all > 0) {
			items.push(folder);
		} else {
			items.push(...due.map(file => file.resource));
		}
	}
	return items;
}

/** Sends `item` to the Trash from where it is, with its edit record and original (rule 43); without the Trash, deletes it. */
async function release(services: IBaseHalfNoteFileRetentionServices, workspaceFolder: URI, item: URI): Promise<void> {
	const { fileService, trash } = services;
	const path = relativePath(workspaceFolder, item);
	await fileService.del(item, { useTrash: trash, recursive: true });
	if (path) {
		// A note's edited file keeps its original at its own path in the workspace folder's mirror (rule 27).
		const record = joinPath(workspaceFolder, '.bh', 'mirror', ...path.split('/'));
		if (await fileService.exists(record)) {
			await fileService.del(record, { useTrash: trash, recursive: true });
		}
	}
}

async function readText(fileService: IFileService, resource: URI): Promise<string | undefined> {
	try {
		return (await fileService.readFile(resource)).value.toString();
	} catch (error) {
		// A file deleted since it was listed mentions nothing any more.
		return error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND ? '' : undefined;
	}
}

async function takeLock(fileService: IFileService, lock: URI, now: number): Promise<boolean> {
	try {
		await fileService.createFile(lock, VSBuffer.fromString(String(now)), { overwrite: false });
		return true;
	} catch (error) {
		if (!(error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE)) {
			throw error;
		}
	}
	const since = Number((await fileService.readFile(lock).catch(() => undefined))?.value.toString());
	if (Number.isFinite(since) && now - since >= 0 && now - since < LOCK_STALE_MS) {
		return false;
	}
	await fileService.writeFile(lock, VSBuffer.fromString(String(now)));
	return true;
}

async function readNotes(fileService: IFileService, resource: URI): Promise<INoteFilesRecord> {
	try {
		const value: unknown = JSON.parse((await fileService.readFile(resource)).value.toString());
		const record = value && typeof value === 'object' && !Array.isArray(value) ? value as { scanned?: unknown; unmentioned?: unknown } : {};
		const unmentioned: Record<string, number> = {};
		if (record.unmentioned && typeof record.unmentioned === 'object' && !Array.isArray(record.unmentioned)) {
			for (const [path, since] of Object.entries(record.unmentioned)) {
				if (typeof since === 'number' && Number.isFinite(since)) {
					unmentioned[path] = since;
				}
			}
		}
		return { scanned: typeof record.scanned === 'number' && Number.isFinite(record.scanned) ? record.scanned : undefined, unmentioned };
	} catch {
		return { unmentioned: {} };
	}
}

async function writeNotes(fileService: IFileService, resource: URI, notes: INoteFilesRecord): Promise<void> {
	await fileService.writeFile(resource, VSBuffer.fromString(JSON.stringify(notes, undefined, '\t')));
}
