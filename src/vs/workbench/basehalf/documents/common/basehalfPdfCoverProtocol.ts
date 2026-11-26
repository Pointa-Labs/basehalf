/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The messages between the window and the worker that draws the first page of
// a PDF (PDFs and books, "How a cover is made"). The worker's bundle imports
// this module, so it imports nothing.

/** What the worker says once it takes requests. */
export const BASEHALF_PDF_COVER_WORKER_READY = 'basehalf.pdfCover.ready';

/** A request to draw the first page of a PDF. */
export interface IBaseHalfPdfCoverRequest {
	readonly id: number;
	/**
	 * The address in the window's file protocol that the worker reads the
	 * whole file from, or, for a PDF that is not a file on this computer, the
	 * whole file. PDFium reads a document from memory.
	 */
	readonly pdf: string | ArrayBuffer;
	/** The width of the picture, in pixels. */
	readonly width: number;
	/** The PDFium that the PDF reader uses. */
	readonly wasmUrl: string;
	/** The font for text whose font the file does not hold. */
	readonly fontUrl: string;
}

/** Why a first page could not be drawn: a password locks the file, or it is damaged. */
export type BaseHalfPdfCoverProblem = 'locked' | 'unreadable';

export type BaseHalfPdfCoverReply =
	| {
		readonly id: number;
		readonly ok: true;
		/** The first page as WebP. */
		readonly picture: ArrayBuffer;
		readonly width: number;
		readonly height: number;
		readonly pages: number;
	}
	| {
		readonly id: number;
		readonly ok: false;
		readonly problem: BaseHalfPdfCoverProblem;
		/** For the log. */
		readonly message: string;
	};

export function isBaseHalfPdfCoverReply(value: unknown): value is BaseHalfPdfCoverReply {
	const reply = value as Partial<Record<'id' | 'ok', unknown>> | null | undefined;
	return typeof reply?.id === 'number' && typeof reply.ok === 'boolean';
}
