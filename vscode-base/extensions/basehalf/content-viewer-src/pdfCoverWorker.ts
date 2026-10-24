/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The worker of the window that draws the first page of a PDF for its card
// (PDFs and books, "How a cover is made"). It runs the PDFium of the PDF
// reader in this thread, so drawing never holds up the window.

import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine';
import { FontCharset, PdfErrorCode, type PdfDocumentObject } from '@embedpdf/models';
import { BASEHALF_PDF_COVER_WORKER_READY, type BaseHalfPdfCoverReply, type IBaseHalfPdfCoverRequest } from '../../../src/vs/workbench/basehalf/documents/common/basehalfPdfCoverProtocol.js';

interface IWorkerScope {
	onmessage: ((event: MessageEvent<IBaseHalfPdfCoverRequest>) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}

type PdfiumEngine = Awaited<ReturnType<typeof createPdfiumEngine>>;

const scope = globalThis as unknown as IWorkerScope;
let engine: Promise<PdfiumEngine> | undefined;
/** One page is drawn at a time; the window asks for at most two. */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = event => {
	const request = event.data;
	queue = queue.then(() => draw(request)).then(reply => {
		scope.postMessage(reply, reply.ok ? [reply.picture] : []);
	});
};
scope.postMessage({ type: BASEHALF_PDF_COVER_WORKER_READY });

async function draw(request: IBaseHalfPdfCoverRequest): Promise<BaseHalfPdfCoverReply> {
	let pdfium: PdfiumEngine;
	try {
		pdfium = await (engine ??= createPdfiumEngine(request.wasmUrl, {
			// Text whose font the file does not hold is drawn with the reader's fallback font.
			fontFallback: { fonts: { [FontCharset.GB2312]: request.fontUrl } }
		}));
	} catch (error) {
		engine = undefined;
		return { id: request.id, ok: false, problem: 'unreadable', message: `PDFium did not start: ${messageOf(error)}` };
	}
	let document: PdfDocumentObject | undefined;
	try {
		const content = typeof request.pdf === 'string' ? await read(request.pdf) : request.pdf;
		document = await pdfium.openDocumentBuffer({ id: `cover-${request.id}`, content }).toPromise();
		const page = document.pages[0];
		if (!page) {
			return { id: request.id, ok: false, problem: 'unreadable', message: 'The PDF has no page.' };
		}
		const scale = request.width / page.size.width;
		const raw = await pdfium.renderPageRaw(document, page, { scaleFactor: scale, withAnnotations: true }).toPromise();
		const canvas = new OffscreenCanvas(raw.width, raw.height);
		const context = canvas.getContext('2d');
		if (!context) {
			return { id: request.id, ok: false, problem: 'unreadable', message: 'The worker has no 2D canvas.' };
		}
		context.putImageData(new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height), 0, 0);
		const picture = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
		return { id: request.id, ok: true, picture: await picture.arrayBuffer(), width: raw.width, height: raw.height, pages: document.pageCount };
	} catch (error) {
		const code = (error as { reason?: { code?: number } } | undefined)?.reason?.code;
		return { id: request.id, ok: false, problem: code === PdfErrorCode.Password ? 'locked' : 'unreadable', message: messageOf(error) };
	} finally {
		if (document) {
			await pdfium.closeDocument(document).toPromise().catch(() => undefined);
		}
	}
}

/** The file, read by this thread, so that its bytes never pass through the window's. */
async function read(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`The file could not be read: ${response.status}.`);
	}
	return response.arrayBuffer();
}

function messageOf(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	const reason = (error as { reason?: { message?: string } } | undefined)?.reason;
	return reason?.message ?? String(error);
}
