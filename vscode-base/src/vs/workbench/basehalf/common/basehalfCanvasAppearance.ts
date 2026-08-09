/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { BaseHalfCanvasNoteBackground } from './basehalfCanvasScene.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorResource, baseHalfWalkMirror } from './basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationCoordinator } from './basehalfWorkspaceMutation.js';

export const IBaseHalfCanvasAppearanceService = createDecorator<IBaseHalfCanvasAppearanceService>('baseHalfCanvasAppearanceService');

const APPEARANCE_FILE_NAME = 'appearance.yaml';
const APPEARANCE_MAX_BYTES = 4 * 1024;
const APPEARANCE_PATCH_MAX_ATTEMPTS = 3;
const BACKGROUNDS = new Set<BaseHalfCanvasNoteBackground>(['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']);

export interface IBaseHalfCanvasAppearanceProblem {
	readonly relativePath: string;
	readonly resource: URI;
	readonly message: string;
}

export interface IBaseHalfCanvasAppearanceReadResult {
	readonly backgrounds: ReadonlyMap<string, BaseHalfCanvasNoteBackground>;
	readonly problems: readonly IBaseHalfCanvasAppearanceProblem[];
}

export interface IBaseHalfCanvasAppearanceService {
	readonly _serviceBrand: undefined;
	readAll(workspaceFolder: URI): Promise<IBaseHalfCanvasAppearanceReadResult>;
	setBackground(workspaceFolder: URI, relativePath: string, background: BaseHalfCanvasNoteBackground): Promise<void>;
	appearanceResource(workspaceFolder: URI, relativePath: string): URI;
}

interface IBaseHalfAppearanceReadState {
	readonly contents: VSBuffer | null;
	readonly background: BaseHalfCanvasNoteBackground;
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
		const problems: IBaseHalfCanvasAppearanceProblem[] = [];
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, APPEARANCE_FILE_NAME)) {
			try {
				const state = await this.readState(workspaceFolder, entry.relativePath, entry.resource);
				if (state.background !== 'default') {
					backgrounds.set(entry.relativePath, state.background);
				}
			} catch (error) {
				problems.push({
					relativePath: entry.relativePath,
					resource: entry.resource,
					message: error instanceof Error ? error.message : String(error)
				});
			}
		}
		return { backgrounds, problems };
	}

	setBackground(workspaceFolder: URI, relativePath: string, background: BaseHalfCanvasNoteBackground): Promise<void> {
		if (!BACKGROUNDS.has(background)) {
			return Promise.reject(new RangeError(`Unsupported Canvas card background: ${background}`));
		}
		return this.workspaceMutationCoordinator.runExclusive(workspaceFolder, () => {
			const resource = this.appearanceResource(workspaceFolder, relativePath);
			return this.mutex.runExclusive(resource.toString(), async () => {
				for (let attempt = 0; attempt < APPEARANCE_PATCH_MAX_ATTEMPTS; attempt++) {
					const current = await this.readState(workspaceFolder, relativePath, resource);
					const contents = VSBuffer.fromString(`background: ${background}\n`);
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
				background: parseAppearance(content.value.toString(), resource, relativePath)
			};
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				return { contents: null, background: 'default' };
			}
			throw error;
		}
	}
}

export function parseBaseHalfCanvasAppearance(raw: string): BaseHalfCanvasNoteBackground {
	return parseAppearance(raw, URI.parse('basehalf://appearance'), '');
}

function parseAppearance(raw: string, resource: URI, relativePath: string): BaseHalfCanvasNoteBackground {
	const meaningful = raw.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
	if (meaningful.length !== 1) {
		throw new Error(`Invalid appearance metadata for '${relativePath}' at ${resource.toString()}: expected one background field.`);
	}
	const match = /^background:\s*([a-z]+)$/.exec(meaningful[0]);
	const background = match?.[1] as BaseHalfCanvasNoteBackground | undefined;
	if (!background || !BACKGROUNDS.has(background)) {
		throw new Error(`Invalid appearance metadata for '${relativePath}' at ${resource.toString()}: unsupported background.`);
	}
	return background;
}

function isAppearanceConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
}

registerSingleton(IBaseHalfCanvasAppearanceService, BaseHalfCanvasAppearanceService, InstantiationType.Delayed);
