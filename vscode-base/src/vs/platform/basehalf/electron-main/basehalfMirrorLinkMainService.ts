/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { basename, dirname, posix } from '../../../base/common/path.js';
import { IBaseHalfMirrorLinkService } from '../common/basehalfMirrorLink.js';

export class BaseHalfMirrorLinkMainService implements IBaseHalfMirrorLinkService {
	declare readonly _serviceBrand: undefined;

	async setCurrentFocusSymlink(currentFocusFsPath: string, target: string): Promise<void> {
		assertCurrentFocusPath(currentFocusFsPath);
		assertCurrentFocusTarget(target);

		await fs.mkdir(dirname(currentFocusFsPath), { recursive: true });

		let existingIsSymlink = false;
		try {
			const stat = await fs.lstat(currentFocusFsPath);
			if (!stat.isSymbolicLink()) {
				throw new Error(`Refusing to replace non-symlink current_focus.yaml: ${currentFocusFsPath}`);
			}

			existingIsSymlink = true;
			if (await fs.readlink(currentFocusFsPath) === target) {
				return;
			}
		} catch (error) {
			if (!isNodeErrnoException(error) || error.code !== 'ENOENT') {
				throw error;
			}
		}

		const tempPath = `${currentFocusFsPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
		await unlinkIfExists(tempPath);
		try {
			await fs.symlink(target, tempPath, 'file');
			try {
				await fs.rename(tempPath, currentFocusFsPath);
			} catch (error) {
				if (!existingIsSymlink) {
					throw error;
				}

				await fs.unlink(currentFocusFsPath);
				await fs.rename(tempPath, currentFocusFsPath);
			}
		} finally {
			await unlinkIfExists(tempPath);
		}
	}
}

function assertCurrentFocusPath(currentFocusFsPath: string): void {
	if (!currentFocusFsPath || currentFocusFsPath.includes('\0')) {
		throw new Error('Invalid current_focus.yaml path.');
	}

	if (basename(currentFocusFsPath) !== 'current_focus.yaml' || basename(dirname(currentFocusFsPath)) !== '.bh') {
		throw new Error(`BaseHalf mirror link service only manages .bh/current_focus.yaml: ${currentFocusFsPath}`);
	}
}

function assertCurrentFocusTarget(target: string): void {
	if (!target || target.includes('\0') || target.includes('\\')) {
		throw new Error(`Invalid current_focus.yaml target: ${target}`);
	}

	const normalized = posix.normalize(target);
	if (normalized !== target || posix.isAbsolute(target) || target.split('/').includes('..')) {
		throw new Error(`Invalid current_focus.yaml target: ${target}`);
	}

	if (!target.startsWith('mirror/') || !target.endsWith('/focus.yaml') && target !== 'mirror/focus.yaml') {
		throw new Error(`current_focus.yaml target must point at a mirror focus.yaml: ${target}`);
	}
}

async function unlinkIfExists(path: string): Promise<void> {
	try {
		await fs.unlink(path);
	} catch (error) {
		if (!isNodeErrnoException(error) || error.code !== 'ENOENT') {
			throw error;
		}
	}
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === 'object' && error !== null && 'code' in error;
}

