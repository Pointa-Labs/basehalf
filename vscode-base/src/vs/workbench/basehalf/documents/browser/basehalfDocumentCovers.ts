/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { createBlobWorker } from '../../../../platform/webWorker/browser/webWorkerServiceImpl.js';
import { readBaseHalfFileRange } from '../../workspace/common/basehalfFileRange.js';
import { baseHalfBookFormatOfName, readBaseHalfBookCover } from '../common/basehalfBookCover.js';
import {
	BASEHALF_DOCUMENT_COVER_CACHE_FOLDER,
	BaseHalfDocumentCoverProblem,
	baseHalfDocumentCoverKey,
	baseHalfDocumentCoverVersion,
	IBaseHalfDocumentCoverEntry,
	parseBaseHalfDocumentCoverEntry,
	serializeBaseHalfDocumentCoverEntry
} from '../common/basehalfDocumentCoverCache.js';
import { BASEHALF_DOCUMENT_COVER_WIDTH, BASEHALF_PDF_COVER_MAX_BYTES, baseHalfDocumentKind } from '../common/basehalfDocuments.js';
import { BASEHALF_PDF_COVER_WORKER_READY, BaseHalfPdfCoverReply, IBaseHalfPdfCoverRequest, isBaseHalfPdfCoverReply } from '../common/basehalfPdfCoverProtocol.js';
import { IBaseHalfRandomAccessFile } from '../common/basehalfZipReader.js';

const contentViewerRoot = 'vs/../../extensions/basehalf/content-viewer-out';
/** At most this many covers are made at a time. */
const COVERS_AT_A_TIME = 2;
/** The worker that draws PDFs ends after it was not used for this long. */
const PDF_WORKER_IDLE_MS = 30_000;
/** A worker that does not start in this time is given up. */
const PDF_WORKER_START_TIMEOUT_MS = 20_000;
const ENTRY_MAX_BYTES = 64 * 1024;

export const IBaseHalfDocumentCoverService = createDecorator<IBaseHalfDocumentCoverService>('baseHalfDocumentCoverService');

/** The cover of a PDF or a book, as its card draws it (PDFs and books, "The card"). */
export interface IBaseHalfDocumentCover {
	/** The picture of the cover, for the window's file protocol; none for a document whose cover cannot be drawn. */
	readonly picture?: { readonly resource: URI; readonly width: number; readonly height: number };
	readonly title?: string;
	readonly authors?: readonly string[];
	readonly problem?: BaseHalfDocumentCoverProblem;
}

export interface IBaseHalfDocumentCoverService {
	readonly _serviceBrand: undefined;
	/** The cover of this version of a file, when this window knows it already, so that a card draws it at once. */
	peek(resource: URI, fileVersion: string): IBaseHalfDocumentCover | undefined;
	/** The cover of this version of a file: from the cache, or made now. It never fails: a cover that cannot be made has a problem. */
	cover(resource: URI, fileVersion: string): Promise<IBaseHalfDocumentCover>;
}

/**
 * Makes and keeps the covers of PDFs and books (PDFs and books, "How a cover
 * is made"): in the application's data folder, one entry for each path, made
 * again when the file changes. A PDF's first page is drawn by a worker; a
 * book's cover is read from the parts of its file that hold it.
 */
export class BaseHalfDocumentCoverService extends Disposable implements IBaseHalfDocumentCoverService {
	declare readonly _serviceBrand: undefined;

	private readonly folder: URI;
	private readonly known = new Map<string, { readonly version: string; readonly cover: IBaseHalfDocumentCover }>();
	private readonly loading = new Map<string, Promise<IBaseHalfDocumentCover>>();
	private readonly turns: (() => void)[] = [];
	private running = 0;
	private readonly pdfWorker: BaseHalfPdfCoverWorker;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.folder = joinPath(environmentService.cacheHome, BASEHALF_DOCUMENT_COVER_CACHE_FOLDER);
		this.pdfWorker = this._register(new BaseHalfPdfCoverWorker(logService));
	}

	peek(resource: URI, fileVersion: string): IBaseHalfDocumentCover | undefined {
		const known = this.known.get(baseHalfDocumentCoverKey(resource));
		return known?.version === baseHalfDocumentCoverVersion(fileVersion) ? known.cover : undefined;
	}

	cover(resource: URI, fileVersion: string): Promise<IBaseHalfDocumentCover> {
		const key = baseHalfDocumentCoverKey(resource);
		const version = baseHalfDocumentCoverVersion(fileVersion);
		const known = this.known.get(key);
		if (known?.version === version) {
			return Promise.resolve(known.cover);
		}
		const id = `${key}\n${version}`;
		let loading = this.loading.get(id);
		if (!loading) {
			loading = this.load(resource, key, version).finally(() => this.loading.delete(id));
			this.loading.set(id, loading);
		}
		return loading;
	}

	private async load(resource: URI, key: string, version: string): Promise<IBaseHalfDocumentCover> {
		// The entry of this version needs nothing made.
		const cached = await this.readEntry(key);
		let entry = cached?.version === version ? cached : undefined;
		if (!entry) {
			await this.takeTurn();
			try {
				entry = await this.make(resource, key, version);
			} finally {
				this.endTurn();
			}
			await this.writeEntry(key, entry);
		}
		const cover: IBaseHalfDocumentCover = Object.freeze({
			...(entry.picture ? { picture: { resource: this.pictureResource(key, version), width: entry.picture.width, height: entry.picture.height } } : {}),
			...(entry.title ? { title: entry.title } : {}),
			...(entry.authors?.length ? { authors: entry.authors } : {}),
			...(entry.problem ? { problem: entry.problem } : {})
		});
		this.known.set(key, { version, cover });
		return cover;
	}

	private async make(resource: URI, key: string, version: string): Promise<IBaseHalfDocumentCoverEntry> {
		try {
			const stat = await this.fileService.stat(resource);
			const size = stat.size ?? 0;
			if (baseHalfDocumentKind(resource) === 'pdf') {
				if (size > BASEHALF_PDF_COVER_MAX_BYTES) {
					return { version, problem: 'tooLarge' };
				}
				// The worker reads a file of this computer itself: a PDF of hundreds of
				// megabytes would otherwise hold up the window while it passes through.
				const pdf = resource.scheme === Schemas.file
					? FileAccess.uriToBrowserUri(resource).with({ query: `basehalfCoverOf=${encodeURIComponent(version)}` }).toString(true)
					: ownBuffer((await this.fileService.readFile(resource)).value.buffer);
				const reply = await this.pdfWorker.draw(pdf, BASEHALF_DOCUMENT_COVER_WIDTH);
				if (!reply.ok) {
					this.logService.info(`[BaseHalf] the first page of ${resource.toString()} was not drawn: ${reply.message}`);
					return { version, problem: reply.problem };
				}
				await this.writePicture(key, new Uint8Array(reply.picture));
				return { version, picture: { width: reply.width, height: reply.height } };
			}
			const format = baseHalfBookFormatOfName(basename(resource));
			if (!format) {
				return { version, problem: 'unreadable' };
			}
			const file: IBaseHalfRandomAccessFile = {
				size,
				read: async (offset, length) => (await readBaseHalfFileRange(this.fileService, resource, offset, length)).buffer
			};
			const book = await readBaseHalfBookCover(format, file, inflateRaw);
			const about = {
				...(book.title ? { title: book.title } : {}),
				...(book.authors?.length ? { authors: book.authors } : {})
			};
			if (book.protected) {
				return { version, ...about, problem: 'protected' };
			}
			if (!book.picture) {
				return { version, ...about, problem: 'noPicture' };
			}
			const picture = await scaledPicture(book.picture.bytes, book.picture.type, BASEHALF_DOCUMENT_COVER_WIDTH);
			if (!picture) {
				return { version, ...about, problem: 'unreadable' };
			}
			await this.writePicture(key, picture.bytes);
			return { version, ...about, picture: { width: picture.width, height: picture.height } };
		} catch (error) {
			this.logService.info(`[BaseHalf] no cover was made for ${resource.toString()}: ${getErrorMessage(error)}`);
			return { version, problem: 'unreadable' };
		}
	}

	private async readEntry(key: string): Promise<IBaseHalfDocumentCoverEntry | undefined> {
		try {
			const content = await this.fileService.readFile(joinPath(this.folder, `${key}.json`), { limits: { size: ENTRY_MAX_BYTES } });
			return parseBaseHalfDocumentCoverEntry(content.value.toString());
		} catch (error) {
			if (!(error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND)) {
				this.logService.warn(`[BaseHalf] a cover entry could not be read: ${getErrorMessage(error)}`);
			}
			return undefined;
		}
	}

	private async writeEntry(key: string, entry: IBaseHalfDocumentCoverEntry): Promise<void> {
		try {
			await this.fileService.writeFile(joinPath(this.folder, `${key}.json`), VSBuffer.fromString(serializeBaseHalfDocumentCoverEntry(entry)), { atomic: { postfix: '.basehalf-tmp' } });
		} catch (error) {
			// The cover still shows in this window; another one makes it again.
			this.logService.warn(`[BaseHalf] a cover entry could not be kept: ${getErrorMessage(error)}`);
		}
	}

	private async writePicture(key: string, bytes: Uint8Array): Promise<void> {
		await this.fileService.writeFile(joinPath(this.folder, `${key}.webp`), VSBuffer.wrap(bytes), { atomic: { postfix: '.basehalf-tmp' } });
	}

	/** The picture of an entry; its version in the query, so that a picture made again is not taken from the window's cache. */
	private pictureResource(key: string, version: string): URI {
		return joinPath(this.folder, `${key}.webp`).with({ query: `basehalfCover=${encodeURIComponent(version)}` });
	}

	private takeTurn(): Promise<void> {
		if (this.running < COVERS_AT_A_TIME) {
			this.running++;
			return Promise.resolve();
		}
		return new Promise(resolve => this.turns.push(resolve));
	}

	private endTurn(): void {
		const next = this.turns.shift();
		if (next) {
			next();
		} else {
			this.running--;
		}
	}
}

/**
 * The worker of the window that draws the first page of a PDF, with the
 * PDFium of the PDF reader. It starts with the first PDF a card needs and ends
 * after it was not used for {@link PDF_WORKER_IDLE_MS}.
 */
class BaseHalfPdfCoverWorker extends Disposable {
	private worker: Promise<Worker> | undefined;
	private nextId = 1;
	private readonly replies = new Map<number, (reply: BaseHalfPdfCoverReply) => void>();
	private readonly idle = this._register(new MutableDisposable());

	constructor(private readonly logService: ILogService) {
		super();
		this._register(toDisposable(() => this.stop('The window closed.')));
	}

	draw(pdf: string | ArrayBuffer, width: number): Promise<BaseHalfPdfCoverReply> {
		this.idle.clear();
		const id = this.nextId++;
		const request: IBaseHalfPdfCoverRequest = {
			id,
			pdf,
			width,
			wasmUrl: FileAccess.asBrowserUri(`${contentViewerRoot}/pdfium.wasm`).toString(true),
			fontUrl: FileAccess.asBrowserUri(`${contentViewerRoot}/NotoSansHans-Regular.otf`).toString(true)
		};
		const reply = new Promise<BaseHalfPdfCoverReply>(resolve => {
			this.replies.set(id, resolve);
			this.start().then(
				worker => worker.postMessage(request, typeof pdf === 'string' ? [] : [pdf]),
				error => this.answer({ id, ok: false, problem: 'unreadable', message: `The worker did not start: ${getErrorMessage(error)}` })
			);
		});
		return reply.finally(() => {
			if (this.replies.size === 0) {
				const timer = mainWindow.setTimeout(() => this.stop(), PDF_WORKER_IDLE_MS);
				this.idle.value = toDisposable(() => mainWindow.clearTimeout(timer));
			}
		});
	}

	private start(): Promise<Worker> {
		this.worker ??= new Promise<Worker>((resolve, reject) => {
			const script = FileAccess.asBrowserUri(`${contentViewerRoot}/pdfCoverWorker.js`).toString(true);
			// The bundle is a module of the window's own files; a module worker of a
			// blob imports it, as the workbench's own workers are started.
			const bootstrap = URL.createObjectURL(new Blob([`import(${JSON.stringify(script)}).catch(error => postMessage({ type: 'basehalf.pdfCover.failed', message: String(error) }));`], { type: 'text/javascript' }));
			const worker = createBlobWorker(bootstrap, { name: 'BaseHalfPdfCover' });
			const timeout = mainWindow.setTimeout(() => fail(new Error('It did not start in time.')), PDF_WORKER_START_TIMEOUT_MS);
			let started = false;
			const fail = (error: Error) => {
				mainWindow.clearTimeout(timeout);
				URL.revokeObjectURL(bootstrap);
				worker.terminate();
				this.worker = undefined;
				reject(error);
			};
			worker.onmessage = event => {
				const data = event.data as { readonly type?: unknown; readonly message?: unknown } | undefined;
				if (data?.type === BASEHALF_PDF_COVER_WORKER_READY) {
					started = true;
					mainWindow.clearTimeout(timeout);
					URL.revokeObjectURL(bootstrap);
					resolve(worker);
				} else if (data?.type === 'basehalf.pdfCover.failed') {
					fail(new Error(String(data.message)));
				} else if (isBaseHalfPdfCoverReply(data)) {
					this.answer(data);
				}
			};
			worker.onerror = event => {
				event.preventDefault();
				const error = new Error(event.message || 'The worker stopped.');
				if (started) {
					// PDFium can run out of memory on a page: every request waiting fails, and the next one starts a new worker.
					this.logService.warn(`[BaseHalf] the worker that draws PDF covers stopped: ${error.message}`);
					this.stop(error.message);
				} else {
					fail(error);
				}
			};
		});
		return this.worker;
	}

	private answer(reply: BaseHalfPdfCoverReply): void {
		const resolve = this.replies.get(reply.id);
		this.replies.delete(reply.id);
		resolve?.(reply);
	}

	private stop(reason = 'The worker ended.'): void {
		const worker = this.worker;
		this.worker = undefined;
		void worker?.then(started => started.terminate(), () => undefined);
		for (const id of [...this.replies.keys()]) {
			this.answer({ id, ok: false, problem: 'unreadable', message: reason });
		}
	}
}

/** The bytes as an array buffer of their own, which can be handed to a worker. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
		? bytes.buffer
		: bytes.slice().buffer as ArrayBuffer;
}

/** No part of a book that a cover needs is larger: an entry that inflates further lies about its size. */
const INFLATED_MAX_BYTES = 32 * 1024 * 1024;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (let read = await reader.read(); !read.done; read = await reader.read()) {
			length += read.value.byteLength;
			if (length > INFLATED_MAX_BYTES) {
				throw new Error('A part of the book inflates beyond what a cover needs.');
			}
			chunks.push(read.value);
		}
	} finally {
		void reader.cancel().catch(() => undefined);
	}
	const inflated = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		inflated.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return inflated;
}

/**
 * The picture at most `width` pixels wide, as WebP. It is decoded and encoded
 * off the window's thread; an SVG is drawn as an image, which runs no script.
 */
async function scaledPicture(bytes: Uint8Array, type: string, width: number): Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number } | undefined> {
	const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
	let source: ImageBitmap | HTMLImageElement;
	try {
		source = type === 'image/svg+xml' ? await svgImage(blob) : await createImageBitmap(blob);
	} catch {
		return undefined;
	}
	try {
		const naturalWidth = source instanceof ImageBitmap ? source.width : source.naturalWidth;
		const naturalHeight = source instanceof ImageBitmap ? source.height : source.naturalHeight;
		if (!naturalWidth || !naturalHeight) {
			return undefined;
		}
		const scale = Math.min(1, width / naturalWidth);
		const canvas = new OffscreenCanvas(Math.max(1, Math.round(naturalWidth * scale)), Math.max(1, Math.round(naturalHeight * scale)));
		const context = canvas.getContext('2d');
		if (!context) {
			return undefined;
		}
		context.imageSmoothingQuality = 'high';
		context.drawImage(source, 0, 0, canvas.width, canvas.height);
		const encoded = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
		return { bytes: new Uint8Array(await encoded.arrayBuffer()), width: canvas.width, height: canvas.height };
	} finally {
		if (source instanceof ImageBitmap) {
			source.close();
		}
	}
}

async function svgImage(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob);
	try {
		const image = new mainWindow.Image();
		image.src = url;
		await image.decode();
		return image;
	} finally {
		URL.revokeObjectURL(url);
	}
}

registerSingleton(IBaseHalfDocumentCoverService, BaseHalfDocumentCoverService, InstantiationType.Delayed);
