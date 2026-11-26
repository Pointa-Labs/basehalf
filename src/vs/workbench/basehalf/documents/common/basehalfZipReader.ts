/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/** A file read in parts, so that only what is needed is read. */
export interface IBaseHalfRandomAccessFile {
	readonly size: number;
	read(offset: number, length: number): Promise<Uint8Array>;
}

/** Inflates raw DEFLATE data (zip method 8). */
export type BaseHalfInflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

export interface IBaseHalfZipEntry {
	/** The entry's path in the archive, decoded as UTF-8 (or CP437 bytes as Latin-1 when the UTF-8 flag is not set and the bytes are not valid UTF-8). */
	readonly name: string;
	/** 0 stored, 8 deflated; other methods are listed but cannot be read. */
	readonly method: number;
	readonly compressedSize: number;
	readonly size: number;
	readonly localHeaderOffset: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_LENGTH = 30;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_LENGTH = 46;
const END_SIGNATURE = 0x06054b50;
const END_LENGTH = 22;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_END_LENGTH = 56;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_LENGTH = 20;
const ZIP64_EXTRA_FIELD = 0x0001;
const MAX_COMMENT_LENGTH = 0xffff;
const CENTRAL_DIRECTORY_MAX_BYTES = 64 * 1024 * 1024;
const ENTRY_MAX_BYTES = 32 * 1024 * 1024;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

const NOT_A_ZIP = 'The file is not a zip archive.';
const DAMAGED = 'The zip archive is damaged.';

const utf8Decoder = new TextDecoder('utf-8');
const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function uint16(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | bytes[offset + 1] << 8;
}

function uint32(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

function uint64(bytes: Uint8Array, offset: number): number {
	return uint32(bytes, offset) + uint32(bytes, offset + 4) * 0x1_0000_0000;
}

/** Exactly `length` bytes at `offset`, or an error when the file holds fewer. */
async function readExactly(file: IBaseHalfRandomAccessFile, offset: number, length: number): Promise<Uint8Array> {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > file.size) {
		throw new Error(DAMAGED);
	}
	if (length === 0) {
		return new Uint8Array(0);
	}
	const bytes = await file.read(offset, length);
	if (bytes.length < length) {
		throw new Error(DAMAGED);
	}
	return bytes.length === length ? bytes : bytes.subarray(0, length);
}

interface IReadBytes {
	readonly offset: number;
	readonly bytes: Uint8Array;
}

/** The bytes at `offset` from what was read already when it holds them, else from the file. */
function readAgain(file: IBaseHalfRandomAccessFile, read: IReadBytes, offset: number, length: number): Promise<Uint8Array> {
	const start = offset - read.offset;
	if (start >= 0 && start + length <= read.bytes.length) {
		return Promise.resolve(read.bytes.subarray(start, start + length));
	}
	return readExactly(file, offset, length);
}

/** The position of the end of central directory record in the last bytes of a file, or -1. */
function findEndRecord(tail: Uint8Array): number {
	let loose = -1;
	for (let position = tail.length - END_LENGTH; position >= 0; position--) {
		if (uint32(tail, position) !== END_SIGNATURE) {
			continue;
		}
		const end = position + END_LENGTH + uint16(tail, position + 20);
		if (end === tail.length) {
			return position;
		}
		if (end < tail.length && loose < 0) {
			loose = position;
		}
	}
	return loose;
}

function decodeName(bytes: Uint8Array, isUtf8: boolean): string {
	if (isUtf8) {
		return utf8Decoder.decode(bytes);
	}
	try {
		return strictUtf8Decoder.decode(bytes);
	} catch {
		let name = '';
		for (const byte of bytes) {
			name += String.fromCharCode(byte);
		}
		return name;
	}
}

/** Whether the first bytes are a zip archive's (PK\x03\x04). */
export function isBaseHalfZip(head: Uint8Array): boolean {
	return head.length >= 4 && uint32(head, 0) === LOCAL_HEADER_SIGNATURE;
}

/** The entries of the central directory. Reads the end of central directory record from the last 64 KiB + 22 bytes, supports ZIP64 end records and ZIP64 extra fields; throws an Error with a plain message for a file that is no zip. */
export async function readBaseHalfZipEntries(file: IBaseHalfRandomAccessFile): Promise<readonly IBaseHalfZipEntry[]> {
	if (file.size < END_LENGTH) {
		throw new Error(NOT_A_ZIP);
	}
	const tailLength = Math.min(file.size, END_LENGTH + MAX_COMMENT_LENGTH);
	const tail: IReadBytes = { offset: file.size - tailLength, bytes: await readExactly(file, file.size - tailLength, tailLength) };
	const end = findEndRecord(tail.bytes);
	if (end < 0) {
		throw new Error(NOT_A_ZIP);
	}
	let count = uint16(tail.bytes, end + 10);
	let directorySize = uint32(tail.bytes, end + 12);
	let directoryOffset = uint32(tail.bytes, end + 16);
	const locatorOffset = tail.offset + end - ZIP64_LOCATOR_LENGTH;
	if (locatorOffset >= 0) {
		const locator = await readAgain(file, tail, locatorOffset, ZIP64_LOCATOR_LENGTH);
		if (uint32(locator, 0) === ZIP64_LOCATOR_SIGNATURE) {
			const record = await readAgain(file, tail, uint64(locator, 8), ZIP64_END_LENGTH);
			if (uint32(record, 0) !== ZIP64_END_SIGNATURE) {
				throw new Error(DAMAGED);
			}
			count = uint64(record, 32);
			directorySize = uint64(record, 40);
			directoryOffset = uint64(record, 48);
		}
	}
	if (directorySize > CENTRAL_DIRECTORY_MAX_BYTES || directoryOffset + directorySize > file.size) {
		throw new Error(DAMAGED);
	}
	const directory = await readAgain(file, tail, directoryOffset, directorySize);
	const entries: IBaseHalfZipEntry[] = [];
	let position = 0;
	while (position + CENTRAL_HEADER_LENGTH <= directory.length && uint32(directory, position) === CENTRAL_HEADER_SIGNATURE) {
		const flags = uint16(directory, position + 8);
		let compressedSize = uint32(directory, position + 20);
		let size = uint32(directory, position + 24);
		let localHeaderOffset = uint32(directory, position + 42);
		const nameStart = position + CENTRAL_HEADER_LENGTH;
		const extraStart = nameStart + uint16(directory, position + 28);
		const extraEnd = extraStart + uint16(directory, position + 30);
		const next = extraEnd + uint16(directory, position + 32);
		if (next > directory.length) {
			throw new Error(DAMAGED);
		}
		for (let field = extraStart; field + 4 <= extraEnd;) {
			const fieldEnd = field + 4 + uint16(directory, field + 2);
			if (fieldEnd > extraEnd) {
				break;
			}
			if (uint16(directory, field) === ZIP64_EXTRA_FIELD) {
				// The field holds, in this order, only the values that the header could not.
				let value = field + 4;
				if (size === 0xffffffff && value + 8 <= fieldEnd) {
					size = uint64(directory, value);
					value += 8;
				}
				if (compressedSize === 0xffffffff && value + 8 <= fieldEnd) {
					compressedSize = uint64(directory, value);
					value += 8;
				}
				if (localHeaderOffset === 0xffffffff && value + 8 <= fieldEnd) {
					localHeaderOffset = uint64(directory, value);
				}
			}
			field = fieldEnd;
		}
		entries.push({
			name: decodeName(directory.subarray(nameStart, extraStart), (flags & FLAG_UTF8) !== 0),
			method: uint16(directory, position + 10),
			compressedSize,
			size,
			localHeaderOffset
		});
		position = next;
	}
	// A writer that wraps the count of more than 65535 entries lists more than it counts.
	if (entries.length < count) {
		throw new Error(DAMAGED);
	}
	return entries;
}

/** The bytes of one entry: reads its local header to find the data, inflates method 8, refuses (throws) other methods, encrypted entries (general purpose flag bit 0), and an entry whose size is above maxSize (default 32 MiB) without reading it. */
export async function readBaseHalfZipEntry(file: IBaseHalfRandomAccessFile, entry: IBaseHalfZipEntry, inflateRaw: BaseHalfInflateRaw, maxSize = ENTRY_MAX_BYTES): Promise<Uint8Array> {
	if (entry.method !== 0 && entry.method !== 8) {
		throw new Error(`The zip entry '${entry.name}' is compressed with method ${entry.method}, which BaseHalf cannot read.`);
	}
	// Deflate makes data that does not compress a little larger: 5 bytes for each 65535.
	if (entry.size > maxSize || entry.compressedSize > maxSize + Math.ceil(maxSize / 1024) + 1024) {
		throw new Error(`The zip entry '${entry.name}' is larger than ${maxSize} bytes.`);
	}
	const header = await readExactly(file, entry.localHeaderOffset, LOCAL_HEADER_LENGTH);
	if (uint32(header, 0) !== LOCAL_HEADER_SIGNATURE) {
		throw new Error(DAMAGED);
	}
	if (uint16(header, 6) & FLAG_ENCRYPTED) {
		throw new Error(`The zip entry '${entry.name}' is encrypted.`);
	}
	const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_LENGTH + uint16(header, 26) + uint16(header, 28);
	const data = await readExactly(file, dataOffset, entry.compressedSize);
	if (entry.method === 0) {
		return data;
	}
	let inflated: Uint8Array;
	try {
		inflated = await inflateRaw(data);
	} catch {
		throw new Error(`The zip entry '${entry.name}' is damaged.`);
	}
	if (inflated.length > maxSize) {
		throw new Error(`The zip entry '${entry.name}' is larger than ${maxSize} bytes.`);
	}
	return inflated;
}
