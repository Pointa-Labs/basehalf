/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_FICTIONBOOK_COVER_MAX_BYTES, baseHalfBookFormatOfName, IBaseHalfBookCover, readBaseHalfBookCover } from '../../common/basehalfBookCover.js';
import { IBaseHalfRandomAccessFile } from '../../common/basehalfZipReader.js';
import { concat, inflateRaw, latin1, makeZip, MemoryFile, messageOf, noise } from './basehalfDocumentTestFiles.js';

const encoder = new TextEncoder();

function uint32BigEndian(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value);
	return bytes;
}

function base64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

// #region Pictures

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const JPEG_2 = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const GIF = latin1('GIF89a\x01\x00\x01\x00\x00\x00\x00;');
const WEBP = latin1('RIFF\x0c\x00\x00\x00WEBPVP8 ');
const BMP = latin1('BM\x46\x00\x00\x00\x00\x00\x00\x00\x36\x00\x00\x00\x28\x00\x00\x00');
const AVIF = latin1('\x00\x00\x00\x1cftypavif\x00\x00\x00\x00avifmif1miaf');
const AVIF_COMPATIBLE = latin1('\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00mif1avif');
const SVG = encoder.encode('\uFEFF<?xml version="1.0"?>\n<!-- A cover -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 4"/>');

// #endregion

// #region EPUB

const CONTAINER = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
	'\t<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
	'</container>'
].join('\n');

function packageDocument(metadata: string, manifest: string, guide = ''): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">',
		`<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:1</dc:identifier>${metadata}</metadata>`,
		`<manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>${manifest}</manifest>`,
		'<spine><itemref idref="text"/></spine>',
		guide,
		'</package>'
	].join('\n');
}

/** An EPUB of these files, besides its `mimetype` and its container; text is deflated. */
async function makeEpub(files: Readonly<Record<string, string | Uint8Array>>): Promise<Uint8Array> {
	return (await makeZip([
		{ name: 'mimetype', data: 'application/epub+zip' },
		{ name: 'META-INF/container.xml', data: CONTAINER, deflate: true },
		...Object.entries(files).map(([name, data]) => ({ name, data, deflate: typeof data === 'string' }))
	])).bytes;
}

async function readEpub(files: Readonly<Record<string, string | Uint8Array>>) {
	return readBaseHalfBookCover('epub', new MemoryFile(await makeEpub(files)), inflateRaw);
}

function encryption(algorithm: string, uri: string): string {
	return [
		'<?xml version="1.0"?>',
		'<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">',
		`<enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>`,
		'</encryption>'
	].join('\n');
}

// #endregion

// #region Kindle

interface ITestKindleBook {
	/** The full name in the MOBI header. */
	readonly title: string;
	/** The EXTH records: text, or a number of four bytes. */
	readonly exth?: readonly (readonly [type: number, value: string | number])[];
	readonly encryption?: number;
	/** 65001 for UTF-8 (the default), 1252 for windows-1252. */
	readonly encoding?: number;
	readonly pictures?: readonly Uint8Array[];
}

/** A Palm database with record 0 (PalmDOC, MOBI, and EXTH headers and the full name), one text record, and the pictures. */
function makeKindleBook(book: ITestKindleBook): { readonly bytes: Uint8Array; readonly offsets: readonly number[] } {
	const text = (value: string) => book.encoding === 1252 ? latin1(value) : encoder.encode(value);
	const exthRecords = (book.exth ?? []).map(([type, value]) => {
		const data = typeof value === 'number' ? uint32BigEndian(value) : text(value);
		return concat([uint32BigEndian(type), uint32BigEndian(8 + data.length), data]);
	});
	const exthLength = 12 + exthRecords.reduce((sum, record) => sum + record.length, 0);
	const exth = book.exth
		? concat([latin1('EXTH'), uint32BigEndian(exthLength), uint32BigEndian(exthRecords.length), ...exthRecords, new Uint8Array((4 - exthLength % 4) % 4)])
		: new Uint8Array(0);
	const title = text(book.title);
	const mobiHeaderLength = 232;
	const record0 = new Uint8Array(16 + mobiHeaderLength + exth.length + title.length + 2);
	const view = new DataView(record0.buffer);
	view.setUint16(0, 1); // no compression
	view.setUint32(4, 5); // the length of the text
	view.setUint16(8, 1); // one text record
	view.setUint16(10, 4096);
	view.setUint16(12, book.encryption ?? 0);
	record0.set(latin1('MOBI'), 16);
	view.setUint32(20, mobiHeaderLength);
	view.setUint32(24, 2);
	view.setUint32(28, book.encoding ?? 65001);
	view.setUint32(36, 6);
	view.setUint32(84, 16 + mobiHeaderLength + exth.length);
	view.setUint32(88, title.length);
	view.setUint32(108, 2); // the first picture follows record 0 and the text record
	view.setUint32(128, book.exth ? 0x40 : 0);
	record0.set(exth, 16 + mobiHeaderLength);
	record0.set(title, 16 + mobiHeaderLength + exth.length);

	const records = [record0, latin1('Hello'), ...(book.pictures ?? [])];
	const header = new Uint8Array(78 + records.length * 8 + 2);
	const headerView = new DataView(header.buffer);
	header.set(latin1('Alice_s_Adventures_in_Wonderlan'), 0);
	header.set(latin1('BOOKMOBI'), 60);
	headerView.setUint16(76, records.length);
	const offsets: number[] = [];
	let offset = header.length;
	for (const [index, record] of records.entries()) {
		headerView.setUint32(78 + index * 8, offset);
		headerView.setUint32(78 + index * 8 + 4, index * 2);
		offsets.push(offset);
		offset += record.length;
	}
	return { bytes: concat([header, ...records]), offsets };
}

// #endregion

// #region FictionBook

const FICTION_BOOK_HEAD = [
	'<title-info><genre>child_tale</genre>',
	'<author><first-name>Charles</first-name><middle-name>Lutwidge</middle-name><last-name>Dodgson</last-name></author>',
	'<author><nickname>Lewis Carroll</nickname></author>',
	'<book-title>Alice &amp; the &lt;Looking-Glass&gt;</book-title>',
	'<coverpage><image l:href="#cover.jpg"/></coverpage><lang>en</lang></title-info>',
	'<document-info><author><nickname>maker</nickname></author></document-info>'
].join('\n');

const FICTION_BOOK = [
	'<?xml version="1.0" encoding="utf-8"?>',
	'<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">',
	`<description>${FICTION_BOOK_HEAD}</description>`,
	'<body><section><p>Once upon a time &lt;binary id="cover.jpg"&gt;</p><image l:href="#inside.png"/></section></body>',
	`<binary id="cover.jpg" content-type="image/jpeg">\n${base64(JPEG).replace(/.{8}/g, '$&\n')}\n</binary>`,
	`<binary id="inside.png" content-type="image/png">${base64(PNG)}</binary>`,
	'</FictionBook>'
].join('\n');

const FICTION_BOOK_COVER = {
	picture: { bytes: JPEG, type: 'image/jpeg' },
	title: 'Alice & the <Looking-Glass>',
	authors: ['Charles Lutwidge Dodgson', 'Lewis Carroll']
};

// #endregion

suite('BaseHalfBookCover', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tells the format of a book by its extension', () => {
		const names = ['Alice.EPUB', 'a.mobi', 'b.AZW3', 'c.azw', 'd.fb2', 'e.FBZ', 'f.cbz', 'g.pdf', 'h.cbr', 'epub', 'folder.epub/notes', 'i.fb2.zip', 'j.kfx'];
		assert.deepStrictEqual(names.map(name => baseHalfBookFormatOfName(name)), [
			'epub', 'kindle', 'kindle', 'kindle', 'fictionbook', 'fictionbook', 'comic', undefined, undefined, undefined, undefined, undefined, undefined
		]);
	});

	test('EPUB: takes the item with the property cover-image, and the title and the authors', async () => {
		assert.deepStrictEqual(await readEpub({
			'OEBPS/content.opf': packageDocument([
				'<dc:title>Alice&apos;s Adventures &amp; <![CDATA[<More>]]></dc:title><dc:title>A Subtitle</dc:title>',
				'<dc:creator opf:role="aut">Lewis Carroll</dc:creator><dc:creator>\n  Lewis   Carroll </dc:creator><dc:creator/>',
				'<dc:creator>&#x4E2D;&#25991;</dc:creator><meta name="cover" content="decoy"/>'
			].join(''), [
				'<item id="decoy" href="images/decoy.png" media-type="image/png"/>',
				'<item id="art" href="images/cover.jpg" media-type="image/jpeg" properties="svg cover-image"/>'
			].join('')),
			'OEBPS/images/decoy.png': PNG,
			'OEBPS/images/cover.jpg': JPEG
		}), {
			picture: { bytes: JPEG, type: 'image/jpeg' },
			title: 'Alice\'s Adventures & <More>',
			authors: ['Lewis Carroll', '中文']
		});
	});

	test('EPUB: takes the item that meta name="cover" names, relative to the package and without regard to case', async () => {
		assert.deepStrictEqual(await readEpub({
			'OEBPS/content.opf': [
				'\uFEFF<?xml version=\'1.0\' encoding=\'utf-8\'?>',
				'<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">',
				'<opf:metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Meta &#38; Cover</dc:title><opf:meta name=\'cover\' content=\'cover-id\'/></opf:metadata>',
				'<opf:manifest><opf:item id=\'cover-id\' href=\'../Images/Cover%20Art.PNG\' media-type=\'image/png\'/></opf:manifest>',
				'</opf:package>'
			].join('\n'),
			'images/cover art.png': PNG
		}), {
			picture: { bytes: PNG, type: 'image/png' },
			title: 'Meta & Cover'
		});
	});

	test('EPUB: takes the first picture of the page that the guide names', async () => {
		assert.deepStrictEqual(await readEpub({
			'OEBPS/content.opf': packageDocument('<dc:title>Guide</dc:title>', [
				'<item id="page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>',
				'<item id="front" href="Images/front.jpg" media-type="image/jpeg"/>'
			].join(''), '<guide><reference type="Cover" title="Cover" href="Text/cover.xhtml#start"/></guide>'),
			'OEBPS/Text/cover.xhtml': [
				'<?xml version="1.0" encoding="utf-8"?>',
				'<!DOCTYPE html>',
				'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title><!-- <img src="comment.jpg"/> --></head>',
				'<body><div><img alt="&quot;Front&quot; > back" src="../Images/front.jpg?v=1"/><img src="../Images/second.png"/></div></body></html>'
			].join('\n'),
			'OEBPS/Images/front.jpg': JPEG,
			'OEBPS/Images/second.png': PNG
		}), {
			picture: { bytes: JPEG, type: 'image/jpeg' },
			title: 'Guide'
		});
	});

	test('EPUB: takes the picture of an SVG page that the guide names, sniffing its type', async () => {
		assert.deepStrictEqual(await readEpub({
			'OEBPS/content.opf': packageDocument('<dc:title>SVG</dc:title>', '', '<guide><reference type="cover" href="cover.xhtml"/></guide>'),
			'OEBPS/cover.xhtml': [
				'<html xmlns="http://www.w3.org/1999/xhtml"><body>',
				'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 800">',
				'<image width="600" height="800" xlink:href="images/cover.gif"/></svg></body></html>'
			].join('\n'),
			'OEBPS/images/cover.gif': GIF
		}), {
			picture: { bytes: GIF, type: 'image/gif' },
			title: 'SVG'
		});
	});

	test('EPUB: takes the first picture of the page that meta name="cover" names', async () => {
		assert.deepStrictEqual(await readEpub({
			'OEBPS/content.opf': packageDocument('<dc:title>Meta Page</dc:title><meta name="cover" content="cover-page"/>', '<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>'),
			'OEBPS/cover.xhtml': '<html><body><p><IMG SRC="pictures/cover.bmp"></p></body></html>',
			'OEBPS/pictures/cover.bmp': BMP
		}), {
			picture: { bytes: BMP, type: 'image/bmp' },
			title: 'Meta Page'
		});
	});

	test('EPUB: takes a picture whose id or name says cover when the one named is missing', async () => {
		assert.deepStrictEqual(await readEpub({
			'OEBPS/content.opf': packageDocument('<dc:title>By Name</dc:title>', [
				'<item id="gone" href="images/gone.jpg" media-type="image/jpeg" properties="cover-image"/>',
				'<item id="i1" href="images/a.png" media-type="image/png"/>',
				'<item id="i2" href="images/My-Cover.webp" media-type="image/webp"/>'
			].join('')),
			'OEBPS/images/a.png': PNG,
			'OEBPS/images/My-Cover.webp': WEBP
		}), {
			picture: { bytes: WEBP, type: 'image/webp' },
			title: 'By Name'
		});
	});

	test('EPUB: gives the title and the authors of a book without a cover', async () => {
		assert.deepStrictEqual(await readEpub({
			'OEBPS/content.opf': packageDocument('<dc:title>No Cover</dc:title><dc:creator>Anne</dc:creator>', '<item id="map" href="images/map.png" media-type="image/png"/>'),
			'OEBPS/images/map.png': PNG
		}), {
			title: 'No Cover',
			authors: ['Anne']
		});
	});

	test('EPUB: a book whose content is encrypted is protected; obfuscated fonts are not', async () => {
		const files = (title: string) => ({
			'OEBPS/content.opf': packageDocument(`<dc:title>${title}</dc:title><dc:creator>Someone</dc:creator>`, '<item id="art" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>'),
			'OEBPS/cover.jpg': JPEG
		});
		assert.deepStrictEqual([
			await readEpub({ 'META-INF/encryption.xml': encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'OEBPS/text.xhtml'), ...files('Locked') }),
			await readEpub({ 'META-INF/encryption.xml': encryption('http://www.idpf.org/2008/embedding', 'OEBPS/fonts/a.otf'), ...files('Fonts') })
		], [
			{ protected: true, title: 'Locked', authors: ['Someone'] },
			{ picture: { bytes: JPEG, type: 'image/jpeg' }, title: 'Fonts', authors: ['Someone'] }
		]);
	});

	test('EPUB: reads a large book in small parts, and a picture over 20 MiB not at all', async () => {
		const huge = new Uint8Array(21 * 1024 * 1024);
		huge.set(JPEG);
		const large = new MemoryFile(await makeEpub({
			'OEBPS/filler.bin': new Uint8Array(4 * 1024 * 1024),
			'OEBPS/content.opf': packageDocument('<dc:title>Large</dc:title>', '<item id="art" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>'),
			'OEBPS/cover.jpg': JPEG
		}));
		const withHugePicture = new MemoryFile(await makeEpub({
			'OEBPS/content.opf': packageDocument('<dc:title>Huge</dc:title>', '<item id="art" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>'),
			'OEBPS/cover.jpg': huge
		}));
		const covers = [await readBaseHalfBookCover('epub', large, inflateRaw), await readBaseHalfBookCover('epub', withHugePicture, inflateRaw)];
		assert.deepStrictEqual({ covers, readBelow96KiB: [large.bytesRead < 96 * 1024, withHugePicture.bytesRead < 96 * 1024] }, {
			covers: [{ picture: { bytes: JPEG, type: 'image/jpeg' }, title: 'Large' }, { title: 'Huge' }],
			readBelow96KiB: [true, true]
		});
	});

	test('EPUB: throws a plain message for a damaged book', async () => {
		const withoutPackage = await makeZip([{ name: 'mimetype', data: 'application/epub+zip' }]);
		assert.deepStrictEqual([
			await messageOf(readBaseHalfBookCover('epub', new MemoryFile(noise(4096)), inflateRaw)),
			await messageOf(readBaseHalfBookCover('epub', new MemoryFile(withoutPackage.bytes), inflateRaw))
		], [
			'The file is not a zip archive.',
			'The EPUB holds no package document.'
		]);
	});

	test('Kindle: takes the cover that EXTH 201 names, reading only the headers, the record table, record 0, and the picture', async () => {
		const book = makeKindleBook({
			title: 'Header Title',
			exth: [[100, 'Lewis Carroll'], [100, 'John Tenniel'], [100, 'Lewis Carroll'], [503, 'Alice&apos;s Adventures in Wonderland'], [201, 0], [202, 1]],
			pictures: [JPEG, PNG]
		});
		const file = new MemoryFile(book.bytes);
		const cover = await readBaseHalfBookCover('kindle', file, inflateRaw);
		assert.deepStrictEqual({ cover, reads: file.reads }, {
			cover: { picture: { bytes: JPEG, type: 'image/jpeg' }, title: 'Alice\'s Adventures in Wonderland', authors: ['Lewis Carroll', 'John Tenniel'] },
			reads: [[0, 78], [78, 4 * 8], [book.offsets[0], book.offsets[1] - book.offsets[0]], [book.offsets[2], JPEG.length]]
		});
	});

	test('Kindle: a book with DRM is protected, with its title and authors, and its picture is not read', async () => {
		const book = makeKindleBook({ title: 'Locked Book', exth: [[100, 'Someone'], [201, 0]], encryption: 2, pictures: [JPEG] });
		const file = new MemoryFile(book.bytes);
		const cover = await readBaseHalfBookCover('kindle', file, inflateRaw);
		assert.deepStrictEqual({ cover, reads: file.reads.length }, {
			cover: { protected: true, title: 'Locked Book', authors: ['Someone'] },
			reads: 3
		});
	});

	test('Kindle: takes the thumbnail when no cover is named, and reads windows-1252', async () => {
		const book = makeKindleBook({ title: 'Café au lait', encoding: 1252, exth: [[201, 0xffffffff], [202, 1]], pictures: [JPEG, PNG] });
		assert.deepStrictEqual(await readBaseHalfBookCover('kindle', new MemoryFile(book.bytes), inflateRaw), {
			picture: { bytes: PNG, type: 'image/png' },
			title: 'Café au lait'
		});
	});

	test('Kindle: gives no picture when the headers name none', async () => {
		const books = [
			makeKindleBook({ title: 'No Cover', exth: [[100, 'Anne']], pictures: [JPEG] }),
			makeKindleBook({ title: 'No EXTH', pictures: [JPEG] }),
			makeKindleBook({ title: 'Out of Range', exth: [[201, 7]], pictures: [JPEG] })
		];
		const covers: IBaseHalfBookCover[] = [];
		for (const book of books) {
			covers.push(await readBaseHalfBookCover('kindle', new MemoryFile(book.bytes), inflateRaw));
		}
		assert.deepStrictEqual(covers, [{ title: 'No Cover', authors: ['Anne'] }, { title: 'No EXTH' }, { title: 'Out of Range' }]);
	});

	test('sniffs the type of a picture that the file does not name', async () => {
		const samples = [JPEG, PNG, GIF, WEBP, BMP, AVIF, AVIF_COMPATIBLE, SVG, encoder.encode('<?xml version="1.0"?><html><body><svg/></body></html>'), encoder.encode('BM, but no picture')];
		const types: (string | undefined)[] = [];
		for (const sample of samples) {
			const book = makeKindleBook({ title: 'Sample', exth: [[201, 0]], pictures: [sample] });
			types.push((await readBaseHalfBookCover('kindle', new MemoryFile(book.bytes), inflateRaw)).picture?.type);
		}
		assert.deepStrictEqual(types, ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/avif', 'image/svg+xml', 'application/octet-stream', 'application/octet-stream']);
	});

	test('Kindle: throws a plain message for a file that is no Kindle book', async () => {
		const palmDoc = makeKindleBook({ title: 'PalmDOC' });
		const notMobi = palmDoc.bytes.slice();
		notMobi.set(latin1('TEXtREAd'), 60);
		notMobi.set(latin1('NONE'), palmDoc.offsets[0] + 16);
		assert.deepStrictEqual([
			await messageOf(readBaseHalfBookCover('kindle', new MemoryFile(noise(4096)), inflateRaw)),
			await messageOf(readBaseHalfBookCover('kindle', new MemoryFile(new Uint8Array(10)), inflateRaw)),
			await messageOf(readBaseHalfBookCover('kindle', new MemoryFile(notMobi), inflateRaw))
		], [
			'The file is not a Kindle book that BaseHalf can read.',
			'The file is not a Kindle book that BaseHalf can read.',
			'The file is not a Kindle book that BaseHalf can read.'
		]);
	});

	test('FictionBook: takes the picture of the coverpage, the title, and the authors of the title-info', async () => {
		assert.deepStrictEqual(await readBaseHalfBookCover('fictionbook', new MemoryFile(encoder.encode(FICTION_BOOK)), inflateRaw), FICTION_BOOK_COVER);
	});

	test('FictionBook: reads windows-1251', async () => {
		const book = latin1([
			'<?xml version="1.0" encoding="windows-1251"?>',
			'<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:xlink="http://www.w3.org/1999/xlink"><description><title-info>',
			'<author><first-name>\xCB\xE5\xE2</first-name><middle-name>\xCD\xE8\xEA\xEE\xEB\xE0\xE5\xE2\xE8\xF7</middle-name><last-name>\xD2\xEE\xEB\xF1\xF2\xEE\xE9</last-name></author>',
			'<book-title>\xC2\xEE\xE9\xED\xE0 \xE8 \xEC\xE8\xF0</book-title>',
			'<coverpage><image xlink:href="#\xEE\xE1\xEB\xEE\xE6\xEA\xE0.png"/></coverpage></title-info></description>',
			'<body><p>\xD2\xE5\xEA\xF1\xF2</p></body>',
			`<binary content-type="image/png" id="\xEE\xE1\xEB\xEE\xE6\xEA\xE0.png">${base64(PNG)}</binary></FictionBook>`
		].join('\n'));
		assert.deepStrictEqual(await readBaseHalfBookCover('fictionbook', new MemoryFile(book), inflateRaw), {
			picture: { bytes: PNG, type: 'image/png' },
			title: 'Война и мир',
			authors: ['Лев Николаевич Толстой']
		});
	});

	test('FictionBook: reads the book in an .fbz archive', async () => {
		const archive = await makeZip([
			{ name: 'readme.txt', data: 'Not the book' },
			{ name: 'Alice.FB2', data: FICTION_BOOK, deflate: true }
		]);
		assert.deepStrictEqual(await readBaseHalfBookCover('fictionbook', new MemoryFile(archive.bytes), inflateRaw), FICTION_BOOK_COVER);
	});

	test('FictionBook: gives no cover for a book too large to read whole, and no picture for a binary it does not hold', async () => {
		const reads: [number, number][] = [];
		const tooLarge: IBaseHalfRandomAccessFile = {
			size: BASEHALF_FICTIONBOOK_COVER_MAX_BYTES + 1,
			read: async (offset, length) => {
				reads.push([offset, length]);
				return encoder.encode('<?xml version="1.0"?>').slice(offset, offset + length);
			}
		};
		const missing = encoder.encode(FICTION_BOOK.replace('#cover.jpg', '#missing.jpg'));
		assert.deepStrictEqual({
			tooLarge: await readBaseHalfBookCover('fictionbook', tooLarge, inflateRaw),
			reads,
			missing: await readBaseHalfBookCover('fictionbook', new MemoryFile(missing), inflateRaw)
		}, {
			tooLarge: {},
			reads: [[0, 4]],
			missing: { title: FICTION_BOOK_COVER.title, authors: FICTION_BOOK_COVER.authors }
		});
	});

	test('FictionBook: throws a plain message for a file that is no FictionBook', async () => {
		assert.deepStrictEqual([
			await messageOf(readBaseHalfBookCover('fictionbook', new MemoryFile(encoder.encode('<html><body>No book</body></html>')), inflateRaw)),
			await messageOf(readBaseHalfBookCover('fictionbook', new MemoryFile(noise(4096)), inflateRaw))
		], [
			'The file is not a FictionBook.',
			'The file is not a FictionBook.'
		]);
	});

	test('comic: takes the first picture in natural name order, without hidden files and macOS metadata', async () => {
		const archive = await makeZip([
			{ name: '__MACOSX/._1.jpg', data: latin1('\x00\x05\x16\x07') },
			{ name: '.hidden.png', data: PNG },
			{ name: 'Extras/', data: '' },
			{ name: 'Extras/1.png', data: PNG },
			{ name: '10.jpg', data: JPEG },
			{ name: 'notes.txt', data: 'Not a page' },
			{ name: '2.JPG', data: JPEG_2, deflate: true }
		]);
		assert.deepStrictEqual(await readBaseHalfBookCover('comic', new MemoryFile(archive.bytes), inflateRaw), {
			picture: { bytes: JPEG_2, type: 'image/jpeg' }
		});
	});

	test('comic: gives nothing for an archive without pictures, and throws for a file that is no archive', async () => {
		const withoutPictures = await makeZip([{ name: 'notes.txt', data: 'No pages' }]);
		assert.deepStrictEqual([
			await readBaseHalfBookCover('comic', new MemoryFile(withoutPictures.bytes), inflateRaw),
			await messageOf(readBaseHalfBookCover('comic', new MemoryFile(noise(1024)), inflateRaw))
		], [
			{},
			'The file is not a zip archive.'
		]);
	});
});
