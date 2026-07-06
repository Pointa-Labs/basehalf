/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');

function writeVariableLengthQuantity(value: number): Buffer {
	if (value !== (value | 0)) {
		throw new Error(`${value} is not an int32.`);
	}

	const bytes: number[] = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
		if (value !== 0) {
			byte |= 0x80;
		}
		bytes.push(byte);
	} while (value !== 0);

	return Buffer.from(bytes);
}

export async function compressTikToken(srcpath: string, dstpath: string): Promise<void> {
	const src = path.join(REPO_ROOT, srcpath);
	const dst = path.join(REPO_ROOT, dstpath);
	const lines = (await fs.promises.readFile(src, 'utf8')).split(/\r?\n/);
	const tokensByRank: Buffer[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		const [tokenBase64, rankText] = trimmed.split(/\s+/);
		const rank = Number(rankText);
		if (!tokenBase64 || !Number.isInteger(rank) || rank < 0) {
			throw new Error(`Invalid tiktoken row in ${srcpath}: ${line}`);
		}

		tokensByRank[rank] = Buffer.from(tokenBase64, 'base64');
	}

	const chunks: Buffer[] = [];
	for (let rank = 0; rank < tokensByRank.length; rank++) {
		const token = tokensByRank[rank];
		if (!token) {
			throw new Error(`Missing tiktoken rank ${rank} in ${srcpath}`);
		}

		chunks.push(writeVariableLengthQuantity(token.length), token);
	}

	await fs.promises.mkdir(path.dirname(dst), { recursive: true });
	await fs.promises.writeFile(dst, Buffer.concat(chunks));
}
