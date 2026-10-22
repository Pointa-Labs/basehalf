/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

/** A media file that a card shows: an image, a video, audio, or a PDF. */
export interface IBaseHalfCanvasMediaPreview {
	readonly text: string;
	readonly mediaKind: 'image' | 'video' | 'audio' | 'pdf';
	readonly resource: URI;
}

/** An entry of the list that a folder's card shows. */
export type BaseHalfCanvasFolderPreviewItem = { readonly name: string; readonly kind: 'file' | 'folder' };

/**
 * What the card of an item shows of it, as the canvas read it last. A draft
 * has no file: its card shows what its generation information and the task
 * record of this computer say (generation cards, "The card").
 */
export type BaseHalfCanvasCardPreview =
	| { readonly kind: 'folder'; readonly total: number; readonly items: readonly BaseHalfCanvasFolderPreviewItem[] }
	| ({ readonly kind: 'media' } & IBaseHalfCanvasMediaPreview)
	| { readonly kind: 'draft' }
	| { readonly kind: 'text' | 'code' | 'markdown' | 'empty' | 'loading' | 'unavailable' | 'richRequired'; readonly text: string };

/** The preview of every draft: what it shows changes in place, as its generation goes on. */
export const BASEHALF_CANVAS_DRAFT_PREVIEW: BaseHalfCanvasCardPreview = Object.freeze({ kind: 'draft' });
