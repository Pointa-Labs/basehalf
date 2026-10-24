/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfZipEntry, isBaseHalfZip, readBaseHalfZipEntries, readBaseHalfZipEntry } from '../../common/basehalfZipReader.js';
import { inflateRaw, latin1, makeZip, MemoryFile, messageOf, noise } from './basehalfDocumentTestFiles.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TEXT = 'Down the Rabbit-Hole. '.repeat(40);

suite('BaseHalfZipReader', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tells a zip archive by its first bytes', () => {
		assert.deepStrictEqual([
			isBaseHalfZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])),
			isBaseHalfZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06])),
			isBaseHalfZip(new Uint8Array([0x50, 0x4b, 0x03])),
			isBaseHalfZip(encoder.encode('%PDF-1.7'))
		], [true, false, false, false]);
	});

	test('lists the entries of the central directory with their names decoded', async () => {
		const zip = await makeZip([
			{ name: 'mimetype', data: 'application/epub+zip' },
			{ name: 'OEBPS/chapter.xhtml', data: TEXT, deflate: true },
			{ name: 'OEBPS/', data: '' },
			{ name: '封面.jpg', data: 'jpeg' },
			{ name: 'über.txt', data: 'utf-8 without the flag', nameBytes: encoder.encode('über.txt') },
			{ name: 'cp437', data: 'not utf-8', nameBytes: latin1('caf\x82.txt') },
			{ name: 'later.txt', data: TEXT, deflate: true, descriptor: true }
		], { comment: 'A comment after the end record' });
		const entries = await readBaseHalfZipEntries(new MemoryFile(zip.bytes));
		assert.deepStrictEqual(entries, [
			{ name: 'mimetype', method: 0, size: 20, ...zip.layout[0] },
			{ name: 'OEBPS/chapter.xhtml', method: 8, size: TEXT.length, ...zip.layout[1] },
			{ name: 'OEBPS/', method: 0, size: 0, ...zip.layout[2] },
			{ name: '封面.jpg', method: 0, size: 4, ...zip.layout[3] },
			{ name: 'über.txt', method: 0, size: 22, ...zip.layout[4] },
			{ name: 'caf\u0082.txt', method: 0, size: 9, ...zip.layout[5] },
			{ name: 'later.txt', method: 8, size: TEXT.length, ...zip.layout[6] }
		]);
	});

	test('reads stored, deflated, and data descriptor entries', async () => {
		const zip = await makeZip([
			{ name: 'stored.txt', data: 'stored' },
			{ name: 'deflated.txt', data: TEXT, deflate: true },
			{ name: 'descriptor.txt', data: `${TEXT}!`, deflate: true, descriptor: true },
			{ name: 'empty.txt', data: '' }
		]);
		const file = new MemoryFile(zip.bytes);
		const entries = await readBaseHalfZipEntries(file);
		const texts: string[] = [];
		for (const entry of entries) {
			texts.push(decoder.decode(await readBaseHalfZipEntry(file, entry, inflateRaw)));
		}
		assert.deepStrictEqual(texts, ['stored', TEXT, `${TEXT}!`, '']);
	});

	test('reads a ZIP64 archive', async () => {
		const zip = await makeZip([
			{ name: 'a.txt', data: 'first' },
			{ name: 'b.txt', data: TEXT, deflate: true }
		], { zip64: true });
		const file = new MemoryFile(zip.bytes);
		const entries = await readBaseHalfZipEntries(file);
		const texts: string[] = [];
		for (const entry of entries) {
			texts.push(decoder.decode(await readBaseHalfZipEntry(file, entry, inflateRaw)));
		}
		assert.deepStrictEqual({ entries, texts }, {
			entries: [
				{ name: 'a.txt', method: 0, size: 5, ...zip.layout[0] },
				{ name: 'b.txt', method: 8, size: TEXT.length, ...zip.layout[1] }
			],
			texts: ['first', TEXT]
		});
	});

	test('lists a large archive from its end alone, and reads an entry from its header and its data', async () => {
		const zip = await makeZip([
			{ name: 'filler.bin', data: new Uint8Array(1024 * 1024) },
			{ name: 'small.txt', data: 'small' }
		]);
		const file = new MemoryFile(zip.bytes);
		const entries = await readBaseHalfZipEntries(file);
		const listed = file.reads.splice(0);
		const small = decoder.decode(await readBaseHalfZipEntry(file, entries[1], inflateRaw));
		const tail = 22 + 0xffff;
		const localHeaderOffset = zip.layout[1].localHeaderOffset;
		assert.deepStrictEqual({ listed, small, read: file.reads }, {
			listed: [[zip.bytes.length - tail, tail]],
			small: 'small',
			read: [[localHeaderOffset, 30], [localHeaderOffset + 30 + 'small.txt'.length + 4, 5]]
		});
	});

	test('refuses other methods, encrypted entries, and entries above the size limit', async () => {
		const zip = await makeZip([
			{ name: 'bzip2.txt', data: 'not bzip2', method: 12 },
			{ name: 'secret.txt', data: 'not encrypted', flags: 0x0001 },
			{ name: 'large.txt', data: TEXT, deflate: true },
			{ name: 'broken.txt', data: new Uint8Array([0xff, 0xff, 0xff]), method: 8 }
		]);
		const file = new MemoryFile(zip.bytes);
		const entries = await readBaseHalfZipEntries(file);
		file.reads.length = 0;
		const messages = [
			await messageOf(readBaseHalfZipEntry(file, entries[0], inflateRaw)),
			await messageOf(readBaseHalfZipEntry(file, entries[1], inflateRaw)),
			await messageOf(readBaseHalfZipEntry(file, entries[2], inflateRaw, 100)),
			await messageOf(readBaseHalfZipEntry(file, entries[3], inflateRaw))
		];
		assert.deepStrictEqual({ messages, read: file.reads.map(([offset]) => offset) }, {
			messages: [
				'The zip entry \'bzip2.txt\' is compressed with method 12, which BaseHalf cannot read.',
				'The zip entry \'secret.txt\' is encrypted.',
				'The zip entry \'large.txt\' is larger than 100 bytes.',
				'The zip entry \'broken.txt\' is damaged.'
			],
			// Only the local header of the encrypted entry, and the header and data of the broken one.
			read: [zip.layout[1].localHeaderOffset, zip.layout[3].localHeaderOffset, zip.layout[3].localHeaderOffset + 30 + 'broken.txt'.length + 4]
		});
	});

	test('throws a plain message for a file that is no zip archive', async () => {
		const zip = await makeZip([{ name: 'a.txt', data: TEXT }]);
		const truncated = zip.bytes.slice(0, zip.bytes.length - 40);
		const entry: IBaseHalfZipEntry = { name: 'a.txt', method: 0, size: 5, compressedSize: 5, localHeaderOffset: 900 };
		assert.deepStrictEqual([
			await messageOf(readBaseHalfZipEntries(new MemoryFile(noise(4096)))),
			await messageOf(readBaseHalfZipEntries(new MemoryFile(new Uint8Array(0)))),
			await messageOf(readBaseHalfZipEntries(new MemoryFile(truncated))),
			await messageOf(readBaseHalfZipEntry(new MemoryFile(noise(1000)), entry, inflateRaw))
		], [
			'The file is not a zip archive.',
			'The file is not a zip archive.',
			'The file is not a zip archive.',
			'The zip archive is damaged.'
		]);
	});

	test('throws for an end record whose central directory is damaged', async () => {
		const zip = await makeZip([{ name: 'a.txt', data: 'first' }, { name: 'b.txt', data: 'second' }]);
		const damaged = zip.bytes.slice();
		// The signature of the second central directory header.
		const second = damaged.length - 22 - (46 + 'b.txt'.length);
		damaged[second] = 0;
		assert.deepStrictEqual(await messageOf(readBaseHalfZipEntries(new MemoryFile(damaged))), 'The zip archive is damaged.');
	});
});
