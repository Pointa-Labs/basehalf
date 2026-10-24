/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasCardDocument.css';
import { $, append } from '../../../../base/browser/dom.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfDocumentCover, IBaseHalfDocumentCoverService } from '../../documents/browser/basehalfDocumentCovers.js';
import { baseHalfDocumentFaceLabel } from '../../documents/common/basehalfDocuments.js';

/** The face of the card of a PDF or a book, while it is drawn. */
export interface IBaseHalfCanvasCardDocumentFace extends IDisposable {
	/** Shows or hides the cover at once; the card keeps its place and its size. */
	setCoverShown(shown: boolean): void;
}

export interface IBaseHalfCanvasCardDocumentOptions {
	/** The PDF or the book. */
	readonly resource: URI;
	/** The version of its file: its time and its size. */
	readonly version: string;
	readonly coverShown: boolean;
	readonly coverService: IBaseHalfDocumentCoverService;
	/** Draws the glyph of the document's kind. */
	readonly renderGlyph: (container: HTMLElement) => void;
}

/**
 * What the card of a PDF or a book shows (PDFs and books, "The card"): its
 * cover inside the card, or the grey face of a file card while the cover is
 * hidden and when there is no cover to draw. Until a cover is drawn the card
 * shows its surface and nothing else. A hidden cover is not even made.
 */
export function renderBaseHalfCanvasCardDocument(container: HTMLElement, options: IBaseHalfCanvasCardDocumentOptions): IBaseHalfCanvasCardDocumentFace {
	container.classList.add('basehalf-canvas-card-document');
	const face = append(container, $('.basehalf-canvas-card-media-fallback.basehalf-canvas-card-document-face'));
	options.renderGlyph(append(face, $('.basehalf-canvas-card-media-fallback-glyph')));
	const title = append(face, $('span.basehalf-canvas-card-document-title'));
	title.hidden = true;
	append(face, $('span.basehalf-canvas-card-media-fallback-label')).textContent = baseHalfDocumentFaceLabel(options.resource);
	const frame = append(container, $('.basehalf-canvas-card-document-frame'));
	let shown = options.coverShown;
	let cover: IBaseHalfDocumentCover | undefined = options.coverService.peek(options.resource, options.version);
	let image: HTMLImageElement | undefined;
	let disposed = false;

	const show = (state: 'surface' | 'cover' | 'face') => {
		container.dataset.cover = state;
		// A book without a picture shows its title on the grey face.
		const titled = state === 'face' && shown && !!cover && !cover.picture && !!cover.title;
		title.hidden = !titled;
		title.textContent = titled ? cover!.title! : '';
	};
	const draw = () => {
		if (!shown) {
			show('face');
			return;
		}
		const picture = cover?.picture;
		if (!cover) {
			show('surface');
			return;
		}
		if (!picture) {
			show('face');
			return;
		}
		if (!image) {
			const element = image = append(frame, $('img.basehalf-canvas-card-document-cover')) as HTMLImageElement;
			element.alt = '';
			element.draggable = false;
			element.decoding = 'async';
			element.style.setProperty('--bh-document-cover-ratio', String(picture.width / picture.height));
			element.addEventListener('load', () => {
				if (!disposed && shown) {
					show('cover');
				}
			});
			element.addEventListener('error', () => {
				if (!disposed) {
					cover = { ...cover, picture: undefined };
					element.remove();
					draw();
				}
			});
			element.src = FileAccess.uriToBrowserUri(picture.resource).toString(true);
		}
		show(image.complete && image.naturalWidth > 0 ? 'cover' : 'surface');
	};
	const request = () => {
		if (cover) {
			draw();
			return;
		}
		show('surface');
		void options.coverService.cover(options.resource, options.version).then(made => {
			if (!disposed) {
				cover = made;
				draw();
			}
		});
	};

	if (shown) {
		request();
	} else {
		show('face');
	}
	return {
		setCoverShown(next: boolean): void {
			shown = next;
			if (shown) {
				request();
			} else {
				show('face');
			}
		},
		dispose(): void {
			disposed = true;
		}
	};
}
