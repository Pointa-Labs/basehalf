/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { baseHalfRenderableContentKind } from '../../cardDetail/common/basehalfContentRendering.js';
import { baseHalfBookFormatOfName } from './basehalfBookCover.js';

/** A PDF or a book (PDFs and books, "Terms"). */
export type BaseHalfDocumentKind = 'pdf' | 'book';

/** The kind of the document a file is, by its name, or undefined for any other file. */
export function baseHalfDocumentKind(resource: URI): BaseHalfDocumentKind | undefined {
	const kind = baseHalfRenderableContentKind(resource);
	return kind === 'pdf' || kind === 'book' ? kind : undefined;
}

/** The line under the glyph on the grey face of a document's card (PDFs and books, "The card"). */
export function baseHalfDocumentFaceLabel(resource: URI): string {
	if (baseHalfDocumentKind(resource) === 'pdf') {
		return localize('basehalf.documents.pdf', "PDF document");
	}
	switch (baseHalfBookFormatOfName(basename(resource))) {
		case 'epub': return localize('basehalf.documents.epub', "EPUB book");
		case 'kindle': return localize('basehalf.documents.kindle', "Kindle book");
		case 'fictionbook': return localize('basehalf.documents.fictionBook', "FictionBook");
		case 'comic': return localize('basehalf.documents.comic', "Comic book");
		default: return localize('basehalf.documents.book', "Book");
	}
}

/** The width of a cover, in pixels (PDFs and books, "How a cover is made"). */
export const BASEHALF_DOCUMENT_COVER_WIDTH = 800;

/** A PDF larger than this has no cover: PDFium reads a document whole. */
export const BASEHALF_PDF_COVER_MAX_BYTES = 512 * 1024 * 1024;

/** The version of a file that a cover is made from: its time and its size. */
export function baseHalfDocumentVersion(stat: { readonly mtime?: number; readonly size?: number }): string {
	return `${stat.mtime ?? 0}-${stat.size ?? 0}`;
}
