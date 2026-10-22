/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { constants } from 'node:fs';
import { copyFile, link, lstat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';
import { ProviderFailure, rejected } from './failure.ts';
import type { PlaceResult } from './types.ts';

/** The calls of the file system that putting a file in place needs: Node's, or a test's. */
export interface PlaceFileSystem {
	lstat(path: string): Promise<{ isFile(): boolean }>;
	link(existingPath: string, newPath: string): Promise<void>;
	copyFile(source: string, destination: string, mode: number): Promise<void>;
	unlink(path: string): Promise<void>;
}

const NODE_FILE_SYSTEM: PlaceFileSystem = { lstat, link, copyFile, unlink };

/**
 * The errors of `link(2)` that say this file system cannot give the file a
 * second name there: another volume (`EXDEV`), or a file system without hard
 * links, which answers one of the others.
 */
const CANNOT_LINK: ReadonlySet<string> = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS']);

/**
 * Puts a file that a generation received into its card's place (generation
 * cards, "Landing", step 5). `from` is complete in the `.bh/cache/generation/`
 * folder of a workspace folder; `to` is a name in that workspace folder. `to`
 * becomes a second name of the same file by a hard link, which fails when the
 * name is taken, so it never replaces anything, and nothing partial is ever
 * at `to`; then `from` goes. Where the file system cannot link there, the
 * bytes are copied straight to `to` by an exclusive create, which never
 * replaces anything either: a crash during that copy can leave a partial file
 * at `to`, the one case where that can happen. A name that is taken answers
 * `exists`.
 */
export async function placeFile(from: string, to: string, files: PlaceFileSystem = NODE_FILE_SYSTEM): Promise<PlaceResult> {
	checkPlace(from, to);
	let source: { isFile(): boolean };
	try {
		source = await files.lstat(from);
	} catch {
		throw rejected('The file to put in place is not there any more.');
	}
	if (!source.isFile()) {
		throw rejected('AI Video puts in place only a file a generation received.');
	}
	try {
		await files.link(from, to);
	} catch (error) {
		const code = errorCode(error);
		if (code === 'EEXIST') {
			throw taken();
		}
		if (code === undefined || !CANNOT_LINK.has(code)) {
			throw rejected(`AI Video could not put the file in place: ${errorMessage(error)}`);
		}
		await copyExclusively(from, to, files);
	}
	try {
		await files.unlink(from);
	} catch {
		// The window removes what is left with the record of its generation.
	}
	return { placed: true };
}

/**
 * Checks the two names: `from` an absolute `.part` file directly in a
 * `.bh/cache/generation/` folder, and `to` an absolute name below the
 * workspace folder of that `.bh/` folder, outside `.bh/`, that is not a
 * partial download.
 */
export function checkPlace(from: string, to: string): void {
	const generationFolder = dirname(from);
	const cacheFolder = dirname(generationFolder);
	const bhFolder = dirname(cacheFolder);
	if (!isAbsolute(from) || !from.endsWith('.part') || basename(generationFolder) !== 'generation' || basename(cacheFolder) !== 'cache' || basename(bhFolder) !== '.bh') {
		throw rejected('AI Video puts in place only a partial download of .bh/cache/generation/.');
	}
	const workspaceFolder = dirname(bhFolder);
	const inside = relative(workspaceFolder, to);
	if (!isAbsolute(to) || to.endsWith('.part') || !inside || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('.bh')) {
		throw rejected('AI Video puts a file in place only at a name of its workspace folder, outside .bh/.');
	}
}

/** Copies the bytes to `to` with an exclusive create; what a copy that failed wrote there is its own, since the name was free, and goes. */
async function copyExclusively(from: string, to: string, files: PlaceFileSystem): Promise<void> {
	try {
		await files.copyFile(from, to, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
	} catch (error) {
		if (errorCode(error) === 'EEXIST') {
			throw taken();
		}
		await files.unlink(to).catch(() => undefined);
		throw rejected(`AI Video could not copy the file into place: ${errorMessage(error)}`);
	}
}

function taken(): ProviderFailure {
	return new ProviderFailure('exists', 'A file already has this name.');
}

function errorCode(error: unknown): string | undefined {
	const code = (error as { readonly code?: unknown } | undefined)?.code;
	return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
