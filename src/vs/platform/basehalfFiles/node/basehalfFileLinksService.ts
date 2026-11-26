/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';
import { Schemas } from '../../../base/common/network.js';
import { dirname, resolve } from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createFileSystemProviderError, FileSystemProviderErrorCode } from '../../files/common/files.js';
import { BaseHalfFileLinkEntry, IBaseHalfFileLinksService } from '../common/basehalfFileLinks.js';

export class BaseHalfFileLinksService implements IBaseHalfFileLinksService {
	declare readonly _serviceBrand: undefined;

	inspect(resource: URI): Promise<BaseHalfFileLinkEntry> {
		return markFailures(() => this.doInspect(resource));
	}

	link(resource: URI, target: URI): Promise<void> {
		return markFailures(async () => {
			const path = pathOnDisk(resource);
			const targetPath = pathOnDisk(target);
			const entry = await this.doInspect(resource);
			if (entry.kind === 'folder' || entry.kind === 'file') {
				throw new Error(`A ${entry.kind} is at ${path}, not a link`);
			}
			if (entry.kind === 'link' && entry.target.fsPath === targetPath) {
				return;
			}
			await promises.mkdir(dirname(path), { recursive: true });
			// Made under another name and renamed over the path, so that the
			// path goes from the old link to the new one in one step.
			const temporary = `${path}.basehalf-tmp-${generateUuid()}`;
			// A junction needs no extra rights on Windows; other systems ignore the type.
			await promises.symlink(targetPath, temporary, isWindows ? 'junction' : 'dir');
			try {
				await promises.rename(temporary, path);
			} catch (error) {
				await promises.unlink(temporary).catch(() => undefined);
				throw error;
			}
		});
	}

	unlink(resource: URI): Promise<boolean> {
		return markFailures(async () => {
			const entry = await this.doInspect(resource);
			if (entry.kind === 'missing') {
				return false;
			}
			if (entry.kind !== 'link') {
				throw new Error(`A ${entry.kind} is at ${resource.fsPath}, not a link`);
			}
			await promises.unlink(resource.fsPath);
			return true;
		});
	}

	private async doInspect(resource: URI): Promise<BaseHalfFileLinkEntry> {
		const path = pathOnDisk(resource);
		let stat;
		try {
			stat = await promises.lstat(path);
		} catch (error) {
			if (isMissing(error)) {
				return { kind: 'missing' };
			}
			throw error;
		}
		if (stat.isSymbolicLink()) {
			return { kind: 'link', target: URI.file(resolve(dirname(path), await promises.readlink(path))) };
		}
		return { kind: stat.isDirectory() ? 'folder' : 'file' };
	}
}

function pathOnDisk(resource: URI): string {
	if (resource.scheme !== Schemas.file) {
		throw new Error(`Only paths on disk hold links, not ${resource.toString()}`);
	}
	return resource.fsPath;
}

/** Nothing is at the path, also when a part of it is a file. */
function isMissing(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Runs an operation and marks what fails with the kind of the failure. An
 * error that crosses to the window keeps only its message and its name, so
 * the kind goes in the name, as the file service's own errors carry it.
 */
async function markFailures<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw createFileSystemProviderError(error instanceof Error ? error : String(error), failureKind(error));
	}
}

function failureKind(error: unknown): FileSystemProviderErrorCode {
	switch ((error as NodeJS.ErrnoException | undefined)?.code) {
		case 'EACCES':
		case 'EPERM':
			return FileSystemProviderErrorCode.NoPermissions;
		case 'ENOENT':
			return FileSystemProviderErrorCode.FileNotFound;
		case 'EEXIST':
			return FileSystemProviderErrorCode.FileExists;
		case 'ENOTDIR':
			return FileSystemProviderErrorCode.FileNotADirectory;
		case 'EISDIR':
			return FileSystemProviderErrorCode.FileIsADirectory;
		default:
			return FileSystemProviderErrorCode.Unknown;
	}
}
