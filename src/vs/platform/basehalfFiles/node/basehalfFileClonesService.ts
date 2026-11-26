/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { constants, promises } from 'fs';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { BaseHalfFilePart, IBaseHalfFileClonesService } from '../common/basehalfFileClones.js';

/** How much of a range is read at once while it is copied. */
const COPY_BUFFER_BYTES = 8 * 1024 * 1024;

function assertOnDisk(resource: URI): void {
	if (resource.scheme !== Schemas.file) {
		throw new Error(`Only files on disk are cloned, not ${resource.toString()}`);
	}
}

export class BaseHalfFileClonesService implements IBaseHalfFileClonesService {
	declare readonly _serviceBrand: undefined;

	async clone(source: URI, target: URI): Promise<void> {
		assertOnDisk(source);
		assertOnDisk(target);
		// A clone where the disk can make one, a copy where it cannot; never over a file that is there.
		await promises.copyFile(source.fsPath, target.fsPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
	}

	async assemble(target: URI, parts: readonly BaseHalfFilePart[], append = false): Promise<void> {
		assertOnDisk(target);
		for (const part of parts) {
			if (!(part instanceof VSBuffer)) {
				assertOnDisk(part.source);
			}
		}
		const file = await promises.open(target.fsPath, append ? 'a' : 'wx');
		const sources = new Map<string, promises.FileHandle>();
		let buffer: Buffer | undefined;
		try {
			for (const part of parts) {
				if (part instanceof VSBuffer) {
					await writeWhole(file, part.buffer);
					continue;
				}
				let source = sources.get(part.source.fsPath);
				if (!source) {
					source = await promises.open(part.source.fsPath, 'r');
					sources.set(part.source.fsPath, source);
				}
				buffer ??= Buffer.allocUnsafe(COPY_BUFFER_BYTES);
				let position = part.offset;
				const end = part.offset + part.length;
				while (position < end) {
					const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, end - position), position);
					if (bytesRead <= 0) {
						throw new Error(`${part.source.fsPath} ends before ${end}`);
					}
					await writeWhole(file, buffer.subarray(0, bytesRead));
					position += bytesRead;
				}
			}
		} finally {
			for (const source of sources.values()) {
				await source.close();
			}
			await file.close();
		}
	}
}

async function writeWhole(file: promises.FileHandle, bytes: Uint8Array): Promise<void> {
	let written = 0;
	while (written < bytes.length) {
		const { bytesWritten } = await file.write(bytes, written, bytes.length - written);
		written += bytesWritten;
	}
}
