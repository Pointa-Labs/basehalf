/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfInflateRaw, IBaseHalfRandomAccessFile, IBaseHalfZipEntry, isBaseHalfZip, readBaseHalfZipEntries, readBaseHalfZipEntry } from './basehalfZipReader.js';

/** The formats of books (PDFs and books, "The formats"). */
export type BaseHalfBookFormat = 'epub' | 'kindle' | 'fictionbook' | 'comic';

export interface IBaseHalfBookCoverPicture {
	readonly bytes: Uint8Array;
	/** The picture's media type, such as image/jpeg; from the file when it says, else sniffed from the bytes (JPEG, PNG, GIF, WebP, SVG, BMP, AVIF), else 'application/octet-stream'. */
	readonly type: string;
}

export interface IBaseHalfBookCover {
	readonly picture?: IBaseHalfBookCoverPicture;
	readonly title?: string;
	readonly authors?: readonly string[];
	/** The book is protected with DRM: nothing of it can be read. */
	readonly protected?: true;
}

/** A FictionBook is read whole; one larger than this has no cover. */
export const BASEHALF_FICTIONBOOK_COVER_MAX_BYTES = 64 * 1024 * 1024;

/** A larger picture is no cover, so that a cover never needs much memory. */
const PICTURE_MAX_BYTES = 20 * 1024 * 1024;
/** The most of a container, a package document, or a page that is read. */
const MARKUP_MAX_BYTES = 16 * 1024 * 1024;
/** The most of a Kindle book's first record that is read: its headers. */
const KINDLE_HEADERS_MAX_BYTES = 1024 * 1024;
/** The most characters of a title or a name that are read. */
const TEXT_MAX_CHARACTERS = 4096;
/** The most authors that are read. */
const AUTHORS_MAX = 100;
const UNKNOWN_TYPE = 'application/octet-stream';

const FORMATS = new Map<string, BaseHalfBookFormat>([
	['epub', 'epub'],
	['mobi', 'kindle'],
	['azw3', 'kindle'],
	['azw', 'kindle'],
	['fb2', 'fictionbook'],
	['fbz', 'fictionbook'],
	['cbz', 'comic']
]);

/** The format of a book file by its name's extension, without regard to case: .epub → epub; .mobi .azw3 .azw → kindle; .fb2 .fbz → fictionbook; .cbz → comic; anything else undefined. */
export function baseHalfBookFormatOfName(name: string): BaseHalfBookFormat | undefined {
	const extension = /\.(?<extension>[^./\\]+)$/.exec(name)?.groups?.extension;
	return extension === undefined ? undefined : FORMATS.get(extension.toLowerCase());
}

/** Reads a book's cover picture, title, and authors. Never throws for a book without a cover or without metadata (returns what it found); throws an Error with a plain message for a file it cannot read at all (damaged). */
export async function readBaseHalfBookCover(format: BaseHalfBookFormat, file: IBaseHalfRandomAccessFile, inflateRaw: BaseHalfInflateRaw): Promise<IBaseHalfBookCover> {
	switch (format) {
		case 'epub':
			return readEpubCover(file, inflateRaw);
		case 'kindle':
			return readKindleCover(file);
		case 'fictionbook':
			return readFictionBookCover(file, inflateRaw);
		case 'comic':
			return readComicCover(file, inflateRaw);
	}
}

// #region Bytes and text

const utf8Decoder = new TextDecoder('utf-8');

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
	return bytes[offset] << 8 | bytes[offset + 1];
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
}

/** The bytes as one character each, for signatures and declarations. */
function asciiOf(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Exactly `length` bytes at `offset`, or an error with `message` when the file holds fewer. */
async function readFully(file: IBaseHalfRandomAccessFile, offset: number, length: number, message: string): Promise<Uint8Array> {
	if (offset < 0 || length < 0 || offset + length > file.size) {
		throw new Error(message);
	}
	const bytes = length === 0 ? new Uint8Array(0) : await file.read(offset, length);
	if (bytes.length < length) {
		throw new Error(message);
	}
	return bytes.length === length ? bytes : bytes.subarray(0, length);
}

function decodeText(bytes: Uint8Array, label: string): string {
	let decoder = utf8Decoder;
	try {
		decoder = new TextDecoder(label);
	} catch {
		// A label that no decoder knows is read as UTF-8.
	}
	return decoder.decode(bytes);
}

/** The text encoding of XML: from its byte order mark, else from its declaration, else UTF-8. */
function xmlEncodingOf(bytes: Uint8Array): string {
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return 'utf-16be';
	}
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return 'utf-16le';
	}
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return 'utf-8';
	}
	const label = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["'](?<label>[^"']+)["']/.exec(asciiOf(bytes, 0, 512))?.groups?.label.trim().toLowerCase();
	// A declaration that reads one byte to a character is in no UTF-16.
	return !label || label.startsWith('utf-16') ? 'utf-8' : label;
}

function decodeXml(bytes: Uint8Array): string {
	return decodeText(bytes, xmlEncodingOf(bytes));
}

const NAMED_ENTITIES = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', '\'']]);

function decodeXmlEntities(value: string): string {
	if (!value.includes('&')) {
		return value;
	}
	return value.replace(/&(?<entity>#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (reference: string, entity: string) => {
		if (!entity.startsWith('#')) {
			return NAMED_ENTITIES.get(entity) ?? reference;
		}
		const codePoint = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
		return codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff) ? String.fromCodePoint(codePoint) : reference;
	});
}

/** A name or a title on one line: runs of white space and control characters made one space. */
function cleanText(value: string): string {
	return value.replace(/[\s\u0000-\u001f]+/g, ' ').trim();
}

/** The values cleaned, without empty ones and without repeats, in their order. */
function distinct(values: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const value of values) {
		const cleaned = cleanText(value);
		if (cleaned) {
			seen.add(cleaned);
		}
	}
	return [...seen];
}

function decodeBase64(value: string): Uint8Array | undefined {
	let binary: string;
	try {
		binary = atob(value);
	} catch {
		return undefined;
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

// #endregion

// #region XML without a DOM

interface IXmlElement {
	/** The local name in lower case, without its prefix. */
	readonly name: string;
	/** The values by the attributes' local names in lower case, without their prefixes; the first of a name wins. */
	readonly attributes: ReadonlyMap<string, string>;
	/** Where the start tag begins. */
	readonly start: number;
	/** Where the content begins, after the start tag. */
	readonly contentStart: number;
	/** Where the content ends: at the end tag, at the end tag that closed the element's parent, or at the end of the text. */
	contentEnd: number;
}

function localName(name: string): string {
	return name.slice(name.lastIndexOf(':') + 1).toLowerCase();
}

function readAttributes(source: string): Map<string, string> {
	const attributes = new Map<string, string>();
	for (const match of source.matchAll(/(?<name>[^\s=]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"']+)))?/g)) {
		const groups = match.groups;
		const name = groups && localName(groups.name);
		if (groups && name && !attributes.has(name)) {
			attributes.set(name, decodeXmlEntities(groups.double ?? groups.single ?? groups.bare ?? ''));
		}
	}
	return attributes;
}

/** Where the tag that begins at `start` ends (its `>`), with quoted values and the internal subset of a document type skipped, or -1. */
function findTagEnd(text: string, start: number): number {
	let position = start + 1;
	if (/^<!doctype/i.test(text.slice(start, start + 9))) {
		const end = text.indexOf('>', start);
		const subset = end < 0 ? -1 : text.slice(start, end).indexOf('[');
		if (subset >= 0) {
			position = text.indexOf(']', start + subset);
			if (position < 0) {
				return -1;
			}
		}
	}
	while (position < text.length) {
		const character = text.charCodeAt(position);
		if (character === 0x3e /* > */) {
			return position;
		}
		if (character === 0x22 /* " */ || character === 0x27 /* ' */) {
			const close = text.indexOf(text[position], position + 1);
			if (close < 0) {
				return -1;
			}
			position = close + 1;
		} else {
			position++;
		}
	}
	return -1;
}

/**
 * The elements of XML or HTML in the order of their start tags, read without
 * a DOM. Comments, CDATA sections, declarations, and processing instructions
 * are skipped. An element that is not closed ends where its parent ends, as
 * an `<img>` of HTML does. A construct that is not closed ends the reading.
 */
function readXmlElements(text: string): IXmlElement[] {
	const elements: IXmlElement[] = [];
	const open: IXmlElement[] = [];
	// How many elements of each name are open, so that an end tag of none is passed at once.
	const openCounts = new Map<string, number>();
	let position = text.indexOf('<');
	while (position >= 0) {
		let next: number;
		if (text.startsWith('<!--', position)) {
			const end = text.indexOf('-->', position + 4);
			next = end < 0 ? -1 : end + 3;
		} else if (text.startsWith('<![CDATA[', position)) {
			const end = text.indexOf(']]>', position + 9);
			next = end < 0 ? -1 : end + 3;
		} else if (!/[A-Za-z_/!?]/.test(text.charAt(position + 1))) {
			next = position + 1;
		} else {
			const end = findTagEnd(text, position);
			next = end < 0 ? -1 : end + 1;
			const body = end < 0 ? '' : text.slice(position + 1, end).trimEnd();
			const tag = /^\/?(?<name>[A-Za-z_][^\s/]*)/.exec(body);
			const name = tag?.groups ? localName(tag.groups.name) : undefined;
			if (tag && name !== undefined && body.startsWith('/')) {
				if (openCounts.get(name)) {
					for (const element of open.splice(open.findLastIndex(candidate => candidate.name === name))) {
						element.contentEnd = position;
						openCounts.set(element.name, (openCounts.get(element.name) ?? 1) - 1);
					}
				}
			} else if (tag && name !== undefined) {
				const selfClosing = body.endsWith('/');
				const element: IXmlElement = {
					name,
					attributes: readAttributes(body.slice(tag[0].length, selfClosing ? -1 : undefined)),
					start: position,
					contentStart: next,
					contentEnd: selfClosing ? next : text.length
				};
				elements.push(element);
				if (!selfClosing) {
					open.push(element);
					openCounts.set(name, (openCounts.get(name) ?? 0) + 1);
				}
			}
		}
		position = next < 0 ? -1 : text.indexOf('<', next);
	}
	return elements;
}

/** Whether `element` begins inside the content of `parent`. */
function isWithin(element: IXmlElement, parent: IXmlElement): boolean {
	return element.start >= parent.contentStart && element.start < parent.contentEnd;
}

/**
 * The text of an element on one line: tags and comments left out, CDATA kept
 * as it is, entities decoded. Only the first characters are read, so that an
 * element that is not closed costs no more than one that is.
 */
function xmlTextOf(text: string, element: IXmlElement): string {
	let result = '';
	for (const part of text.slice(element.contentStart, Math.min(element.contentEnd, element.contentStart + TEXT_MAX_CHARACTERS)).matchAll(/<!\[CDATA\[(?<cdata>[\s\S]*?)(?:\]\]>|$)|<!--[\s\S]*?(?:-->|$)|<[^>]*(?:>|$)|(?<plain>[^<]+)/g)) {
		const cdata = part.groups?.cdata;
		const plain = part.groups?.plain;
		result += cdata ?? (plain === undefined ? '' : decodeXmlEntities(plain));
	}
	return result.replace(/\s+/g, ' ').trim();
}

// #endregion

// #region Pictures

const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
	return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function isAvif(bytes: Uint8Array): boolean {
	// The file type box lists its major brand, a version, and its compatible brands.
	const end = Math.min(bytes.length, uint32BigEndian(bytes, 0), 256);
	for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
		const brand = asciiOf(bytes, offset, 4);
		if (brand === 'avif' || brand === 'avis') {
			return true;
		}
	}
	return false;
}

function isSvg(bytes: Uint8Array): boolean {
	const text = utf8Decoder.decode(bytes.subarray(0, 4096));
	let position = 0;
	while (position < text.length) {
		const start = text.slice(position).search(/\S/);
		if (start < 0) {
			return false;
		}
		position += start;
		const end = text.startsWith('<?', position) ? text.indexOf('?>', position) + 2
			: text.startsWith('<!--', position) ? text.indexOf('-->', position) + 3
				: text.startsWith('<!', position) ? text.indexOf('>', position) + 1
					: -1;
		if (end < 0) {
			break;
		}
		if (end <= position) {
			return false;
		}
		position = end;
	}
	return /^<(?:[\w.-]+:)?svg[\s/>]/i.test(text.slice(position));
}

/** The media type of a picture by its first bytes, or undefined. */
function sniffPictureType(bytes: Uint8Array): string | undefined {
	if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
		return 'image/jpeg';
	}
	if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return 'image/png';
	}
	const head = asciiOf(bytes, 0, 12);
	if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) {
		return 'image/gif';
	}
	if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
		return 'image/webp';
	}
	if (head.startsWith('BM') && bytes.length >= 18 && BMP_HEADER_SIZES.has(uint32LittleEndian(bytes, 14))) {
		return 'image/bmp';
	}
	if (head.slice(4, 8) === 'ftyp' && isAvif(bytes)) {
		return 'image/avif';
	}
	return isSvg(bytes) ? 'image/svg+xml' : undefined;
}

/** A media type without its parameters, in lower case. */
function mediaTypeOf(value: string | undefined): string {
	return (value ?? '').split(';')[0].trim().toLowerCase();
}

function pictureOf(bytes: Uint8Array, declaredType?: string): IBaseHalfBookCoverPicture {
	const declared = mediaTypeOf(declaredType);
	if (declared.startsWith('image/')) {
		return { bytes, type: declared === 'image/jpg' ? 'image/jpeg' : declared };
	}
	return { bytes, type: sniffPictureType(bytes) ?? UNKNOWN_TYPE };
}

function isPictureName(path: string): boolean {
	return /\.(?:jpe?g|png|gif|webp|bmp|avif|svg)$/i.test(path);
}

interface IBookCoverParts {
	readonly picture?: IBaseHalfBookCoverPicture;
	readonly title?: string;
	readonly authors?: readonly string[];
	readonly isProtected?: boolean;
}

/** A cover with only the parts that were found. */
function bookCover(parts: IBookCoverParts): IBaseHalfBookCover {
	const cover: { picture?: IBaseHalfBookCoverPicture; title?: string; authors?: readonly string[]; protected?: true } = {};
	const title = parts.title === undefined ? '' : cleanText(parts.title);
	const authors = distinct(parts.authors ?? []);
	if (parts.picture && !parts.isProtected) {
		cover.picture = parts.picture;
	}
	if (title) {
		cover.title = title;
	}
	if (authors.length) {
		cover.authors = authors;
	}
	if (parts.isProtected) {
		cover.protected = true;
	}
	return cover;
}

// #endregion

// #region Archives

/** A zip archive whose entries are found by their exact names, else without regard to case. */
class BookArchive {

	static async open(file: IBaseHalfRandomAccessFile, inflateRaw: BaseHalfInflateRaw): Promise<BookArchive> {
		return new BookArchive(file, inflateRaw, await readBaseHalfZipEntries(file));
	}

	private readonly byName = new Map<string, IBaseHalfZipEntry>();
	private readonly byFoldedName = new Map<string, IBaseHalfZipEntry>();

	private constructor(
		private readonly file: IBaseHalfRandomAccessFile,
		private readonly inflateRaw: BaseHalfInflateRaw,
		public readonly entries: readonly IBaseHalfZipEntry[]
	) {
		for (const entry of entries) {
			if (!this.byName.has(entry.name)) {
				this.byName.set(entry.name, entry);
			}
			const folded = entry.name.toLowerCase();
			if (!this.byFoldedName.has(folded)) {
				this.byFoldedName.set(folded, entry);
			}
		}
	}

	find(path: string): IBaseHalfZipEntry | undefined {
		return this.byName.get(path) ?? this.byFoldedName.get(path.toLowerCase());
	}

	read(entry: IBaseHalfZipEntry, maxSize: number): Promise<Uint8Array> {
		return readBaseHalfZipEntry(this.file, entry, this.inflateRaw, maxSize);
	}

	/** The picture at `path`, or undefined when there is none, it is empty or larger than a cover may be, or it cannot be read. */
	async readPicture(path: string, declaredType?: string): Promise<IBaseHalfBookCoverPicture | undefined> {
		const entry = this.find(path);
		if (!entry || entry.size === 0 || entry.size > PICTURE_MAX_BYTES) {
			return undefined;
		}
		let bytes: Uint8Array;
		try {
			bytes = await this.read(entry, PICTURE_MAX_BYTES);
		} catch {
			return undefined;
		}
		return bytes.length ? pictureOf(bytes, declaredType) : undefined;
	}
}

// #endregion

// #region EPUB

const PACKAGE_MEDIA_TYPE = 'application/oebps-package+xml';
/** Font obfuscation, which every reader undoes; any other encryption is DRM. */
const FONT_OBFUSCATION_ALGORITHMS = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

interface IManifestItem {
	readonly id: string;
	readonly href: string;
	/** The entry the item names, relative to the archive's root. */
	readonly path: string | undefined;
	readonly mediaType: string;
	readonly properties: readonly string[];
}

function folderOf(path: string): string {
	return path.slice(0, path.lastIndexOf('/') + 1);
}

/** The archive path that `href` names from `folder`: without fragment and query, percent-decoded, `.` and `..` resolved; undefined for a link out of the archive. */
function resolvePath(folder: string, href: string): string | undefined {
	const reference = href.trim().replace(/[?#][\s\S]*$/, '');
	if (!reference || /^[a-z][a-z0-9+.-]*:/i.test(reference)) {
		return undefined;
	}
	let decoded = reference;
	try {
		decoded = decodeURIComponent(reference);
	} catch {
		// A percent sign that begins no escape stays as it is.
	}
	const segments: string[] = [];
	for (const segment of (decoded.startsWith('/') ? decoded : folder + decoded).split('/')) {
		if (segment === '..') {
			segments.pop();
		} else if (segment && segment !== '.') {
			segments.push(segment);
		}
	}
	return segments.length ? segments.join('/') : undefined;
}

function tokensOf(value: string | undefined): string[] {
	return (value ?? '').toLowerCase().split(/\s+/).filter(token => token.length > 0);
}

function samePath(path: string | undefined, other: string): boolean {
	return path !== undefined && path.toLowerCase() === other.toLowerCase();
}

function isPictureItem(item: IManifestItem): boolean {
	return item.mediaType.startsWith('image/') || (!item.mediaType && item.path !== undefined && isPictureName(item.path));
}

/** The path of the package document: the first that the container names, else the archive's first `.opf` entry. */
async function findPackageEntry(archive: BookArchive): Promise<IBaseHalfZipEntry | undefined> {
	const container = archive.find('META-INF/container.xml');
	if (container) {
		const text = decodeXml(await archive.read(container, MARKUP_MAX_BYTES));
		const rootfiles = readXmlElements(text).filter(element => element.name === 'rootfile' && element.attributes.get('full-path'));
		const rootfile = rootfiles.find(element => mediaTypeOf(element.attributes.get('media-type') ?? PACKAGE_MEDIA_TYPE) === PACKAGE_MEDIA_TYPE) ?? rootfiles[0];
		const path = rootfile && resolvePath('', rootfile.attributes.get('full-path') ?? '');
		const entry = path === undefined ? undefined : archive.find(path);
		if (entry) {
			return entry;
		}
	}
	return archive.entries.find(entry => entry.name.toLowerCase().endsWith('.opf'));
}

/** Whether `META-INF/encryption.xml` encrypts anything other than fonts. */
async function isEpubProtected(archive: BookArchive): Promise<boolean> {
	const entry = archive.find('META-INF/encryption.xml');
	if (!entry) {
		return false;
	}
	let text: string;
	try {
		text = decodeXml(await archive.read(entry, MARKUP_MAX_BYTES));
	} catch {
		return false;
	}
	return readXmlElements(text).some(element => element.name === 'encryptionmethod' && !FONT_OBFUSCATION_ALGORITHMS.has((element.attributes.get('algorithm') ?? '').trim()));
}

class EpubCoverFinder {

	private readonly tried = new Set<string>();

	constructor(
		private readonly archive: BookArchive,
		private readonly items: readonly IManifestItem[]
	) { }

	/** The picture of a manifest item: the item itself, or the first picture of the page it is. */
	async ofItem(item: IManifestItem | undefined): Promise<IBaseHalfBookCoverPicture | undefined> {
		if (!item?.path) {
			return undefined;
		}
		return isPictureItem(item) ? this.ofPicture(item.path, item.mediaType) : this.ofPage(item.path);
	}

	/** The picture at a path: a picture, or the first picture of a page. */
	async ofPath(path: string | undefined): Promise<IBaseHalfBookCoverPicture | undefined> {
		if (path === undefined) {
			return undefined;
		}
		const item = this.items.find(candidate => samePath(candidate.path, path));
		if (item) {
			return this.ofItem(item);
		}
		return isPictureName(path) ? this.ofPicture(path) : this.ofPage(path);
	}

	private async ofPicture(path: string, mediaType?: string): Promise<IBaseHalfBookCoverPicture | undefined> {
		if (this.tried.has(path)) {
			return undefined;
		}
		this.tried.add(path);
		return this.archive.readPicture(path, mediaType || this.items.find(item => samePath(item.path, path))?.mediaType);
	}

	/** The first `<img src>` or SVG `<image href>` of a page, relative to the page. */
	private async ofPage(path: string): Promise<IBaseHalfBookCoverPicture | undefined> {
		const entry = this.archive.find(path);
		if (!entry || this.tried.has(entry.name)) {
			return undefined;
		}
		this.tried.add(entry.name);
		let text: string;
		try {
			text = decodeXml(await this.archive.read(entry, MARKUP_MAX_BYTES));
		} catch {
			return undefined;
		}
		const image = readXmlElements(text).find(element => (element.name === 'img' && element.attributes.has('src')) || (element.name === 'image' && element.attributes.has('href')));
		const source = image?.attributes.get(image.name === 'img' ? 'src' : 'href');
		const target = source === undefined ? undefined : resolvePath(folderOf(entry.name), source);
		return target === undefined ? undefined : this.ofPicture(target);
	}
}

async function readEpubCover(file: IBaseHalfRandomAccessFile, inflateRaw: BaseHalfInflateRaw): Promise<IBaseHalfBookCover> {
	const archive = await BookArchive.open(file, inflateRaw);
	const packageEntry = await findPackageEntry(archive);
	if (!packageEntry) {
		throw new Error('The EPUB holds no package document.');
	}
	const text = decodeXml(await archive.read(packageEntry, MARKUP_MAX_BYTES));
	const elements = readXmlElements(text);
	const title = elements.find(element => element.name === 'title');
	const metadata = {
		title: title && xmlTextOf(text, title),
		authors: elements.filter(element => element.name === 'creator').slice(0, AUTHORS_MAX).map(element => xmlTextOf(text, element))
	};
	if (await isEpubProtected(archive)) {
		return bookCover({ ...metadata, isProtected: true });
	}

	const folder = folderOf(packageEntry.name);
	const items: IManifestItem[] = elements.filter(element => element.name === 'item').map(element => {
		const href = element.attributes.get('href') ?? '';
		return {
			id: element.attributes.get('id') ?? '',
			href,
			path: resolvePath(folder, href),
			mediaType: mediaTypeOf(element.attributes.get('media-type')),
			properties: tokensOf(element.attributes.get('properties'))
		};
	});
	const finder = new EpubCoverFinder(archive, items);
	const coverId = elements.find(element => element.name === 'meta' && element.attributes.get('name')?.trim().toLowerCase() === 'cover')?.attributes.get('content')?.trim();
	const guideHref = elements.find(element => element.name === 'reference' && tokensOf(element.attributes.get('type')).includes('cover'))?.attributes.get('href');
	const attempts: (() => Promise<IBaseHalfBookCoverPicture | undefined>)[] = [
		() => finder.ofItem(items.find(item => item.properties.includes('cover-image'))),
		() => finder.ofItem(coverId === undefined ? undefined : items.find(item => item.id === coverId) ?? items.find(item => item.href === coverId)),
		() => finder.ofPath(guideHref === undefined ? undefined : resolvePath(folder, guideHref)),
		() => finder.ofItem(items.find(item => isPictureItem(item) && [item.id, item.href].some(value => value.toLowerCase().includes('cover'))))
	];
	for (const attempt of attempts) {
		const picture = await attempt();
		if (picture) {
			return bookCover({ ...metadata, picture });
		}
	}
	return bookCover(metadata);
}

// #endregion

// #region Kindle

const NOT_KINDLE = 'The file is not a Kindle book that BaseHalf can read.';
const PDB_HEADER_LENGTH = 78;
const NO_RECORD = 0xffffffff;
const EXTH_AUTHOR = 100;
const EXTH_COVER_OFFSET = 201;
const EXTH_THUMBNAIL_OFFSET = 202;
const EXTH_TITLE = 503;

/** An unsigned number of up to four bytes, high byte first. */
function uintOf(bytes: Uint8Array): number {
	let value = 0;
	for (const byte of bytes.subarray(0, 4)) {
		value = value * 256 + byte;
	}
	return value;
}

/**
 * A Kindle book (Mobipocket, KF8, or both in one file) is a Palm database.
 * Its first record holds the PalmDOC and MOBI headers and the EXTH metadata,
 * which name the record of the cover. Only the database's header, its table
 * of records, the first record, and the cover's record are read.
 */
async function readKindleCover(file: IBaseHalfRandomAccessFile): Promise<IBaseHalfBookCover> {
	const header = await readFully(file, 0, PDB_HEADER_LENGTH, NOT_KINDLE);
	const recordCount = uint16BigEndian(header, 76);
	const table = await readFully(file, PDB_HEADER_LENGTH, recordCount * 8, NOT_KINDLE);
	const recordStart = (index: number) => uint32BigEndian(table, index * 8);
	const recordEnd = (index: number) => index + 1 < recordCount ? recordStart(index + 1) : file.size;
	if (recordCount === 0 || recordEnd(0) <= recordStart(0) || recordEnd(0) > file.size) {
		throw new Error(NOT_KINDLE);
	}
	const record = await readFully(file, recordStart(0), Math.min(recordEnd(0) - recordStart(0), KINDLE_HEADERS_MAX_BYTES), NOT_KINDLE);
	if (record.length < 24 || asciiOf(record, 16, 4) !== 'MOBI') {
		throw new Error(NOT_KINDLE);
	}

	const encrypted = uint16BigEndian(record, 12) !== 0;
	const headerLength = uint32BigEndian(record, 20);
	const headerEnd = Math.min(record.length, 16 + headerLength);
	const field = (offset: number) => offset + 4 <= headerEnd ? uint32BigEndian(record, offset) : undefined;
	const decoder = new TextDecoder(field(28) === 1252 ? 'windows-1252' : 'utf-8');

	const authors: string[] = [];
	let title: string | undefined;
	let coverOffset: number | undefined;
	let thumbnailOffset: number | undefined;
	const exthStart = 16 + headerLength;
	if ((field(128) ?? 0) & 0x40 && exthStart + 12 <= record.length && asciiOf(record, exthStart, 4) === 'EXTH') {
		const count = uint32BigEndian(record, exthStart + 8);
		let position = exthStart + 12;
		for (let index = 0; index < count && position + 8 <= record.length; index++) {
			const length = uint32BigEndian(record, position + 4);
			if (length < 8 || position + length > record.length) {
				break;
			}
			const data = record.subarray(position + 8, position + length);
			switch (uint32BigEndian(record, position)) {
				case EXTH_AUTHOR:
					if (authors.length < AUTHORS_MAX) {
						authors.push(decodeXmlEntities(decoder.decode(data)));
					}
					break;
				case EXTH_TITLE:
					title = decodeXmlEntities(decoder.decode(data));
					break;
				case EXTH_COVER_OFFSET:
					coverOffset = uintOf(data);
					break;
				case EXTH_THUMBNAIL_OFFSET:
					thumbnailOffset = uintOf(data);
					break;
			}
			position += length;
		}
	}
	if (!title || !cleanText(title)) {
		const titleOffset = field(84);
		const titleLength = field(88);
		if (titleOffset !== undefined && titleLength !== undefined && titleOffset + titleLength <= record.length) {
			title = decodeXmlEntities(decoder.decode(record.subarray(titleOffset, titleOffset + titleLength)));
		}
	}
	if (!title || !cleanText(title)) {
		// The database's own name, at most 31 characters, often with `_` for spaces.
		const nameEnd = header.indexOf(0);
		title = decoder.decode(header.subarray(0, nameEnd < 0 || nameEnd > 32 ? 32 : nameEnd));
	}
	if (encrypted) {
		return bookCover({ title, authors, isProtected: true });
	}

	// The offsets count from the book's first picture record.
	const firstPicture = field(108);
	for (const offset of [coverOffset, thumbnailOffset]) {
		if (firstPicture === undefined || firstPicture === 0 || firstPicture === NO_RECORD || offset === undefined || offset === NO_RECORD) {
			continue;
		}
		const index = firstPicture + offset;
		if (index >= recordCount) {
			continue;
		}
		const start = recordStart(index);
		const end = recordEnd(index);
		if (end <= start || end > file.size || end - start > PICTURE_MAX_BYTES) {
			continue;
		}
		return bookCover({ title, authors, picture: pictureOf(await readFully(file, start, end - start, NOT_KINDLE)) });
	}
	return bookCover({ title, authors });
}

// #endregion

// #region FictionBook

const LESS_THAN = 0x3c;
const GREATER_THAN = 0x3e;
const SLASH = 0x2f;
const COLON = 0x3a;
/** The most elements after an `<author>` that are looked at for the parts of its name. */
const FICTION_BOOK_AUTHOR_PARTS_MAX = 64;

function endsTagName(byte: number): boolean {
	return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === GREATER_THAN || byte === SLASH;
}

/** Whether a start tag of an element with this local name (in lower case) begins at `position`. */
function isStartTagOf(bytes: Uint8Array, position: number, name: string): boolean {
	if (bytes[position + 1] === SLASH) {
		return false;
	}
	let start = position + 1;
	let end = start;
	while (end < bytes.length && end - position <= 64 && !endsTagName(bytes[end])) {
		if (bytes[end] === COLON) {
			start = end + 1;
		}
		end++;
	}
	if (end - start !== name.length) {
		return false;
	}
	for (let index = 0; index < name.length; index++) {
		if ((bytes[start + index] | 0x20) !== name.charCodeAt(index)) {
			return false;
		}
	}
	return true;
}

function findStartTag(bytes: Uint8Array, name: string): number {
	for (let position = bytes.indexOf(LESS_THAN); position >= 0; position = bytes.indexOf(LESS_THAN, position + 1)) {
		if (isStartTagOf(bytes, position, name)) {
			return position;
		}
	}
	return -1;
}

/**
 * The picture of the `<binary>` with this id. The binaries follow the text
 * of a book, so they are looked for from its end, and only the tag of each
 * is decoded. A tag and the content after it end at the next `<`, so each
 * byte is looked at once.
 */
function findFictionBookBinary(bytes: Uint8Array, label: string, id: string): IBaseHalfBookCoverPicture | undefined {
	let next = bytes.length;
	for (let position = bytes.lastIndexOf(LESS_THAN); position >= 0; next = position, position = position === 0 ? -1 : bytes.lastIndexOf(LESS_THAN, position - 1)) {
		if (!isStartTagOf(bytes, position, 'binary')) {
			continue;
		}
		const tagLength = bytes.subarray(position, next).indexOf(GREATER_THAN) + 1;
		const tag = tagLength === 0 || bytes[position + tagLength - 2] === SLASH ? undefined : readXmlElements(decodeText(bytes.subarray(position, position + tagLength), label))[0];
		if (tag?.attributes.get('id') !== id) {
			continue;
		}
		const base64 = utf8Decoder.decode(bytes.subarray(position + tagLength, next)).replace(/\s+/g, '');
		if (base64.length / 4 * 3 > PICTURE_MAX_BYTES) {
			return undefined;
		}
		const data = decodeBase64(base64);
		return data?.length ? pictureOf(data, tag.attributes.get('content-type')) : undefined;
	}
	return undefined;
}

function readFictionBook(source: Uint8Array): IBaseHalfBookCover {
	let bytes = source;
	let label = xmlEncodingOf(bytes);
	if (label === 'utf-16le' || label === 'utf-16be') {
		bytes = new TextEncoder().encode(decodeText(bytes, label));
		label = 'utf-8';
	}
	// The description, which names the title, the authors, and the cover, comes before the text.
	const body = findStartTag(bytes, 'body');
	const binary = body >= 0 ? -1 : findStartTag(bytes, 'binary');
	const text = decodeText(bytes.subarray(0, body >= 0 ? body : binary >= 0 ? binary : bytes.length), label);
	const elements = readXmlElements(text);
	if (!elements.some(element => element.name === 'fictionbook')) {
		throw new Error('The file is not a FictionBook.');
	}
	const titleInfo = elements.find(element => element.name === 'title-info');
	const inTitleInfo = (element: IXmlElement) => titleInfo !== undefined && isWithin(element, titleInfo);
	const title = elements.find(element => element.name === 'book-title' && inTitleInfo(element));
	const authors: string[] = [];
	for (let index = 0; index < elements.length && authors.length < AUTHORS_MAX; index++) {
		const author = elements[index];
		if (author.name !== 'author' || !inTitleInfo(author)) {
			continue;
		}
		// The parts of a name follow the author's start tag; an author has but a few.
		const parts = elements.slice(index + 1, index + 1 + FICTION_BOOK_AUTHOR_PARTS_MAX).filter(part => isWithin(part, author));
		const textOf = (name: string) => {
			const part = parts.find(candidate => candidate.name === name);
			return part ? xmlTextOf(text, part) : '';
		};
		authors.push([textOf('first-name'), textOf('middle-name'), textOf('last-name')].filter(part => part.length > 0).join(' ') || textOf('nickname'));
	}
	const coverpage = elements.find(element => element.name === 'coverpage' && inTitleInfo(element)) ?? elements.find(element => element.name === 'coverpage');
	const image = coverpage && elements.find(element => element.name === 'image' && isWithin(element, coverpage));
	const href = image?.attributes.get('href')?.trim();
	return bookCover({
		title: title && xmlTextOf(text, title),
		authors,
		picture: href?.startsWith('#') ? findFictionBookBinary(bytes, label, href.slice(1)) : undefined
	});
}

async function readFictionBookCover(file: IBaseHalfRandomAccessFile, inflateRaw: BaseHalfInflateRaw): Promise<IBaseHalfBookCover> {
	const head = await readFully(file, 0, Math.min(4, file.size), 'The FictionBook could not be read whole.');
	if (isBaseHalfZip(head)) {
		const archive = await BookArchive.open(file, inflateRaw);
		const files = archive.entries.filter(entry => !entry.name.endsWith('/'));
		const entry = files.find(candidate => candidate.name.toLowerCase().endsWith('.fb2')) ?? files[0];
		if (!entry) {
			throw new Error('The archive holds no FictionBook.');
		}
		if (entry.size > BASEHALF_FICTIONBOOK_COVER_MAX_BYTES) {
			return {};
		}
		return readFictionBook(await archive.read(entry, BASEHALF_FICTIONBOOK_COVER_MAX_BYTES));
	}
	if (file.size > BASEHALF_FICTIONBOOK_COVER_MAX_BYTES) {
		return {};
	}
	return readFictionBook(await readFully(file, 0, file.size, 'The FictionBook could not be read whole.'));
}

// #endregion

// #region Comic book archives

let nameCollator: Intl.Collator | undefined;

function compareNames(a: string, b: string): number {
	nameCollator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	return nameCollator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function isComicPicture(entry: IBaseHalfZipEntry): boolean {
	const segments = entry.name.split(/[\\/]/);
	const last = segments[segments.length - 1];
	return !segments.includes('__MACOSX') && !last.startsWith('.') && /\.(?:jpe?g|png|gif|webp|bmp|avif)$/i.test(last);
}

async function readComicCover(file: IBaseHalfRandomAccessFile, inflateRaw: BaseHalfInflateRaw): Promise<IBaseHalfBookCover> {
	const archive = await BookArchive.open(file, inflateRaw);
	const first = archive.entries.filter(isComicPicture).sort((a, b) => compareNames(a.name, b.name))[0];
	const picture = first && await archive.readPicture(first.name);
	return bookCover({ picture });
}

// #endregion
