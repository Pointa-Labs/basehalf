/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../../platform/protocol/common/basehalfMediaFiles.js';

export type BaseHalfRenderableContentKind = 'image' | 'pdf' | 'book' | 'audio' | 'video';

const CONTENT_EXTENSIONS: Readonly<Record<BaseHalfRenderableContentKind, readonly string[]>> = BASEHALF_MEDIA_FILE_EXTENSIONS;

export const BASEHALF_RENDERABLE_CONTENT_EXTENSIONS: readonly string[] = Object.values(CONTENT_EXTENSIONS).flat();

const CONTENT_KIND_BY_EXTENSION = new Map<string, BaseHalfRenderableContentKind>(
	Object.entries(CONTENT_EXTENSIONS).flatMap(([kind, extensions]) =>
		extensions.map(extension => [extension, kind as BaseHalfRenderableContentKind] as const)
	)
);

/** Classifies the files that BaseHalf shows as an image, a PDF, a book, a sound, or a video, on the canvas and in Card Detail. */
export function baseHalfRenderableContentKind(resource: URI): BaseHalfRenderableContentKind | undefined {
	return CONTENT_KIND_BY_EXTENSION.get(extname(resource).toLowerCase());
}

export function isBaseHalfRenderableContentResource(resource: URI): boolean {
	return baseHalfRenderableContentKind(resource) !== undefined;
}
