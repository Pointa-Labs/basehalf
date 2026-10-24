/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfRandomAccessFile } from '../../common/basehalfZipReader.js';

const encoder = new TextEncoder();

/** A file in memory that records every part that is read of it. */
export class MemoryFile implements IBaseHalfRandomAccessFile {

	readonly reads: [offset: number, length: number][] = [];

	constructor(private readonly bytes: Uint8Array) { }

	get size(): number {
		return this.bytes.length;
	}

	/** How many bytes were read in all. */
	get bytesRead(): number {
		return this.reads.reduce((sum, [, length]) => sum + length, 0);
	}

	async read(offset: number, length: number): Promise<Uint8Array> {
		this.reads.push([offset, length]);
		return this.bytes.slice(offset, offset + length);
	}
}

async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
	return new Uint8Array(await new Response(new Blob([new Uint8Array(data)]).stream().pipeThrough(stream)).arrayBuffer());
}

/** The data deflated without a header, as zip method 8 stores it. */
export function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	return transform(data, new CompressionStream('deflate-raw'));
}

/** The data that raw DEFLATE data holds, as the readers ask an inflater for it. */
export function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	return transform(data, new DecompressionStream('deflate-raw'));
}

/** One byte for each character, as a file in a single-byte encoding holds it. */
export function latin1(text: string): Uint8Array {
	return Uint8Array.from(text, character => character.charCodeAt(0));
}

/** The parts one after the other. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

/** The fields one after the other, low byte first, each of 2, 4, or 8 bytes. */
function littleEndian(...fields: readonly (readonly [value: number, size: 2 | 4 | 8])[]): Uint8Array {
	const bytes = new Uint8Array(fields.reduce((sum, [, size]) => sum + size, 0));
	let offset = 0;
	for (const [value, size] of fields) {
		for (let index = 0; index < size; index++) {
			bytes[offset++] = Math.floor(value / 2 ** (8 * index)) & 0xff;
		}
	}
	return bytes;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++) {
		value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
	}
	return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ crc >>> 8;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

export interface ITestZipEntry {
	readonly name: string;
	readonly data: string | Uint8Array;
	/** Deflates the data (method 8); otherwise it is stored. */
	readonly deflate?: boolean;
	/** Writes the sizes after the data (general purpose flag bit 3) and zeros in the local header. */
	readonly descriptor?: boolean;
	/** More general purpose flags, such as 1 for encrypted. */
	readonly flags?: number;
	/** The method to write, when it is not the one the data was stored with. */
	readonly method?: number;
	/** The name's bytes without the UTF-8 flag, when they are not the name's UTF-8. */
	readonly nameBytes?: Uint8Array;
}

export interface ITestZip {
	readonly bytes: Uint8Array;
	/** Where each entry was written, and how large its data is in the archive. */
	readonly layout: readonly { readonly compressedSize: number; readonly localHeaderOffset: number }[];
}

/**
 * A zip archive of the entries, with a comment after the end record when
 * asked. Each local header has a 4-byte extra field that the central
 * directory does not, so that a reader must find the data from the local
 * header. With `zip64`, the end records are ZIP64 ones, and every entry's
 * sizes and offset are in a ZIP64 extra field.
 */
export async function makeZip(entries: readonly ITestZipEntry[], options: { readonly zip64?: boolean; readonly comment?: string } = {}): Promise<ITestZip> {
	const zip64 = options.zip64 === true;
	const parts: Uint8Array[] = [];
	const directory: Uint8Array[] = [];
	const layout: { compressedSize: number; localHeaderOffset: number }[] = [];
	let offset = 0;
	for (const entry of entries) {
		const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
		const stored = entry.deflate ? await deflateRaw(data) : data;
		const name = entry.nameBytes ?? encoder.encode(entry.name);
		const flags = (entry.nameBytes ? 0 : 0x0800) | (entry.descriptor ? 0x0008 : 0) | (entry.flags ?? 0);
		const method = entry.method ?? (entry.deflate ? 8 : 0);
		const crc = crc32(data);
		const local = concat([
			littleEndian([0x04034b50, 4], [20, 2], [flags, 2], [method, 2], [0, 2], [0x21, 2],
				[entry.descriptor ? 0 : crc, 4], [entry.descriptor ? 0 : stored.length, 4], [entry.descriptor ? 0 : data.length, 4], [name.length, 2], [4, 2]),
			name,
			littleEndian([0xcafe, 2], [0, 2]),
			stored,
			entry.descriptor ? littleEndian([0x08074b50, 4], [crc, 4], [stored.length, 4], [data.length, 4]) : new Uint8Array(0)
		]);
		directory.push(concat([
			littleEndian([0x02014b50, 4], [zip64 ? 45 : 20, 2], [zip64 ? 45 : 20, 2], [flags, 2], [method, 2], [0, 2], [0x21, 2],
				[crc, 4], [zip64 ? 0xffffffff : stored.length, 4], [zip64 ? 0xffffffff : data.length, 4], [name.length, 2], [zip64 ? 28 : 0, 2],
				[0, 2], [0, 2], [0, 2], [0, 4], [zip64 ? 0xffffffff : offset, 4]),
			name,
			zip64 ? littleEndian([0x0001, 2], [24, 2], [data.length, 8], [stored.length, 8], [offset, 8]) : new Uint8Array(0)
		]));
		layout.push({ compressedSize: stored.length, localHeaderOffset: offset });
		parts.push(local);
		offset += local.length;
	}
	const directoryBytes = concat(directory);
	const zip64End = zip64 ? littleEndian(
		[0x06064b50, 4], [44, 8], [45, 2], [45, 2], [0, 4], [0, 4], [entries.length, 8], [entries.length, 8], [directoryBytes.length, 8], [offset, 8],
		[0x07064b50, 4], [0, 4], [offset + directoryBytes.length, 8], [1, 4]
	) : new Uint8Array(0);
	const comment = encoder.encode(options.comment ?? '');
	const end = littleEndian([0x06054b50, 4], [0, 2], [0, 2], [zip64 ? 0xffff : entries.length, 2], [zip64 ? 0xffff : entries.length, 2],
		[zip64 ? 0xffffffff : directoryBytes.length, 4], [zip64 ? 0xffffffff : offset, 4], [comment.length, 2]);
	return { bytes: concat([...parts, directoryBytes, zip64End, end, comment]), layout };
}

/** Bytes that are no archive and no book, the same on every run. */
export function noise(length: number): Uint8Array {
	let seed = 0x2545f491;
	return Uint8Array.from({ length }, () => {
		seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
		return seed >>> 24;
	});
}

/** The message of the error that the promise rejects with, or 'no error'. */
export async function messageOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
		return 'no error';
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
