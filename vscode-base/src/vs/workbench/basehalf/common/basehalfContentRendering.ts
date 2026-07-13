/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { extname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

export type BaseHalfRenderableContentKind = 'image' | 'pdf' | 'audio' | 'video';

const CONTENT_EXTENSIONS: Readonly<Record<BaseHalfRenderableContentKind, readonly string[]>> = {
	image: ['.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp'],
	pdf: ['.pdf'],
	audio: ['.flac', '.m4a', '.mp3', '.oga', '.ogg', '.wav'],
	video: ['.m4v', '.mp4', '.webm']
};

export const BASEHALF_RENDERABLE_CONTENT_EXTENSIONS: readonly string[] = Object.values(CONTENT_EXTENSIONS).flat();

const CONTENT_KIND_BY_EXTENSION = new Map<string, BaseHalfRenderableContentKind>(
	Object.entries(CONTENT_EXTENSIONS).flatMap(([kind, extensions]) =>
		extensions.map(extension => [extension, kind as BaseHalfRenderableContentKind] as const)
	)
);

/** Classifies file types that BaseHalf can render directly in Card Detail. */
export function baseHalfRenderableContentKind(resource: URI): BaseHalfRenderableContentKind | undefined {
	return CONTENT_KIND_BY_EXTENSION.get(extname(resource).toLowerCase());
}

export function isBaseHalfRenderableContentResource(resource: URI): boolean {
	return baseHalfRenderableContentKind(resource) !== undefined;
}
