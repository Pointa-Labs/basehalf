/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { BaseHalfCanvasNoteBackground } from './basehalfCanvasScene.js';
import { createKeyedMutex } from '../../workspace/common/basehalfKeyedMutex.js';
import { baseHalfCommitMirrorFile } from '../../workspace/common/basehalfMirrorFileCommit.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorResource, baseHalfWalkMirror } from '../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationCoordinator } from '../../workspace/common/basehalfWorkspaceMutation.js';

export const IBaseHalfCanvasAppearanceService = createDecorator<IBaseHalfCanvasAppearanceService>('baseHalfCanvasAppearanceService');

const APPEARANCE_FILE_NAME = 'appearance.yaml';
const APPEARANCE_MAX_BYTES = 4 * 1024;
const APPEARANCE_PATCH_MAX_ATTEMPTS = 3;
const BACKGROUNDS = new Set<BaseHalfCanvasNoteBackground>(['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']);

/** Whether the card of a PDF or a book shows its cover (PDFs and books, "Hiding and showing the cover"). */
export type BaseHalfCanvasDocumentCover = 'shown' | 'hidden';

const COVERS = new Set<BaseHalfCanvasDocumentCover>(['shown', 'hidden']);

/**
 * What a card's `appearance.yaml` holds, one field: the background of a
 * note's card, or whether the card of a PDF or a book shows its cover.
 */
export type BaseHalfCanvasAppearance =
	| { readonly field: 'background'; readonly background: BaseHalfCanvasNoteBackground }
	| { readonly field: 'cover'; readonly cover: BaseHalfCanvasDocumentCover };

export interface IBaseHalfCanvasAppearanceProblem {
	readonly relativePath: string;
	readonly resource: URI;
	readonly message: string;
}

export interface IBaseHalfCanvasAppearanceReadResult {
	readonly backgrounds: ReadonlyMap<string, BaseHalfCanvasNoteBackground>;
	/** The paths of the cards of PDFs and books whose cover is hidden. */
	readonly hiddenCovers: ReadonlySet<string>;
	readonly problems: readonly IBaseHalfCanvasAppearanceProblem[];
}

export interface IBaseHalfCanvasAppearanceService {
	readonly _serviceBrand: undefined;
	readAll(workspaceFolder: URI): Promise<IBaseHalfCanvasAppearanceReadResult>;
	setBackground(workspaceFolder: URI, relativePath: string, background: BaseHalfCanvasNoteBackground): Promise<void>;
	/** Shows or hides the cover of the card of a PDF or a book. */
	setCover(workspaceFolder: URI, relativePath: string, cover: BaseHalfCanvasDocumentCover): Promise<void>;
	appearanceResource(workspaceFolder: URI, relativePath: string): URI;
}

interface IBaseHalfAppearanceReadState {
	readonly contents: VSBuffer | null;
	readonly appearance: BaseHalfCanvasAppearance | undefined;
}

/**
 * What this window writes of the appearance of cards. A drawing whose read
 * of the files ran while a write did may have missed it, so it keeps what the
 * window shows of that card; the drawing after the write reads it.
 */
export class BaseHalfCanvasAppearanceWrites {
	private epoch = 0;
	private readonly writes = new Map<string, { running: number; endedAt: number }>();

	/** Runs a write of the appearance of the card at `path`. */
	async run(path: string, write: () => Promise<void>): Promise<void> {
		const record = this.writes.get(path) ?? { running: 0, endedAt: 0 };
		record.running++;
		this.writes.set(path, record);
		try {
			await write();
		} finally {
			record.running--;
			record.endedAt = ++this.epoch;
		}
	}

	/** Taken before the files are read. */
	mark(): number {
		return this.epoch;
	}

	/** The cards whose appearance a read that began at `mark` may have missed. A write that the read saw is forgotten. */
	unreadSince(mark: number): ReadonlySet<string> {
		const unread = new Set<string>();
		for (const [path, record] of this.writes) {
			if (record.running > 0 || record.endedAt > mark) {
				unread.add(path);
			} else {
				this.writes.delete(path);
			}
		}
		return unread;
	}
}

export class BaseHalfCanvasAppearanceService implements IBaseHalfCanvasAppearanceService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator
	) { }

	async readAll(workspaceFolder: URI): Promise<IBaseHalfCanvasAppearanceReadResult> {
		const backgrounds = new Map<string, BaseHalfCanvasNoteBackground>();
		const hiddenCovers = new Set<string>();
		const problems: IBaseHalfCanvasAppearanceProblem[] = [];
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, APPEARANCE_FILE_NAME)) {
			try {
				const { appearance } = await this.readState(workspaceFolder, entry.relativePath, entry.resource);
				if (appearance?.field === 'background' && appearance.background !== 'default') {
					backgrounds.set(entry.relativePath, appearance.background);
				} else if (appearance?.field === 'cover' && appearance.cover === 'hidden') {
					hiddenCovers.add(entry.relativePath);
				}
			} catch (error) {
				problems.push({
					relativePath: entry.relativePath,
					resource: entry.resource,
					message: error instanceof Error ? error.message : String(error)
				});
			}
		}
		return { backgrounds, hiddenCovers, problems };
	}

	setBackground(workspaceFolder: URI, relativePath: string, background: BaseHalfCanvasNoteBackground): Promise<void> {
		if (!BACKGROUNDS.has(background)) {
			return Promise.reject(new RangeError(`Unsupported Canvas card background: ${background}`));
		}
		return this.write(workspaceFolder, relativePath, `background: ${background}\n`);
	}

	setCover(workspaceFolder: URI, relativePath: string, cover: BaseHalfCanvasDocumentCover): Promise<void> {
		if (!COVERS.has(cover)) {
			return Promise.reject(new RangeError(`Unsupported Canvas card cover: ${cover}`));
		}
		return this.write(workspaceFolder, relativePath, `cover: ${cover}\n`);
	}

	private write(workspaceFolder: URI, relativePath: string, line: string): Promise<void> {
		return this.workspaceMutationCoordinator.runExclusive(workspaceFolder, () => {
			const resource = this.appearanceResource(workspaceFolder, relativePath);
			return this.mutex.runExclusive(resource.toString(), async () => {
				for (let attempt = 0; attempt < APPEARANCE_PATCH_MAX_ATTEMPTS; attempt++) {
					const current = await this.readState(workspaceFolder, relativePath, resource);
					const contents = VSBuffer.fromString(line);
					if (current.contents?.equals(contents)) {
						return;
					}
					try {
						await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
						await this.fileService.createFolder(dirname(resource));
						await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
						await baseHalfCommitMirrorFile(this.fileService, resource, contents, current.contents);
						await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
						return;
					} catch (error) {
						if (!isAppearanceConflict(error) || attempt === APPEARANCE_PATCH_MAX_ATTEMPTS - 1) {
							throw error;
						}
					}
				}
				throw new Error(`Unable to update ${resource.toString()} after ${APPEARANCE_PATCH_MAX_ATTEMPTS} attempts`);
			});
		});
	}

	appearanceResource(workspaceFolder: URI, relativePath: string): URI {
		return baseHalfMirrorResource(workspaceFolder, relativePath, APPEARANCE_FILE_NAME);
	}

	private async readState(workspaceFolder: URI, relativePath: string, resource: URI): Promise<IBaseHalfAppearanceReadState> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		try {
			const content = await this.fileService.readFile(resource, {
				limits: { size: APPEARANCE_MAX_BYTES },
				atomic: true
			});
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
			return {
				contents: content.value,
				appearance: parseAppearance(content.value.toString(), resource, relativePath)
			};
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				return { contents: null, appearance: undefined };
			}
			throw error;
		}
	}
}

export function parseBaseHalfCanvasAppearance(raw: string): BaseHalfCanvasAppearance {
	return parseAppearance(raw, URI.parse('basehalf://appearance'), '');
}

function parseAppearance(raw: string, resource: URI, relativePath: string): BaseHalfCanvasAppearance {
	const meaningful = raw.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
	if (meaningful.length !== 1) {
		throw new Error(`Invalid appearance metadata for '${relativePath}' at ${resource.toString()}: expected one field.`);
	}
	const match = /^(?<field>background|cover):\s*(?<value>[a-z]+)$/.exec(meaningful[0]);
	const value = match?.groups?.value;
	if (match?.groups?.field === 'background' && BACKGROUNDS.has(value as BaseHalfCanvasNoteBackground)) {
		return { field: 'background', background: value as BaseHalfCanvasNoteBackground };
	}
	if (match?.groups?.field === 'cover' && COVERS.has(value as BaseHalfCanvasDocumentCover)) {
		return { field: 'cover', cover: value as BaseHalfCanvasDocumentCover };
	}
	throw new Error(`Invalid appearance metadata for '${relativePath}' at ${resource.toString()}: unsupported ${match?.groups?.field ?? 'field'}.`);
}

function isAppearanceConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
}

registerSingleton(IBaseHalfCanvasAppearanceService, BaseHalfCanvasAppearanceService, InstantiationType.Delayed);
