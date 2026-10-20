/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfNodeDocument } from '../../video/common/basehalfNodeDocument.js';

/** A media file that a card shows: an image, a video, audio, or a PDF. */
export interface IBaseHalfCanvasMediaPreview {
	readonly text: string;
	readonly mediaKind: 'image' | 'video' | 'audio' | 'pdf';
	readonly resource: URI;
}

/** An entry of the list that a folder's card shows. */
export type BaseHalfCanvasFolderPreviewItem = { readonly name: string; readonly kind: 'file' | 'folder' };

/** What the card of an item shows of it, as the canvas read it last. */
export type BaseHalfCanvasCardPreview =
	| { readonly kind: 'folder'; readonly total: number; readonly items: readonly BaseHalfCanvasFolderPreviewItem[] }
	| ({ readonly kind: 'media' } & IBaseHalfCanvasMediaPreview)
	| {
		readonly kind: 'node';
		readonly document: IBaseHalfNodeDocument;
		readonly resultMedia?: IBaseHalfCanvasMediaPreview;
		readonly resultOutputText?: string;
		/** The node records a file that is not there. */
		readonly resultMissing?: true;
		readonly verificationPending?: boolean;
		readonly dirty: boolean;
	}
	| { readonly kind: 'nodeLoading'; readonly text: string }
	| { readonly kind: 'invalidNode'; readonly text: string }
	| { readonly kind: 'text' | 'code' | 'markdown' | 'empty' | 'loading' | 'unavailable' | 'richRequired'; readonly text: string };

/** What the card of a node shows of it. */
export type BaseHalfCanvasNodePreview = Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>;

export function baseHalfCanvasCardPreviewRenderKey(preview: BaseHalfCanvasCardPreview | undefined): string {
	return JSON.stringify(preview, (_key, value: unknown) => {
		if (value instanceof Map) {
			return [...value.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)));
		}
		return value;
	}) ?? '';
}

export function baseHalfCanvasCardPreviewCanRetainElement(
	resultNode: boolean,
	previous: BaseHalfCanvasCardPreview | undefined,
	next: BaseHalfCanvasCardPreview | undefined
): boolean {
	return previous === next
		|| (resultNode && baseHalfCanvasCardPreviewRenderKey(previous) === baseHalfCanvasCardPreviewRenderKey(next));
}
